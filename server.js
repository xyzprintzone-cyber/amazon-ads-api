import { createServer } from "http";
import * as amazon from "./amazon.js";
import { mockCampaigns, mockKeywords, mockSearchTerms } from "./mock-data.js";
import { parseAmazonCSV } from "./csv-parser.js";

// ── CSV Data Store (in-memory, survives cold starts per sessione) ──────────────
let csvStore = null; // { campaigns, keywords, searchTerms, dateRange, uploadedAt, rowCount }

const PORT = process.env.PORT || 8787;
const ACOS_TARGET = parseFloat(process.env.ACOS_TARGET || "0.40");
const DAILY_BUDGET_MAX = parseFloat(process.env.DAILY_BUDGET_MAX || "30.00");

// ── Helpers ───────────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function json(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

async function readRawBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

// Restituisce campagne attive: CSV se caricato, altrimenti mock
function activeCampaigns() {
  return csvStore ? csvStore.campaigns : mockCampaigns;
}
function activeKeywords() {
  return csvStore ? csvStore.keywords : mockKeywords;
}
function activeSearchTerms() {
  return csvStore ? csvStore.searchTerms : mockSearchTerms;
}

// ── Date-range aggregation ────────────────────────────────────────────────────
function aggregateCampaignStats(campaign, startDate, endDate) {
  const stats = campaign.dailyStats || [];
  const filtered = stats.filter(s => s.date >= startDate && s.date <= endDate);

  const agg = filtered.reduce(
    (acc, s) => ({
      cost: acc.cost + s.cost,
      clicks: acc.clicks + s.clicks,
      impressions: acc.impressions + s.impressions,
      orders: acc.orders + s.orders,
      sales: acc.sales + s.sales,
    }),
    { cost: 0, clicks: 0, impressions: 0, orders: 0, sales: 0 }
  );

  const acos = agg.sales > 0 ? agg.cost / agg.sales : null;
  const ctr  = agg.impressions > 0 ? agg.clicks / agg.impressions : 0;
  const cpc  = agg.clicks > 0 ? agg.cost / agg.clicks : 0;
  const roas = agg.cost > 0 ? agg.sales / agg.cost : null;

  return {
    campaignId: campaign.campaignId,
    name: campaign.name,
    state: campaign.state,
    dailyBudget: campaign.dailyBudget,
    targetingType: campaign.targetingType,
    cost: parseFloat(agg.cost.toFixed(2)),
    clicks: agg.clicks,
    impressions: agg.impressions,
    orders: agg.orders,
    sales: parseFloat(agg.sales.toFixed(2)),
    acos: acos !== null ? parseFloat(acos.toFixed(4)) : null,
    ctr: parseFloat(ctr.toFixed(4)),
    cpc: parseFloat(cpc.toFixed(2)),
    roas: roas !== null ? parseFloat(roas.toFixed(2)) : null,
  };
}

