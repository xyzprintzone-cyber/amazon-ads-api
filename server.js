import { createServer } from "http";
import * as amazon from "./amazon.js";
import { mockCampaigns, mockKeywords, mockSearchTerms } from "./mock-data.js";

const PORT = process.env.PORT || 8787;
const ACOS_TARGET = parseFloat(process.env.ACOS_TARGET || "0.40");
const DAILY_BUDGET_MAX = parseFloat(process.env.DAILY_BUDGET_MAX || "30.00");


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

// ── Date helpers ──────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

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
  const ctr = agg.impressions > 0 ? agg.clicks / agg.impressions : 0;
  const cpc = agg.clicks > 0 ? agg.cost / agg.clicks : 0;
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

// ── AI Recommendations Engine ─────────────────────────────────────────────────
function generateAIRecommendations(startDate, endDate) {
  const recs = [];

  // Aggrega dati campagne per il periodo selezionato
  const campaignStats = mockCampaigns.map(c => aggregateCampaignStats(c, startDate, endDate));

  // 1. Keywords con ACoS > target e abbastanza click
  for (const kw of mockKeywords) {
    if (kw.state !== "enabled") continue;
    const acos = kw.attributedSales14d > 0
      ? (kw.cost / kw.attributedSales14d)
      : (kw.clicks >= 5 ? 999 : null);

    if (acos !== null && acos > ACOS_TARGET && kw.clicks >= 5) {
      const currentBid = kw.bid;
      const suggestedBid = acos < 999
        ? Math.max(0.10, parseFloat((currentBid * (ACOS_TARGET / acos)).toFixed(2)))
        : parseFloat((currentBid * 0.70).toFixed(2));

      recs.push({
        id: `bid-reduce-${kw.keywordId}`,
        type: "bid_reduce",
        priority: acos > 1.0 ? "high" : "medium",
        title: `Riduci offerta: "${kw.keywordText}"`,
        description: `ACoS ${acos === 999 ? "∞" : (acos * 100).toFixed(0)}% (target ${(ACOS_TARGET * 100).toFixed(0)}%) · ${kw.clicks} click, nessuna conversione recente.`,
        action: `Riduci da €${currentBid.toFixed(2)} → €${suggestedBid.toFixed(2)}`,
        expectedImpact: acos < 999
          ? `ACoS stimato: ~${(ACOS_TARGET * 100).toFixed(0)}%`
          : `Risparmio: ~€${((currentBid - suggestedBid) * kw.clicks / 30).toFixed(2)}/gg`,
        data: { keywordId: kw.keywordId, keywordText: kw.keywordText, currentBid, suggestedBid, acos },
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 2. Search terms con click ≥ 5 e 0 conversioni → negativa
  const existingKeywordTexts = new Set(mockKeywords.map(k => k.keywordText.toLowerCase()));
  for (const st of mockSearchTerms) {
    if (st.clicks >= 5 && st.attributedConversions14d === 0) {
      recs.push({
        id: `negative-${st.query.replace(/\s+/g, "-")}`,
        type: "add_negative",
        priority: st.clicks >= 20 ? "high" : "medium",
        title: `Keyword negativa: "${st.query}"`,
        description: `${st.clicks} click · €${st.cost.toFixed(2)} spesi · 0 conversioni in "${st.campaignName}"`,
        action: `Aggiungi "${st.query}" come negativa (exact)`,
        expectedImpact: `Risparmio stimato: ~€${(st.cost * 0.8).toFixed(2)} nel periodo`,
        data: { query: st.query, campaignName: st.campaignName, clicks: st.clicks, cost: st.cost },
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 3. Search term ad alta conversione non in keyword → aggiungi
  for (const st of mockSearchTerms) {
    const alreadyKeyword = existingKeywordTexts.has(st.query.toLowerCase());
    if (!alreadyKeyword && st.attributedConversions14d >= 2) {
      const cvr = st.clicks > 0 ? st.attributedConversions14d / st.clicks : 0;
      const suggestedBid = st.clicks > 0
        ? parseFloat((st.cost / st.clicks * 1.1).toFixed(2))
        : 0.50;

      recs.push({
        id: `add-keyword-${st.query.replace(/\s+/g, "-")}`,
        type: "add_keyword",
        priority: st.attributedConversions14d >= 3 ? "high" : "medium",
        title: `Aggiungi keyword: "${st.query}"`,
        description: `${st.attributedConversions14d} conversioni · CVR ${(cvr * 100).toFixed(0)}% · non in keyword manuali`,
        action: `Aggiungi come exact match · offerta consigliata €${suggestedBid.toFixed(2)}`,
        expectedImpact: `ACoS stimato: ${st.attributedSales14d > 0 ? ((st.cost / st.attributedSales14d) * 100).toFixed(0) : "n/d"}%`,
        data: { query: st.query, campaignName: st.campaignName, conversions: st.attributedConversions14d, suggestedBid },
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 4. Budget sottoutilizzato + ACoS sotto target → alzare le offerte
  for (const cs of campaignStats) {
    if (cs.state !== "enabled" || cs.cost === 0) continue;
    const budgetEur = cs.dailyBudget / 100;
    const days = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1);
    const totalBudget = budgetEur * days;
    const spendRatio = cs.cost / totalBudget;

    if (spendRatio < 0.5 && cs.acos !== null && cs.acos < ACOS_TARGET) {
      recs.push({
        id: `budget-underuse-${cs.campaignId}`,
        type: "bid_increase",
        priority: "low",
        title: `Budget sottoutilizzato: "${cs.name}"`,
        description: `Usa solo ${(spendRatio * 100).toFixed(0)}% del budget · €${cs.cost.toFixed(2)}/€${totalBudget.toFixed(2)} · ACoS ${cs.acos !== null ? (cs.acos * 100).toFixed(0) : "n/d"}%`,
        action: `Aumenta le offerte del 15-20% sulle keyword top`,
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
        description: `ACoS ${(cs.acos * 100).toFixed(0)}% vs target ${(ACOS_TARGET * 100).toFixed(0)}% · Spesa €${cs.cost.toFixed(2)} · Vendite €${cs.sales.toFixed(2)}`,
        action: `Rivedi le offerte e metti in pausa le keyword meno performanti`,
        expectedImpact: `Riduzione ACoS a ~${(ACOS_TARGET * 100).toFixed(0)}% con le bid suggestion`,
        data: { campaignId: cs.campaignId, acos: cs.acos, cost: cs.cost, sales: cs.sales },
        timestamp: new Date().toISOString(),
      });
    }
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
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
    if (path === "/api/health") {
      return json(res, { ok: true, ts: Date.now(), mock: process.env.USE_MOCK !== "false" });
    }

    // ── Campaigns con date range ─────────────────────────────────────────────
    if (path === "/api/campaigns" && req.method === "GET") {
      const stateFilter = url.searchParams.get("state");
      const startDate = url.searchParams.get("startDate") || daysAgo_str(7);
      const endDate   = url.searchParams.get("endDate")   || todayStr();

      const result = await amazon.getCampaigns();
      let campaigns = result.data;
      if (stateFilter) campaigns = campaigns.filter(c => c.state === stateFilter);

      // Aggrega dati per il range richiesto
      const data = campaigns.map(c => aggregateCampaignStats(c, startDate, endDate));
      return json(res, data, result.ok ? 200 : 500);
    }

    if (path === "/api/campaigns" && req.method === "PUT") {
      const body = await readBody(req);
      const result = await amazon.updateCampaign(body.campaignId, body.updates);
      return json(res, result.data, result.ok ? 200 : 500);
    }

    // ── Summary stats per il date range ─────────────────────────────────────
    if (path === "/api/summary" && req.method === "GET") {
      const startDate = url.searchParams.get("startDate") || daysAgo_str(7);
      const endDate   = url.searchParams.get("endDate")   || todayStr();
      const stateFilter = url.searchParams.get("state");

      let campaigns = mockCampaigns;
      if (stateFilter) campaigns = campaigns.filter(c => c.state === stateFilter);

      const stats = campaigns.map(c => aggregateCampaignStats(c, startDate, endDate));
      const totals = stats.reduce(
        (acc, s) => ({
          cost: acc.cost + s.cost,
          clicks: acc.clicks + s.clicks,
          impressions: acc.impressions + s.impressions,
          orders: acc.orders + s.orders,
          sales: acc.sales + s.sales,
        }),
        { cost: 0, clicks: 0, impressions: 0, orders: 0, sales: 0 }
      );

      const acos = totals.sales > 0 ? totals.cost / totals.sales : null;
      const ctr  = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
      const cpc  = totals.clicks > 0 ? totals.cost / totals.clicks : 0;
      const roas = totals.cost > 0 ? totals.sales / totals.cost : null;

      return json(res, {
        cost: parseFloat(totals.cost.toFixed(2)),
        clicks: totals.clicks,
        impressions: totals.impressions,
        orders: totals.orders,
        sales: parseFloat(totals.sales.toFixed(2)),
        acos: acos !== null ? parseFloat(acos.toFixed(4)) : null,
        ctr: parseFloat(ctr.toFixed(4)),
        cpc: parseFloat(cpc.toFixed(2)),
        roas: roas !== null ? parseFloat(roas.toFixed(2)) : null,
        activeCampaigns: stats.filter(s => s.state === "enabled").length,
        startDate,
        endDate,
      });
    }

    // ── Daily chart data ────────────────────────────────────────────────────
    if (path === "/api/chart" && req.method === "GET") {
      const startDate = url.searchParams.get("startDate") || daysAgo_str(7);
      const endDate   = url.searchParams.get("endDate")   || todayStr();
      const stateFilter = url.searchParams.get("state");

      let campaigns = mockCampaigns;
      if (stateFilter) campaigns = campaigns.filter(c => c.state === stateFilter);

      // Aggrega per giorno su tutte le campagne
      const byDate = {};
      for (const camp of campaigns) {
        for (const s of (camp.dailyStats || [])) {
          if (s.date < startDate || s.date > endDate) continue;
          if (!byDate[s.date]) byDate[s.date] = { date: s.date, cost: 0, clicks: 0, impressions: 0, orders: 0, sales: 0 };
          byDate[s.date].cost += s.cost;
          byDate[s.date].clicks += s.clicks;
          byDate[s.date].impressions += s.impressions;
          byDate[s.date].orders += s.orders;
          byDate[s.date].sales += s.sales;
        }
      }

      const rows = Object.values(byDate)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(r => ({
          ...r,
          cost: parseFloat(r.cost.toFixed(2)),
          sales: parseFloat(r.sales.toFixed(2)),
          acos: r.sales > 0 ? parseFloat((r.cost / r.sales).toFixed(4)) : null,
        }));

      return json(res, rows);
    }

    if (path === "/api/keywords" && req.method === "GET") {
      const campaignId = url.searchParams.get("campaignId");
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

    // ── AI Recommendations ─────────────────────────────────────────────────
    if (path === "/api/ai/recommendations" && req.method === "GET") {
      const startDate = url.searchParams.get("startDate") || daysAgo_str(7);
      const endDate   = url.searchParams.get("endDate")   || todayStr();
      const recs = generateAIRecommendations(startDate, endDate);
      return json(res, { ok: true, count: recs.length, recommendations: recs, generatedAt: new Date().toISOString() });
    }

    if (path === "/api/ai/apply" && req.method === "POST") {
      const body = await readBody(req);
      const { recommendationId, type, data: actionData } = body;
      console.log(`[AI APPLY] ${type}: ${JSON.stringify(actionData)}`);
      if (type === "bid_reduce" && actionData?.keywordId) {
        const kw = mockKeywords.find(k => k.keywordId === actionData.keywordId);
        if (kw) kw.bid = actionData.suggestedBid;
      }
      return json(res, { ok: true, applied: recommendationId, timestamp: new Date().toISOString() });
    }

    json(res, { error: "Not found" }, 404);
  } catch (err) {
    console.error(err);
    json(res, { error: err.message }, 500);
  }
});


server.listen(PORT, () => {
  console.log(`API running on port ${PORT} | ACoS target: ${(ACOS_TARGET * 100).toFixed(0)}% | Budget max: €${DAILY_BUDGET_MAX}`);
});
