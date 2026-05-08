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

// ── AI Recommendations Engine ─────────────────────────────────────────────────
function generateAIRecommendations() {
  const recs = [];

  // 1. Keywords with high ACoS > target AND enough clicks to be significant
  for (const kw of mockKeywords) {
    if (kw.state !== "enabled") continue;
    const acos = kw.attributedSales14d > 0
      ? (kw.cost / kw.attributedSales14d)
      : (kw.clicks >= 5 ? 999 : null);

    if (acos !== null && acos > ACOS_TARGET && kw.clicks >= 5) {
      const currentBid = kw.bid;
      // Suggested bid: reduce to aim for target ACoS
      const suggestedBid = acos < 999
        ? Math.max(0.10, parseFloat((currentBid * (ACOS_TARGET / acos)).toFixed(2)))
        : parseFloat((currentBid * 0.70).toFixed(2));

      recs.push({
        id: `bid-reduce-${kw.keywordId}`,
        type: "bid_reduce",
        priority: acos > 1.0 ? "high" : "medium",
        title: `Riduci offerta: "${kw.keywordText}"`,
        description: `Keyword con ACoS ${acos === 999 ? "∞" : (acos * 100).toFixed(0)}% (target: ${(ACOS_TARGET * 100).toFixed(0)}%). ${kw.clicks} click, nessuna conversione recente.`,
        action: `Riduci offerta da €${currentBid.toFixed(2)} → €${suggestedBid.toFixed(2)}`,
        expectedImpact: acos < 999
          ? `ACoS stimato: ${(ACOS_TARGET * 100).toFixed(0)}% (-${((acos - ACOS_TARGET) * 100).toFixed(0)}pp)`
          : `Risparmio stimato: €${((currentBid - suggestedBid) * kw.clicks / 30).toFixed(2)}/giorno`,
        data: { keywordId: kw.keywordId, keywordText: kw.keywordText, currentBid, suggestedBid, acos },
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 2. Search terms with clicks≥5 and 0 conversions → suggest negative
  const existingKeywordTexts = new Set(mockKeywords.map(k => k.keywordText.toLowerCase()));
  for (const st of mockSearchTerms) {
    if (st.clicks >= 5 && st.attributedConversions14d === 0) {
      recs.push({
        id: `negative-${st.query.replace(/\s+/g, "-")}`,
        type: "add_negative",
        priority: st.clicks >= 20 ? "high" : "medium",
        title: `Aggiungi keyword negativa: "${st.query}"`,
        description: `Search term con ${st.clicks} click e €${st.cost.toFixed(2)} spesi senza conversioni nella campagna "${st.campaignName}".`,
        action: `Aggiungi "${st.query}" come keyword negativa (exact)`,
        expectedImpact: `Risparmio stimato: ~€${(st.cost * 0.8).toFixed(2)} nel periodo`,
        data: { query: st.query, campaignName: st.campaignName, clicks: st.clicks, cost: st.cost },
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 3. High-converting search terms NOT in keywords → suggest adding
  for (const st of mockSearchTerms) {
    const queryLower = st.query.toLowerCase();
    const alreadyKeyword = existingKeywordTexts.has(queryLower);
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
        description: `Search term con ${st.attributedConversions14d} conversioni e CVR ${(cvr * 100).toFixed(0)}% non presente nelle keyword manuali.`,
        action: `Aggiungi "${st.query}" come keyword exact con offerta €${suggestedBid.toFixed(2)}`,
        expectedImpact: `Stima: ${st.attributedConversions14d} conversioni/periodo, ACoS ${st.attributedSales14d > 0 ? ((st.cost / st.attributedSales14d) * 100).toFixed(0) : "n/d"}%`,
        data: { query: st.query, campaignName: st.campaignName, conversions: st.attributedConversions14d, suggestedBid },
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 4. Campaigns spending < 50% of budget → suggest bid boost on top keywords
  for (const camp of mockCampaigns) {
    if (camp.state !== "enabled") continue;
    const budgetEur = camp.dailyBudget / 100;
    const spendRatio = camp.cost / budgetEur;

    if (spendRatio < 0.5 && camp.cost > 0) {
      const campAcos = camp.attributedSales14d > 0 ? camp.cost / camp.attributedSales14d : null;
      if (campAcos !== null && campAcos < ACOS_TARGET) {
        recs.push({
          id: `budget-underuse-${camp.campaignId}`,
          type: "bid_increase",
          priority: "low",
          title: `Budget sottoutilizzato: "${camp.name}"`,
          description: `Campagna usa solo ${(spendRatio * 100).toFixed(0)}% del budget (€${camp.cost.toFixed(2)}/€${budgetEur.toFixed(2)}) con ACoS ${(campAcos * 100).toFixed(0)}% — sotto il target.`,
          action: `Aumenta le offerte del 15-20% sulle keyword top per sfruttare il budget`,
          expectedImpact: `Incremento vendite stimato: +${Math.round(camp.attributedConversions14d * 0.2)} ordini/periodo`,
          data: { campaignId: camp.campaignId, spendRatio, currentAcos: campAcos },
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // 5. ACoS alerts — campaigns over target
  for (const camp of mockCampaigns) {
    if (camp.state !== "enabled" || camp.attributedSales14d <= 0) continue;
    const acos = camp.cost / camp.attributedSales14d;
    if (acos > ACOS_TARGET) {
      recs.push({
        id: `acos-alert-${camp.campaignId}`,
        type: "acos_alert",
        priority: acos > 0.80 ? "high" : "medium",
        title: `⚠ ACoS elevato: "${camp.name}"`,
        description: `Campagna con ACoS ${(acos * 100).toFixed(0)}% (target: ${(ACOS_TARGET * 100).toFixed(0)}%). Spesa €${camp.cost.toFixed(2)} su €${camp.attributedSales14d.toFixed(2)} vendite.`,
        action: `Rivedi le offerte e considera di mettere in pausa le keyword meno performanti`,
        expectedImpact: `Riduzione ACoS a ~${(ACOS_TARGET * 100).toFixed(0)}% se applicate le bid suggestion`,
        data: { campaignId: camp.campaignId, acos, cost: camp.cost, sales: camp.attributedSales14d },
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Sort: high → medium → low
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

    if (path === "/api/campaigns" && req.method === "GET") {
      const stateFilter = url.searchParams.get("state"); // "enabled" | "paused" | null (all)
      const result = await amazon.getCampaigns();
      let data = result.data;
      if (stateFilter) data = data.filter(c => c.state === stateFilter);
      return json(res, data, result.ok ? 200 : 500);
    }

    if (path === "/api/campaigns" && req.method === "PUT") {
      const body = await readBody(req);
      const result = await amazon.updateCampaign(body.campaignId, body.updates);
      return json(res, result.data, result.ok ? 200 : 500);
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

    // ── AI Recommendations ──────────────────────────────────────────────────
    if (path === "/api/ai/recommendations" && req.method === "GET") {
      const recs = generateAIRecommendations();
      return json(res, { ok: true, count: recs.length, recommendations: recs, generatedAt: new Date().toISOString() });
    }

    // ── AI Apply (mock — logs action, returns success) ──────────────────────
    if (path === "/api/ai/apply" && req.method === "POST") {
      const body = await readBody(req);
      const { recommendationId, type, data: actionData } = body;
      console.log(`[AI APPLY] ${type}: ${JSON.stringify(actionData)}`);

      // Actually apply changes to mock data
      if (type === "bid_reduce" && actionData?.keywordId) {
        const kw = mockKeywords.find(k => k.keywordId === actionData.keywordId);
        if (kw) kw.bid = actionData.suggestedBid;
      }
      if (type === "add_negative") {
        // Would call addNegativeKeyword in real scenario
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
