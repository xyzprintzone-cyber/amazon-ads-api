// server.js — Amazon Ads AI Optimizer · API Server
import { createServer } from "http";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

// Load .env
try {
  const env = readFileSync(join(__dir, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

import * as api from "./amazon-api.js";
import * as db from "./db.js";
import { fetchAllData } from "./data-fetcher.js";
import { analyzeAndGenerateActions } from "./ai-engine.js";
import { runOptimizationCycle, startScheduler, getSchedulerStatus } from "./scheduler.js";

const PORT       = parseInt(process.env.PORT || "8787");
const ACOS_TARGET = parseFloat(process.env.ACOS_TARGET || "0.40");

// ── Helpers ───────────────────────────────────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10); }
function daysAgoStr(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
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
    req.on("data", c => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

// Cache in-memory per dati Amazon (evita troppe chiamate API)
let _cache = { data: null, fetchedAt: 0, ttl: 5 * 60 * 1000 }; // 5 min TTL

async function getCachedData(days = 7) {
  const now = Date.now();
  if (_cache.data && now - _cache.fetchedAt < _cache.ttl) {
    return _cache.data;
  }
  const data = await fetchAllData(days);
  _cache = { data, fetchedAt: now, ttl: 5 * 60 * 1000 };
  return data;
}

function invalidateCache() { _cache.fetchedAt = 0; }

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url  = new URL(req.url, `http://localhost:${PORT}`);
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

    // ── Health ──────────────────────────────────────────────────────────────
    if (path === "/api/health") {
      const sched = getSchedulerStatus();
      return json(res, {
        ok: true,
        ts: Date.now(),
        mock: false,
        scheduler: sched,
        acosTarget: ACOS_TARGET,
      });
    }

    // ── Campagne live ───────────────────────────────────────────────────────
    if (path === "/api/campaigns" && req.method === "GET") {
      const startDate = url.searchParams.get("startDate") || daysAgoStr(7);
      const endDate   = url.searchParams.get("endDate")   || daysAgoStr(1);
      const stateFilter = url.searchParams.get("state") || "all";

      const data = await getCachedData(7);
      let campaigns = data.campaigns;
      if (stateFilter !== "all") campaigns = campaigns.filter(c => c.state === stateFilter);

      // Aggiungi ACoS badge
      const result = campaigns.map(c => ({
        ...c,
        acosStatus: c.acos === null ? "no_data"
          : c.acos > ACOS_TARGET ? "above_target"
          : c.acos > ACOS_TARGET * 0.8 ? "near_target"
          : "on_target",
        dailyBudgetEur: c.dailyBudget ? (c.dailyBudget / 100).toFixed(2) : null,
      }));

      return json(res, result);
    }

    // ── Summary ─────────────────────────────────────────────────────────────
    if (path === "/api/summary" && req.method === "GET") {
      const data = await getCachedData(7);
      const campaigns = data.campaigns.filter(c => c.state === "enabled");

      const t = campaigns.reduce(
        (acc, c) => ({
          cost: acc.cost + (c.cost || 0),
          clicks: acc.clicks + (c.clicks || 0),
          impressions: acc.impressions + (c.impressions || 0),
          orders: acc.orders + (c.orders || 0),
          sales: acc.sales + (c.sales || 0),
        }),
        { cost: 0, clicks: 0, impressions: 0, orders: 0, sales: 0 }
      );

      return json(res, {
        cost:            parseFloat(t.cost.toFixed(2)),
        clicks:          t.clicks,
        impressions:     t.impressions,
        orders:          t.orders,
        sales:           parseFloat(t.sales.toFixed(2)),
        acos:            t.sales > 0 ? parseFloat((t.cost / t.sales).toFixed(4)) : null,
        ctr:             t.impressions > 0 ? parseFloat((t.clicks / t.impressions).toFixed(4)) : 0,
        cpc:             t.clicks > 0 ? parseFloat((t.cost / t.clicks).toFixed(2)) : 0,
        roas:            t.cost > 0 ? parseFloat((t.sales / t.cost).toFixed(2)) : null,
        activeCampaigns: campaigns.length,
        fetchedAt:       data.fetchedAt,
        dateRange:       data.dateRange,
      });
    }

    // ── Trend chart (dati DB storico) ────────────────────────────────────────
    if (path === "/api/chart" && req.method === "GET") {
      const days = parseInt(url.searchParams.get("days") || "7");
      // Leggi da snapshot DB (se disponibili)
      const rows = db.getDb().prepare(`
        SELECT
          date(captured_at) as date,
          SUM(cost) as cost,
          SUM(clicks) as clicks,
          SUM(impressions) as impressions,
          SUM(orders) as orders,
          SUM(sales) as sales
        FROM campaign_snapshots
        WHERE captured_at >= datetime('now', ? || ' days')
        GROUP BY date(captured_at)
        ORDER BY date ASC
      `).all(`-${days}`);

      const result = rows.map(r => ({
        date: r.date,
        cost: parseFloat((r.cost || 0).toFixed(2)),
        clicks: r.clicks || 0,
        impressions: r.impressions || 0,
        orders: r.orders || 0,
        sales: parseFloat((r.sales || 0).toFixed(2)),
        acos: r.sales > 0 ? parseFloat((r.cost / r.sales).toFixed(4)) : null,
      }));

      return json(res, result);
    }

    // ── Keyword ─────────────────────────────────────────────────────────────
    if (path === "/api/keywords" && req.method === "GET") {
      const data = await getCachedData(7);
      return json(res, data.keywords || []);
    }

    if (path === "/api/keywords/bid" && req.method === "PUT") {
      const body = await readBody(req);
      await api.updateKeywordBid(body.keywordId, body.bid);
      invalidateCache();
      return json(res, { ok: true });
    }

    if (path === "/api/keywords/pause" && req.method === "PUT") {
      const body = await readBody(req);
      await api.pauseKeyword(body.keywordId);
      invalidateCache();
      return json(res, { ok: true });
    }

    if (path === "/api/keywords/negative" && req.method === "POST") {
      const body = await readBody(req);
      await api.addNegativeKeywords(body.campaignId, body.adGroupId, [{
        keywordText: body.keywordText,
        matchType: body.matchType || "exact",
      }]);
      invalidateCache();
      return json(res, { ok: true });
    }

    // ── Search Terms ─────────────────────────────────────────────────────────
    if (path === "/api/search-terms" && req.method === "GET") {
      const data = await getCachedData(7);
      return json(res, data.searchTerms || []);
    }

    // ── Scheduler / Runs ─────────────────────────────────────────────────────
    if (path === "/api/scheduler/status") {
      return json(res, getSchedulerStatus());
    }

    if (path === "/api/scheduler/run-now" && req.method === "POST") {
      // Avvia run manuale in background
      runOptimizationCycle().catch(console.error);
      return json(res, { ok: true, message: "Ciclo avviato" });
    }

    // ── Log runs ─────────────────────────────────────────────────────────────
    if (path === "/api/runs" && req.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") || "20");
      return json(res, db.getRecentRuns(limit));
    }

    if (path.startsWith("/api/runs/") && path.endsWith("/actions")) {
      const runId = parseInt(path.split("/")[3]);
      return json(res, db.getRunActions(runId));
    }

    // ── Azioni recenti ───────────────────────────────────────────────────────
    if (path === "/api/actions" && req.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") || "50");
      return json(res, db.getRecentActions(limit));
    }

    if (path === "/api/actions/stats") {
      return json(res, db.getActionStats());
    }

    // ── AI Recommendations (solo visualizza, non esegue) ────────────────────
    if (path === "/api/ai/preview" && req.method === "GET") {
      const data = await getCachedData(7);
      const result = await analyzeAndGenerateActions(data);
      return json(res, result);
    }

    // ── Manual override ──────────────────────────────────────────────────────
    if (path === "/api/manual/bid" && req.method === "POST") {
      const body = await readBody(req);
      await api.updateKeywordBid(body.keywordId, body.bid);
      invalidateCache();
      db.logAction(0, {
        type: "bid_change",
        entityType: "keyword",
        entityId: String(body.keywordId),
        entityName: body.keywordText || "",
        oldValue: body.oldBid,
        newValue: body.bid,
        reason: "Override manuale",
      });
      return json(res, { ok: true });
    }

    // ── Snapshot corrente ────────────────────────────────────────────────────
    if (path === "/api/snapshot/campaigns") {
      return json(res, db.getLatestCampaignSnapshots());
    }

    // ── Forza refresh cache ──────────────────────────────────────────────────
    if (path === "/api/refresh" && req.method === "POST") {
      invalidateCache();
      return json(res, { ok: true });
    }

    json(res, { error: "Not found" }, 404);

  } catch (err) {
    console.error("[SERVER]", err);
    json(res, { error: err.message, stack: process.env.NODE_ENV !== "production" ? err.stack : undefined }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`\n${"═".repeat(50)}`);
  console.log(`Amazon Ads AI Optimizer`);
  console.log(`Port: ${PORT} | ACoS target: ${(ACOS_TARGET*100).toFixed(0)}%`);
  console.log(`Profile: ${process.env.AMAZON_PROFILE_ID}`);
  console.log("═".repeat(50));

  // Avvia scheduler
  startScheduler();
});
