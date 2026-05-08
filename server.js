// server.js — XYZ Print Zone Amazon Ads API
// Real data from Amazon Advertising API v3 + GPT-4o auto-optimization

import { createServer } from "http";
import * as amazon from "./amazon-real.js";
import { analyzeWithAI, executeAutoActions, applyRules } from "./ai-engine.js";

const PORT = process.env.PORT || 8787;
const ACOS_TARGET = parseFloat(process.env.ACOS_TARGET || "0.40");
const BUDGET_MAX = parseFloat(process.env.DAILY_BUDGET_MAX || "30.00");

// ── In-memory cache ───────────────────────────────────────────────────────────
const cache = {
  campaigns: null,      // { data, ts }
  keywords: null,
  adGroups: null,
  // Report caches: { data, ts, status: "ready"|"fetching"|"error", error? }
  campaignPerf: null,
  keywordPerf: null,
  searchTermPerf: null,
  lastOptimization: null,
};
const CACHE_TTL       = 5  * 60 * 1000;  // 5 min — campaigns/kw
const REPORT_TTL      = 60 * 60 * 1000;  // 1 hr  — report data

// Pending confirmations queue (actions AI wants to take but need approval)
const pendingActions = [];
const actionLog      = [];

function logAction(type, description, params = {}, success = true) {
  actionLog.unshift({ id: Date.now().toString(), type, description, params, success, timestamp: new Date().toISOString() });
  if (actionLog.length > 200) actionLog.pop();
  console.log(`[${success ? "OK" : "ERR"}] ${type}: ${description}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function today()      { return new Date().toISOString().slice(0, 10); }
function daysAgoStr(n){ const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

function json(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  return new Promise(resolve => {
    let b = "";
    req.on("data", c => b += c);
    req.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } });
  });
}

function isCacheValid(entry, ttl = CACHE_TTL) {
  return entry && (Date.now() - entry.ts) < ttl;
}

// ── Data Loaders ─────────────────────────────────────────────────────────────
function normalizeCampaign(c) {
  return {
    campaignId:   c.campaignId,
    name:         c.name,
    state:        c.state,
    targetingType:c.targetingType,
    budget:       c.budget?.budget ?? c.dynamicBidding?.budget ?? 0,
    budgetType:   c.budget?.budgetType ?? "DAILY",
    startDate:    c.startDate,
    endDate:      c.endDate,
    bidding:      c.dynamicBidding,
  };
}

async function loadCampaigns(forceRefresh = false) {
  if (!forceRefresh && isCacheValid(cache.campaigns)) return cache.campaigns.data;
  const { ok, data } = await amazon.getCampaigns();
  if (!ok) throw new Error("getCampaigns failed: " + JSON.stringify(data));
  const campaigns = (data.campaigns || []).map(normalizeCampaign);
  cache.campaigns = { data: campaigns, ts: Date.now() };
  return campaigns;
}

async function loadKeywords(campaignId = null, forceRefresh = false) {
  if (!forceRefresh && isCacheValid(cache.keywords)) return cache.keywords.data;
  const { ok, data } = await amazon.getKeywords(campaignId);
  if (!ok) throw new Error("getKeywords failed: " + JSON.stringify(data));
  const kws = (data.keywords || []).map(k => ({
    keywordId:  k.keywordId,
    campaignId: k.campaignId,
    adGroupId:  k.adGroupId,
    keywordText:k.keywordText,
    matchType:  k.matchType,
    state:      k.state,
    bid:        k.bid?.bidValue ?? 0,
  }));
  cache.keywords = { data: kws, ts: Date.now() };
  return kws;
}

// ── Background Report Fetcher ─────────────────────────────────────────────────
// Returns cached data immediately if fresh. Starts background fetch if stale/missing.
// Frontend can poll — will get data within 2-5 minutes when report completes.

function startReportFetch(cacheKey, fetchFn) {
  if (cache[cacheKey] && cache[cacheKey].status === "fetching") return; // already in progress
  if (isCacheValid(cache[cacheKey], REPORT_TTL) && cache[cacheKey].status === "ready") return; // fresh

  cache[cacheKey] = { data: cache[cacheKey]?.data || null, ts: cache[cacheKey]?.ts || 0, status: "fetching" };
  console.log(`[REPORT] Starting background fetch: ${cacheKey}`);

  fetchFn().then(data => {
    cache[cacheKey] = { data, ts: Date.now(), status: "ready" };
    console.log(`[REPORT] ${cacheKey} ready — ${Array.isArray(data) ? data.length : "?"} rows`);
  }).catch(err => {
    cache[cacheKey] = { data: cache[cacheKey]?.data || null, ts: cache[cacheKey]?.ts || 0, status: "error", error: err.message };
    console.error(`[REPORT] ${cacheKey} error: ${err.message}`);
  });
}

function getCachedReport(cacheKey) {
  const e = cache[cacheKey];
  return {
    status:    e?.status || "idle",
    data:      e?.data   || null,
    ts:        e?.ts     || null,
    error:     e?.error  || null,
    ageMin:    e?.ts ? Math.round((Date.now() - e.ts) / 60000) : null,
  };
}

// ── Aggregation ───────────────────────────────────────────────────────────────
// Helper: normalize spend field (API uses 'spend' for campaigns, 'cost' for keywords)
function normSpend(r) { return r.spend || r.cost || 0; }
// Helper: normalize sales (API uses sales14d or sales7d)
function normSales(r)  { return r.sales14d || r.sales7d || r.attributedSales14d || 0; }
// Helper: normalize orders (API uses purchases14d)
function normOrders(r) { return r.purchases14d || r.purchases7d || r.orders || r.attributedConversions14d || 0; }

function aggregateReportByCampaign(rows) {
  const map = {};
  for (const r of rows) {
    const k = r.campaignId || r.campaignName;
    if (!map[k]) map[k] = { campaignId: r.campaignId, campaignName: r.campaignName, spend:0, clicks:0, impressions:0, orders:0, sales:0 };
    map[k].spend       += normSpend(r);
    map[k].clicks      += r.clicks      || 0;
    map[k].impressions += r.impressions || 0;
    map[k].orders      += normOrders(r);
    map[k].sales       += normSales(r);
  }
  return Object.values(map).map(c => ({
    ...c,
    acos:  c.sales > 0 ? c.spend / c.sales : null,
    roas:  c.spend > 0 ? c.sales / c.spend : null,
    ctr:   c.impressions > 0 ? c.clicks / c.impressions : null,
    cpc:   c.clicks > 0 ? c.spend / c.clicks : null,
  }));
}

function aggregateReportByKeyword(rows) {
  const map = {};
  for (const r of rows) {
    const k = r.keywordId || `${r.keywordText}-${r.matchType}`;
    if (!map[k]) map[k] = {
      keywordId:   r.keywordId,
      keywordText: r.keywordText || r.keyword,
      matchType:   r.matchType,
      campaignId:  r.campaignId,
      campaignName:r.campaignName,
      adGroupId:   r.adGroupId,
      adGroupName: r.adGroupName,
      state:       r.adKeywordStatus,
      bid:         r.keywordBid || 0,
      spend:0, clicks:0, impressions:0, orders:0, sales:0,
    };
    map[k].spend       += normSpend(r);
    map[k].clicks      += r.clicks      || 0;
    map[k].impressions += r.impressions || 0;
    map[k].orders      += normOrders(r);
    map[k].sales       += normSales(r);
  }
  return Object.values(map).map(k => ({
    ...k,
    acos:  k.sales > 0 ? k.spend / k.sales : null,
    roas:  k.spend > 0 ? k.sales / k.spend : null,
    ctr:   k.impressions > 0 ? k.clicks / k.impressions : null,
    cpc:   k.clicks > 0 ? k.spend / k.clicks : null,
  }));
}

function aggregateReportByDate(rows) {
  const map = {};
  for (const r of rows) {
    const d = r.date || "unknown";
    if (!map[d]) map[d] = { date: d, spend:0, clicks:0, impressions:0, orders:0, sales:0 };
    map[d].spend       += normSpend(r);
    map[d].clicks      += r.clicks      || 0;
    map[d].impressions += r.impressions || 0;
    map[d].orders      += normOrders(r);
    map[d].sales       += normSales(r);
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

function calcMetrics(rows) {
  const totals = rows.reduce((acc, r) => ({
    spend:       acc.spend       + normSpend(r),
    clicks:      acc.clicks      + (r.clicks || 0),
    impressions: acc.impressions + (r.impressions || 0),
    orders:      acc.orders      + normOrders(r),
    sales:       acc.sales       + normSales(r),
  }), { spend:0, clicks:0, impressions:0, orders:0, sales:0 });

  return {
    ...totals,
    acos:  totals.sales > 0 ? totals.spend / totals.sales : null,
    roas:  totals.spend > 0 ? totals.sales / totals.spend : null,
    ctr:   totals.impressions > 0 ? totals.clicks / totals.impressions : null,
    cpc:   totals.clicks > 0 ? totals.spend / totals.clicks : null,
  };
}

// ── AI Optimization ───────────────────────────────────────────────────────────
let optimizationRunning = false;

async function runOptimization() {
  if (optimizationRunning) {
    console.log("[AI] Optimization already running, skipping");
    return;
  }
  optimizationRunning = true;
  console.log("[AI] Starting hourly optimization...");
  const startTs = Date.now();

  try {
    // 1. Trigger fresh report data (background — non-blocking)
    const start14 = daysAgoStr(14);
    const end0 = today();
    startReportFetch("campaignPerf",  () => amazon.getCampaignPerformance(start14, end0));
    startReportFetch("keywordPerf",   () => amazon.getKeywordPerformance(start14, end0));
    startReportFetch("searchTermPerf",() => amazon.getSearchTermPerformance(start14, end0));

    // 2. Wait up to 8 minutes for at least campaign report
    let waited = 0;
    while (waited < 480000) {
      if (cache.campaignPerf?.status === "ready") break;
      if (cache.campaignPerf?.status === "error") {
        logAction("optimization", "Report fetch failed: " + cache.campaignPerf.error, {}, false);
        return;
      }
      await new Promise(r => setTimeout(r, 15000));
      waited += 15000;
    }
    if (!cache.campaignPerf?.data) {
      logAction("optimization", "Campaign report not ready after 8 min wait", {}, false);
      return;
    }

    // 3. Load campaigns + keywords structure
    const [campaigns, keywords] = await Promise.all([
      loadCampaigns(true),
      loadKeywords(null, true),
    ]);

    // 4. Aggregate report data
    const campPerf = aggregateReportByCampaign(cache.campaignPerf.data);
    const kwPerf   = cache.keywordPerf?.data ? aggregateReportByKeyword(cache.keywordPerf.data) : [];

    // 5. Merge campaign structure + performance
    const merged = campaigns.map(c => {
      const perf = campPerf.find(p => p.campaignId === c.campaignId) || {};
      return { ...c, ...perf };
    });

    // 6. AI analysis
    const aiResult = await analyzeWithAI({ campaigns: merged, keywords: kwPerf, acosTarget: ACOS_TARGET, budgetMax: BUDGET_MAX });
    logAction("ai_analysis", `GPT-4o analysis complete — ${aiResult.recommendations?.length || 0} recommendations`, {});

    // 7. Auto-execute safe actions (no approval needed)
    const autoActions = (aiResult.recommendations || []).filter(r => r.autoExecute);
    const manualActions = (aiResult.recommendations || []).filter(r => !r.autoExecute);

    // Add manual actions to pending queue
    for (const action of manualActions) {
      const exists = pendingActions.find(p => p.id === action.id);
      if (!exists) pendingActions.push({ ...action, addedAt: new Date().toISOString() });
    }
    if (pendingActions.length > 50) pendingActions.splice(50);

    // Apply rule-based actions on top
    const ruleActions = applyRules({ campaigns: merged, keywords: kwPerf, acosTarget: ACOS_TARGET });
    const allAuto = [...autoActions, ...ruleActions.filter(r => r.autoExecute)];

    if (allAuto.length > 0) {
      const execResults = await executeAutoActions(allAuto, amazon);
      for (const r of execResults) {
        logAction(r.type, r.description, r.params, r.success);
      }
    }

    const duration = Math.round((Date.now() - startTs) / 1000);
    cache.lastOptimization = {
      ts: new Date().toISOString(),
      durationSec: duration,
      campaignsAnalyzed: merged.length,
      keywordsAnalyzed: kwPerf.length,
      autoActionsExecuted: allAuto.length,
      pendingCount: manualActions.length,
      recommendations: aiResult.recommendations || [],
      summary: aiResult.summary || "",
    };
    logAction("optimization", `Complete in ${duration}s — ${allAuto.length} auto, ${manualActions.length} pending`, {});
  } catch (err) {
    console.error("[AI] Optimization error:", err);
    logAction("optimization", "Error: " + err.message, {}, false);
  } finally {
    optimizationRunning = false;
  }
}

// ── Scheduler: run every hour ─────────────────────────────────────────────────
setTimeout(() => runOptimization(), 30 * 1000);          // first run 30s after boot
setInterval(() => runOptimization(), 60 * 60 * 1000);    // then every hour

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url    = new URL(req.url, `http://localhost`);
  const path   = url.pathname;
  const params = url.searchParams;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return res.end();
  }

  try {
    // ── Health ──
    if (path === "/api/health") {
      return json(res, {
        ok: true,
        ts: Date.now(),
        mock: false,
        source: "amazon-api-v3",
        cacheAge: {
          campaigns:   cache.campaigns  ? Math.round((Date.now()-cache.campaigns.ts)/1000)+"s"  : "empty",
          keywords:    cache.keywords   ? Math.round((Date.now()-cache.keywords.ts)/1000)+"s"   : "empty",
          campPerf:    cache.campaignPerf?.status  || "idle",
          kwPerf:      cache.keywordPerf?.status   || "idle",
          stPerf:      cache.searchTermPerf?.status|| "idle",
        },
        lastOptimization: cache.lastOptimization,
        optimizationRunning,
        pendingActions: pendingActions.length,
      });
    }

    // ── Campaigns ──
    if (path === "/api/campaigns" && req.method === "GET") {
      try {
        const campaigns = await loadCampaigns();

        // Attach perf data if available
        const campPerf = cache.campaignPerf?.status === "ready" && cache.campaignPerf.data
          ? aggregateReportByCampaign(cache.campaignPerf.data)
          : [];

        const result = campaigns.map(c => {
          const perf = campPerf.find(p => p.campaignId === c.campaignId) || {};
          return { ...c, ...perf };
        });

        return json(res, {
          campaigns: result,
          perfStatus: cache.campaignPerf?.status || "idle",
          perfAge: cache.campaignPerf?.ts ? Math.round((Date.now()-cache.campaignPerf.ts)/60000)+"min" : null,
          count: result.length,
        });
      } catch (e) {
        return json(res, { error: e.message }, 500);
      }
    }

    // ── Update campaign ──
    if (path === "/api/campaigns" && req.method === "PUT") {
      const body = await readBody(req);
      const { ok, data } = await amazon.updateCampaign(body.campaignId, body.updates);
      logAction("campaign_update", `Updated campaign ${body.campaignId}`, body, ok);
      return json(res, { ok, data });
    }

    // ── Summary / KPIs ──
    if (path === "/api/summary") {
      const start = params.get("start") || daysAgoStr(14);
      const end   = params.get("end")   || today();

      // Trigger background fetch if needed
      startReportFetch("campaignPerf",  () => amazon.getCampaignPerformance(start, end));

      const cached = getCachedReport("campaignPerf");
      if (cached.status !== "ready" || !cached.data) {
        return json(res, {
          status: cached.status,
          message: cached.status === "fetching"
            ? "Report in elaborazione — riprova tra 2-3 minuti"
            : cached.status === "error"
            ? "Errore report: " + cached.error
            : "Nessun dato — avvia refresh",
          data: null,
        });
      }

      const rows       = cached.data;
      const metrics    = calcMetrics(rows);
      const byDate     = aggregateReportByDate(rows);
      const byCampaign = aggregateReportByCampaign(rows);

      return json(res, {
        status: "ready",
        dateRange: { start, end },
        metrics,
        byDate,
        byCampaign,
        reportAge: cached.ageMin + " min",
      });
    }

    // ── Chart data ──
    if (path === "/api/chart") {
      const start = params.get("start") || daysAgoStr(14);
      const end   = params.get("end")   || today();
      startReportFetch("campaignPerf", () => amazon.getCampaignPerformance(start, end));
      const cached = getCachedReport("campaignPerf");
      if (cached.status !== "ready" || !cached.data) {
        return json(res, { status: cached.status, data: [] });
      }
      const byDate = aggregateReportByDate(cached.data);
      return json(res, { status: "ready", data: byDate });
    }

    // ── Keywords ──
    if (path === "/api/keywords" && req.method === "GET") {
      try {
        const keywords = await loadKeywords();

        // Attach perf
        const kwPerf = cache.keywordPerf?.status === "ready" && cache.keywordPerf.data
          ? aggregateReportByKeyword(cache.keywordPerf.data)
          : [];

        const result = keywords.map(k => {
          const perf = kwPerf.find(p => p.keywordId === k.keywordId) || {};
          return { ...k, ...perf };
        });

        return json(res, {
          keywords: result,
          perfStatus: cache.keywordPerf?.status || "idle",
          count: result.length,
        });
      } catch (e) {
        return json(res, { error: e.message }, 500);
      }
    }

    // ── Update keyword bid ──
    if (path === "/api/keywords/bid" && req.method === "PUT") {
      const { keywordId, bid } = await readBody(req);
      const { ok, data } = await amazon.updateKeyword(keywordId, bid);
      logAction("keyword_bid", `Bid kw ${keywordId} → €${bid}`, { keywordId, bid }, ok);
      if (ok) cache.keywords = null; // invalidate
      return json(res, { ok, data });
    }

    // ── Pause keyword ──
    if (path === "/api/keywords/pause" && req.method === "PUT") {
      const { keywordId } = await readBody(req);
      const { ok, data } = await amazon.pauseKeyword(keywordId);
      logAction("keyword_pause", `Paused kw ${keywordId}`, { keywordId }, ok);
      if (ok) cache.keywords = null;
      return json(res, { ok, data });
    }

    // ── Add negative keyword ──
    if (path === "/api/keywords/negative" && req.method === "POST") {
      const { campaignId, adGroupId, keywordText, matchType } = await readBody(req);
      const { ok, data } = await amazon.addNegativeKeyword(campaignId, adGroupId, keywordText, matchType);
      logAction("negative_keyword", `Added negative "${keywordText}" (${matchType}) to ${campaignId}`, {}, ok);
      return json(res, { ok, data });
    }

    // ── Search terms ──
    if (path === "/api/search-terms") {
      const start = params.get("start") || daysAgoStr(14);
      const end   = params.get("end")   || today();
      startReportFetch("searchTermPerf", () => amazon.getSearchTermPerformance(start, end));
      const cached = getCachedReport("searchTermPerf");

      if (cached.status !== "ready" || !cached.data) {
        return json(res, { status: cached.status, data: [], message: "Report in elaborazione..." });
      }

      // Group by search term
      const map = {};
      for (const r of cached.data) {
        const q = r.searchTerm || r.query || r.keyword || r.keywordText || "unknown";
        if (!map[q]) map[q] = { query: q, campaignName: r.campaignName, campaignId: r.campaignId, matchType: r.matchType, targeting: r.targeting, spend:0, clicks:0, impressions:0, orders:0, sales:0 };
        map[q].spend       += normSpend(r);
        map[q].clicks      += r.clicks      || 0;
        map[q].impressions += r.impressions || 0;
        map[q].orders      += normOrders(r);
        map[q].sales       += normSales(r);
      }
      const terms = Object.values(map).map(t => ({
        ...t,
        acos: t.sales > 0 ? t.spend / t.sales : null,
        ctr:  t.impressions > 0 ? t.clicks / t.impressions : null,
      })).sort((a, b) => b.spend - a.spend);

      return json(res, { status: "ready", data: terms, count: terms.length });
    }

    // ── AI recommendations ──
    if (path === "/api/ai/recommendations") {
      // Trigger report fetches if not started
      const start14 = daysAgoStr(14);
      startReportFetch("campaignPerf",  () => amazon.getCampaignPerformance(start14, today()));
      startReportFetch("keywordPerf",   () => amazon.getKeywordPerformance(start14, today()));

      return json(res, {
        lastOptimization: cache.lastOptimization,
        pendingActions,
        optimizationRunning,
        reportStatuses: {
          campaignPerf:    getCachedReport("campaignPerf").status,
          keywordPerf:     getCachedReport("keywordPerf").status,
          searchTermPerf:  getCachedReport("searchTermPerf").status,
        },
        actionLog: actionLog.slice(0, 20),
      });
    }

    // ── Apply pending action ──
    if (path === "/api/ai/apply" && req.method === "POST") {
      const { actionId } = await readBody(req);
      const idx = pendingActions.findIndex(a => a.id === actionId);
      if (idx === -1) return json(res, { error: "Action not found" }, 404);
      const action = pendingActions.splice(idx, 1)[0];

      try {
        const results = await executeAutoActions([action], amazon);
        for (const r of results) logAction(r.type, r.description, r.params, r.success);
        return json(res, { ok: true, action, results });
      } catch (e) {
        return json(res, { ok: false, error: e.message }, 500);
      }
    }

    // ── Dismiss pending action ──
    if (path === "/api/ai/dismiss" && req.method === "POST") {
      const { actionId } = await readBody(req);
      const idx = pendingActions.findIndex(a => a.id === actionId);
      if (idx !== -1) pendingActions.splice(idx, 1);
      return json(res, { ok: true, remaining: pendingActions.length });
    }

    // ── Force-run AI ──
    if (path === "/api/ai/run" && req.method === "POST") {
      if (optimizationRunning) return json(res, { ok: false, message: "Already running" });
      runOptimization(); // non-blocking
      return json(res, { ok: true, message: "Optimization started" });
    }

    // ── Force refresh reports ──
    if (path === "/api/reports/refresh" && req.method === "POST") {
      const start14 = daysAgoStr(14);
      const end0 = today();
      // Reset cache entries to force new fetch
      cache.campaignPerf   = null;
      cache.keywordPerf    = null;
      cache.searchTermPerf = null;
      startReportFetch("campaignPerf",  () => amazon.getCampaignPerformance(start14, end0));
      startReportFetch("keywordPerf",   () => amazon.getKeywordPerformance(start14, end0));
      startReportFetch("searchTermPerf",() => amazon.getSearchTermPerformance(start14, end0));
      return json(res, { ok: true, message: "Report refresh started — dati disponibili in 2-5 min" });
    }

    // ── Action log ──
    if (path === "/api/log") {
      return json(res, { log: actionLog.slice(0, 100) });
    }

    // ── Ad groups ──
    if (path === "/api/adgroups") {
      const campaignId = params.get("campaignId");
      const { ok, data } = await amazon.getAdGroups(campaignId);
      return json(res, ok ? (data.adGroups || data) : { error: data });
    }

    // ── 404 ──
    return json(res, { error: "Not found", path }, 404);

  } catch (err) {
    console.error("Handler error:", err);
    return json(res, { error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`
🚀 XYZ Print Zone Ads API
   Port     : ${PORT}
   ACoS     : ${ACOS_TARGET*100}%
   Budget   : €${BUDGET_MAX}/day
   Source   : Amazon Advertising API v3 (REAL DATA)
   AI       : GPT-4o auto-optimization every hour
   Reports  : Background async (non-blocking)
`);
});