// ── AI Engine ─────────────────────────────────────────────────────────────────
function generateAIRecommendations(startDate, endDate) {
  const recs = [];
  const campaignStats = activeCampaigns().map(c => aggregateCampaignStats(c, startDate, endDate));

  // 1. Keyword ACoS > target AND clicks ≥ 5
  for (const kw of activeKeywords()) {
    if (kw.state !== "enabled") continue;
    const acos = kw.attributedSales14d > 0
      ? kw.cost / kw.attributedSales14d
      : (kw.clicks >= 5 ? 999 : null);
    if (acos === null || acos <= ACOS_TARGET) continue;

    const suggestedBid = acos < 999
      ? Math.max(0.10, parseFloat((kw.bid * (ACOS_TARGET / acos)).toFixed(2)))
      : parseFloat((kw.bid * 0.70).toFixed(2));

    recs.push({
      id: `bid-reduce-${kw.keywordId}`,
      type: "bid_reduce",
      priority: acos > 1.0 ? "high" : "medium",
      title: `Riduci offerta: "${kw.keywordText}"`,
      description: `ACoS ${acos === 999 ? "∞" : (acos * 100).toFixed(0)}% (target ${(ACOS_TARGET * 100).toFixed(0)}%) · ${kw.clicks} click senza conversioni sufficienti`,
      action: `Riduci offerta da €${kw.bid.toFixed(2)} → €${suggestedBid.toFixed(2)}`,
      expectedImpact: acos < 999
        ? `ACoS stimato ~${(ACOS_TARGET * 100).toFixed(0)}%`
        : `Risparmio ~€${((kw.bid - suggestedBid) * kw.clicks / 30).toFixed(2)}/gg`,
      data: { keywordId: kw.keywordId, keywordText: kw.keywordText, currentBid: kw.bid, suggestedBid, acos },
      timestamp: new Date().toISOString(),
    });
  }

  // 2. Search term clicks ≥ 5 + 0 conversioni → negativa
  const existingKwTexts = new Set(activeKeywords().map(k => k.keywordText.toLowerCase()));
  for (const st of activeSearchTerms()) {
    if (st.clicks >= 5 && st.attributedConversions14d === 0) {
      recs.push({
        id: `negative-${st.query.replace(/\s+/g, "-")}`,
        type: "add_negative",
        priority: st.clicks >= 20 ? "high" : "medium",
        title: `Keyword negativa: "${st.query}"`,
        description: `${st.clicks} click · €${st.cost.toFixed(2)} spesi · 0 conversioni in "${st.campaignName}"`,
        action: `Aggiungi "${st.query}" come negativa (exact match)`,
        expectedImpact: `Risparmio ~€${(st.cost * 0.8).toFixed(2)} nel periodo`,
        data: { query: st.query, campaignName: st.campaignName, clicks: st.clicks, cost: st.cost },
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 3. Search term con ≥2 conversioni non in keyword → aggiungi
  for (const st of activeSearchTerms()) {
    if (existingKwTexts.has(st.query.toLowerCase())) continue;
    if (st.attributedConversions14d < 2) continue;
    const cvr = st.clicks > 0 ? st.attributedConversions14d / st.clicks : 0;
    const suggestedBid = st.clicks > 0
      ? parseFloat((st.cost / st.clicks * 1.1).toFixed(2))
      : 0.50;
    recs.push({
      id: `add-keyword-${st.query.replace(/\s+/g, "-")}`,
      type: "add_keyword",
      priority: st.attributedConversions14d >= 3 ? "high" : "medium",
      title: `Aggiungi keyword: "${st.query}"`,
      description: `${st.attributedConversions14d} conversioni · CVR ${(cvr * 100).toFixed(0)}% · non presente nelle keyword manuali`,
      action: `Aggiungi come exact match · offerta consigliata €${suggestedBid.toFixed(2)}`,
      expectedImpact: `ACoS stimato ${st.attributedSales14d > 0 ? ((st.cost / st.attributedSales14d) * 100).toFixed(0) : "n/d"}%`,
      data: { query: st.query, campaignName: st.campaignName, conversions: st.attributedConversions14d, suggestedBid },
      timestamp: new Date().toISOString(),
    });
  }

  // 4. Budget sottoutilizzato + ACoS ok → alza offerte
  for (const cs of campaignStats) {
    if (cs.state !== "enabled" || cs.cost === 0) continue;
    const days = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1);
    const totalBudget = (cs.dailyBudget / 100) * days;
    const spendRatio = cs.cost / totalBudget;
    if (spendRatio < 0.5 && cs.acos !== null && cs.acos < ACOS_TARGET) {
      recs.push({
        id: `budget-underuse-${cs.campaignId}`,
        type: "bid_increase",
        priority: "low",
        title: `Budget sottoutilizzato: "${cs.name}"`,
        description: `Solo ${(spendRatio * 100).toFixed(0)}% del budget usato · €${cs.cost.toFixed(2)}/€${totalBudget.toFixed(2)} · ACoS ${(cs.acos * 100).toFixed(0)}%`,
        action: `Aumenta le offerte del 15-20% sulle keyword top per sfruttare il budget`,
        expectedImpact: `+${Math.round(cs.orders * 0.2)} ordini stimati nel periodo`,
        data: { campaignId: cs.campaignId, spendRatio, currentAcos: cs.acos },
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 5. ACoS alert — campagne sopra target
  for (const cs of campaignStats) {
    if (cs.state !== "enabled" || cs.sales <= 0 || cs.acos === null) continue;
    if (cs.acos > ACOS_TARGET) {
      recs.push({
        id: `acos-alert-${cs.campaignId}`,
        type: "acos_alert",
        priority: cs.acos > 0.80 ? "high" : "medium",
        title: `ACoS elevato: "${cs.name}"`,
        description: `ACoS ${(cs.acos * 100).toFixed(0)}% vs target ${(ACOS_TARGET * 100).toFixed(0)}% · €${cs.cost.toFixed(2)} spesi · €${cs.sales.toFixed(2)} vendite`,
        action: `Rivedi le offerte e metti in pausa le keyword meno performanti`,
        expectedImpact: `Riduzione ACoS a ~${(ACOS_TARGET * 100).toFixed(0)}%`,
        data: { campaignId: cs.campaignId, acos: cs.acos, cost: cs.cost, sales: cs.sales },
        timestamp: new Date().toISOString(),
      });
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => order[a.priority] - order[b.priority]);
  return recs;
}

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    // Health
    if (path === "/api/health") {
      return json(res, { ok: true, ts: Date.now(), mock: process.env.USE_MOCK !== "false" });
    }

    // Campaigns
    if (path === "/api/campaigns" && req.method === "GET") {
      const stateFilter = url.searchParams.get("state");
      const startDate   = url.searchParams.get("startDate") || daysAgoStr(7);
      const endDate     = url.searchParams.get("endDate")   || todayStr();
      const result = await amazon.getCampaigns();
      let campaigns = result.data;
      if (stateFilter && stateFilter !== "all") campaigns = campaigns.filter(c => c.state === stateFilter);
      const data = campaigns.map(c => aggregateCampaignStats(c, startDate, endDate));
      return json(res, data, result.ok ? 200 : 500);
    }

    if (path === "/api/campaigns" && req.method === "PUT") {
      const body = await readBody(req);
      const result = await amazon.updateCampaign(body.campaignId, body.updates);
      return json(res, result.data, result.ok ? 200 : 500);
    }

    // Summary
    if (path === "/api/summary" && req.method === "GET") {
      const startDate   = url.searchParams.get("startDate") || daysAgoStr(7);
      const endDate     = url.searchParams.get("endDate")   || todayStr();
      const stateFilter = url.searchParams.get("state");
      let campaigns = activeCampaigns();
      if (stateFilter && stateFilter !== "all") campaigns = campaigns.filter(c => c.state === stateFilter);
      const stats = campaigns.map(c => aggregateCampaignStats(c, startDate, endDate));
      const t = stats.reduce(
        (acc, s) => ({ cost: acc.cost+s.cost, clicks: acc.clicks+s.clicks, impressions: acc.impressions+s.impressions, orders: acc.orders+s.orders, sales: acc.sales+s.sales }),
        { cost: 0, clicks: 0, impressions: 0, orders: 0, sales: 0 }
      );
      return json(res, {
        cost:         parseFloat(t.cost.toFixed(2)),
        clicks:       t.clicks,
        impressions:  t.impressions,
        orders:       t.orders,
        sales:        parseFloat(t.sales.toFixed(2)),
        acos:         t.sales > 0 ? parseFloat((t.cost/t.sales).toFixed(4)) : null,
        ctr:          t.impressions > 0 ? parseFloat((t.clicks/t.impressions).toFixed(4)) : 0,
        cpc:          t.clicks > 0 ? parseFloat((t.cost/t.clicks).toFixed(2)) : 0,
        roas:         t.cost > 0 ? parseFloat((t.sales/t.cost).toFixed(2)) : null,
        activeCampaigns: stats.filter(s => s.state === "enabled").length,
        startDate, endDate,
      });
    }

    // Chart
    if (path === "/api/chart" && req.method === "GET") {
      const startDate   = url.searchParams.get("startDate") || daysAgoStr(7);
      const endDate     = url.searchParams.get("endDate")   || todayStr();
      const stateFilter = url.searchParams.get("state");
      let campaigns = activeCampaigns();
      if (stateFilter && stateFilter !== "all") campaigns = campaigns.filter(c => c.state === stateFilter);
      const byDate = {};
      for (const camp of campaigns) {
        for (const s of (camp.dailyStats || [])) {
          if (s.date < startDate || s.date > endDate) continue;
          if (!byDate[s.date]) byDate[s.date] = { date: s.date, cost: 0, clicks: 0, impressions: 0, orders: 0, sales: 0 };
          byDate[s.date].cost        += s.cost;
          byDate[s.date].clicks      += s.clicks;
          byDate[s.date].impressions += s.impressions;
          byDate[s.date].orders      += s.orders;
          byDate[s.date].sales       += s.sales;
        }
      }
      const rows = Object.values(byDate).sort((a,b) => a.date.localeCompare(b.date)).map(r => ({
        ...r,
        cost:  parseFloat(r.cost.toFixed(2)),
        sales: parseFloat(r.sales.toFixed(2)),
        acos:  r.sales > 0 ? parseFloat((r.cost/r.sales).toFixed(4)) : null,
      }));
      return json(res, rows);
    }

    // Keywords
    if (path === "/api/keywords" && req.method === "GET") {
      const campaignId  = url.searchParams.get("campaignId");
      const stateFilter = url.searchParams.get("state");
      const result = await amazon.getKeywords(campaignId);
      let data = result.data;
      if (stateFilter) data = data.filter(k => k.state === stateFilter);
      return json(res, data, result.ok ? 200 : 500);
    }

    if (path === "/api/keywords/bid" && req.method === "PUT") {
      const body = await readBody(req);
      const result = await amazon.updateKeyword(body.keywordId, body.bid);
      return json(res, result.data, result.ok ? 200 : 500);
    }

    if (path === "/api/keywords/pause" && req.method === "PUT") {
      const body = await readBody(req);
      const result = await amazon.pauseKeyword(body.keywordId);
      return json(res, result.data, result.ok ? 200 : 500);
    }

    if (path === "/api/keywords/negative" && req.method === "POST") {
      const body = await readBody(req);
      const result = await amazon.addNegativeKeyword(body.campaignId, body.adGroupId, body.keywordText);
      return json(res, result.data, result.ok ? 200 : 500);
    }

    if (path === "/api/adgroups" && req.method === "GET") {
      const campaignId = url.searchParams.get("campaignId");
      const result = await amazon.getAdGroups(campaignId);
      return json(res, result.data, result.ok ? 200 : 500);
    }

    if (path === "/api/report/request" && req.method === "POST") {
      const result = await amazon.requestSearchTermReport();
      return json(res, result.data, result.ok ? 200 : 500);
    }

    if (path.startsWith("/api/report/") && path.split("/").length === 4 && req.method === "GET") {
      const reportId = path.split("/")[3];
      const result = await amazon.getReport(reportId);
      return json(res, result.data, result.ok ? 200 : 500);
    }

    if (path === "/api/report/download" && req.method === "POST") {
      const body = await readBody(req);
      const data = await amazon.downloadReport(body.url);
      return json(res, data);
    }

    // AI Recommendations
    if (path === "/api/ai/recommendations" && req.method === "GET") {
      const startDate = url.searchParams.get("startDate") || daysAgoStr(7);
      const endDate   = url.searchParams.get("endDate")   || todayStr();
      const recs = generateAIRecommendations(startDate, endDate);
      return json(res, { ok: true, count: recs.length, recommendations: recs, generatedAt: new Date().toISOString() });
    }

    // AI Apply
    if (path === "/api/ai/apply" && req.method === "POST") {
      const body = await readBody(req);
      const { recommendationId, type, data: actionData } = body;
      console.log(`[AI APPLY] ${type}: ${JSON.stringify(actionData)}`);
      if (type === "bid_reduce" && actionData?.keywordId) {
        const kw = activeKeywords().find(k => k.keywordId === actionData.keywordId);
        if (kw) kw.bid = actionData.suggestedBid;
      }
      return json(res, { ok: true, applied: recommendationId, timestamp: new Date().toISOString() });
    }

    // ── CSV Upload ──────────────────────────────────────────────────────────────
    // POST /api/csv/upload  — body: raw CSV text (Content-Type: text/plain o multipart)
    if (path === "/api/csv/upload" && req.method === "POST") {
      const contentType = req.headers["content-type"] || "";
      let csvText = "";

      if (contentType.includes("multipart/form-data")) {
        // Estrai testo dal multipart (cerca il body dopo headers vuoti)
        const raw = await readRawBody(req);
        const boundary = contentType.split("boundary=")[1];
        if (boundary) {
          const parts = raw.split("--" + boundary);
          for (const part of parts) {
            if (part.includes("filename=") || part.includes('name="file"') || part.includes('name="csv"')) {
              const bodyStart = part.indexOf("\r\n\r\n");
              if (bodyStart !== -1) {
                csvText = part.slice(bodyStart + 4).replace(/\r\n--$/, "").trim();
                break;
              }
            }
          }
          // fallback: prendi qualsiasi parte con contenuto
          if (!csvText) {
            for (const part of parts) {
              const bodyStart = part.indexOf("\r\n\r\n");
              if (bodyStart !== -1) {
                const candidate = part.slice(bodyStart + 4).replace(/\r\n--$/, "").trim();
                if (candidate.length > 10) { csvText = candidate; break; }
              }
            }
          }
        }
      } else {
        // text/plain o application/octet-stream
        csvText = await readRawBody(req);
      }

      if (!csvText || csvText.length < 10) {
        return json(res, { ok: false, error: "CSV vuoto o non leggibile" }, 400);
      }

      const result = parseAmazonCSV(csvText);
      if (!result.ok) {
        return json(res, result, 400);
      }

      csvStore = result;
      console.log(`[CSV UPLOAD] ${result.rowCount} righe · ${result.campaigns.length} campagne · ${result.type}`);

      return json(res, {
        ok: true,
        message: `Importato: ${result.rowCount} righe, ${result.campaigns.length} campagne`,
        type: result.type,
        campaigns: result.campaigns.length,
        keywords: result.keywords.length,
        searchTerms: result.searchTerms.length,
        dateRange: result.dateRange,
        uploadedAt: result.uploadedAt,
      });
    }

    // GET /api/csv/status — controlla se c'è un CSV caricato
    if (path === "/api/csv/status" && req.method === "GET") {
      if (!csvStore) {
        return json(res, { hasData: false, source: "mock" });
      }
      return json(res, {
        hasData: true,
        source: "csv",
        type: csvStore.type,
        campaigns: csvStore.campaigns.length,
        keywords: csvStore.keywords.length,
        searchTerms: csvStore.searchTerms.length,
        dateRange: csvStore.dateRange,
        uploadedAt: csvStore.uploadedAt,
        rowCount: csvStore.rowCount,
      });
    }

    // DELETE /api/csv/clear — torna ai dati mock
    if (path === "/api/csv/clear" && req.method === "DELETE") {
      csvStore = null;
      return json(res, { ok: true, message: "Dati CSV rimossi, tornato ai dati mock" });
    }

    json(res, { error: "Not found" }, 404);
  } catch (err) {
    console.error(err);
    json(res, { error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`API ready on :${PORT} | ACoS target ${(ACOS_TARGET*100).toFixed(0)}% | Budget max €${DAILY_BUDGET_MAX}`);
});
