// db.js — SQLite locale per log azioni AI e storico ottimizzazioni
import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dir, "optimizer.db");

let _db = null;

export function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  initSchema(_db);
  return _db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS optimization_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at  TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      status      TEXT NOT NULL DEFAULT 'running',  -- running|done|error
      campaigns   INTEGER DEFAULT 0,
      keywords    INTEGER DEFAULT 0,
      actions_taken INTEGER DEFAULT 0,
      error       TEXT,
      ai_summary  TEXT  -- riassunto GPT
    );

    CREATE TABLE IF NOT EXISTS ai_actions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id        INTEGER REFERENCES optimization_runs(id),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      type          TEXT NOT NULL,  -- bid_change|pause_keyword|add_negative|pause_campaign|budget_change
      entity_type   TEXT,           -- keyword|campaign|search_term
      entity_id     TEXT,
      entity_name   TEXT,
      campaign_name TEXT,
      old_value     REAL,
      new_value     REAL,
      reason        TEXT,
      expected_impact TEXT,
      status        TEXT DEFAULT 'pending',  -- pending|applied|failed|skipped
      applied_at    TEXT,
      error         TEXT
    );

    CREATE TABLE IF NOT EXISTS campaign_snapshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at  TEXT NOT NULL DEFAULT (datetime('now')),
      campaign_id  TEXT NOT NULL,
      campaign_name TEXT,
      state        TEXT,
      daily_budget REAL,
      impressions  INTEGER DEFAULT 0,
      clicks       INTEGER DEFAULT 0,
      cost         REAL DEFAULT 0,
      sales        REAL DEFAULT 0,
      orders       INTEGER DEFAULT 0,
      acos         REAL,
      ctr          REAL,
      cpc          REAL,
      roas         REAL,
      date_start   TEXT,
      date_end     TEXT
    );

    CREATE TABLE IF NOT EXISTS keyword_snapshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at  TEXT NOT NULL DEFAULT (datetime('now')),
      keyword_id   TEXT NOT NULL,
      keyword_text TEXT,
      match_type   TEXT,
      campaign_id  TEXT,
      campaign_name TEXT,
      ad_group_id  TEXT,
      ad_group_name TEXT,
      state        TEXT,
      bid          REAL,
      impressions  INTEGER DEFAULT 0,
      clicks       INTEGER DEFAULT 0,
      cost         REAL DEFAULT 0,
      sales        REAL DEFAULT 0,
      orders       INTEGER DEFAULT 0,
      acos         REAL
    );

    CREATE INDEX IF NOT EXISTS idx_actions_run ON ai_actions(run_id);
    CREATE INDEX IF NOT EXISTS idx_actions_type ON ai_actions(type);
    CREATE INDEX IF NOT EXISTS idx_snapshots_campaign ON campaign_snapshots(campaign_id, captured_at);
  `);
}

// ── Run management ────────────────────────────────────────────────────────────
export function startRun() {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO optimization_runs (status) VALUES ('running')
  `).run();
  return result.lastInsertRowid;
}

export function finishRun(runId, { actionsTaken, campaigns, keywords, aiSummary, error } = {}) {
  const db = getDb();
  db.prepare(`
    UPDATE optimization_runs SET
      finished_at = datetime('now'),
      status = ?,
      actions_taken = ?,
      campaigns = ?,
      keywords = ?,
      ai_summary = ?,
      error = ?
    WHERE id = ?
  `).run(
    error ? "error" : "done",
    actionsTaken || 0,
    campaigns || 0,
    keywords || 0,
    aiSummary || null,
    error || null,
    runId
  );
}

// ── Actions ───────────────────────────────────────────────────────────────────
export function logAction(runId, action) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO ai_actions (
      run_id, type, entity_type, entity_id, entity_name,
      campaign_name, old_value, new_value, reason, expected_impact, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    runId,
    action.type,
    action.entityType || null,
    action.entityId ? String(action.entityId) : null,
    action.entityName || null,
    action.campaignName || null,
    action.oldValue ?? null,
    action.newValue ?? null,
    action.reason || null,
    action.expectedImpact || null
  );
  return result.lastInsertRowid;
}

export function markActionApplied(actionId) {
  getDb().prepare(`
    UPDATE ai_actions SET status='applied', applied_at=datetime('now') WHERE id=?
  `).run(actionId);
}

export function markActionFailed(actionId, error) {
  getDb().prepare(`
    UPDATE ai_actions SET status='failed', error=? WHERE id=?
  `).run(error, actionId);
}

export function markActionSkipped(actionId, reason) {
  getDb().prepare(`
    UPDATE ai_actions SET status='skipped', error=? WHERE id=?
  `).run(reason, actionId);
}

// ── Snapshots ─────────────────────────────────────────────────────────────────
export function saveCampaignSnapshots(campaigns, dateStart, dateEnd) {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO campaign_snapshots (
      campaign_id, campaign_name, state, daily_budget,
      impressions, clicks, cost, sales, orders, acos, ctr, cpc, roas,
      date_start, date_end
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((list) => {
    for (const c of list) {
      insert.run(
        String(c.campaignId || c.campaign_id || ""),
        c.name || c.campaign_name || c.campaignName || "",
        c.state || "enabled",
        c.dailyBudget || c.daily_budget || 0,
        c.impressions || 0,
        c.clicks || 0,
        c.cost || 0,
        c.sales || 0,
        c.orders || 0,
        c.acos ?? null,
        c.ctr ?? null,
        c.cpc ?? null,
        c.roas ?? null,
        dateStart,
        dateEnd
      );
    }
  });
  tx(campaigns);
}

export function saveKeywordSnapshots(keywords) {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO keyword_snapshots (
      keyword_id, keyword_text, match_type, campaign_id, campaign_name,
      ad_group_id, ad_group_name, state, bid,
      impressions, clicks, cost, sales, orders, acos
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((list) => {
    for (const k of list) {
      insert.run(
        String(k.keywordId || k.keyword_id || ""),
        k.keywordText || k.keyword_text || k.query || "",
        k.matchType || k.match_type || "",
        String(k.campaignId || k.campaign_id || ""),
        k.campaignName || k.campaign_name || "",
        String(k.adGroupId || k.ad_group_id || ""),
        k.adGroupName || k.ad_group_name || "",
        k.state || "enabled",
        k.bid || 0,
        k.impressions || 0,
        k.clicks || 0,
        k.cost || 0,
        k.attributedSales14d || k.sales || 0,
        k.attributedConversions14d || k.orders || 0,
        k.acos ?? null
      );
    }
  });
  tx(keywords);
}

// ── Queries per dashboard ─────────────────────────────────────────────────────
export function getRecentRuns(limit = 20) {
  return getDb().prepare(`
    SELECT * FROM optimization_runs ORDER BY started_at DESC LIMIT ?
  `).all(limit);
}

export function getRunActions(runId) {
  return getDb().prepare(`
    SELECT * FROM ai_actions WHERE run_id = ? ORDER BY created_at DESC
  `).all(runId);
}

export function getRecentActions(limit = 50) {
  return getDb().prepare(`
    SELECT a.*, r.started_at as run_started
    FROM ai_actions a
    JOIN optimization_runs r ON a.run_id = r.id
    ORDER BY a.created_at DESC LIMIT ?
  `).all(limit);
}

export function getActionStats() {
  return getDb().prepare(`
    SELECT
      type,
      COUNT(*) as total,
      SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) as applied,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
    FROM ai_actions
    GROUP BY type
  `).all();
}

export function getLatestCampaignSnapshots() {
  return getDb().prepare(`
    SELECT cs.*
    FROM campaign_snapshots cs
    INNER JOIN (
      SELECT campaign_id, MAX(captured_at) as max_at
      FROM campaign_snapshots
      GROUP BY campaign_id
    ) latest ON cs.campaign_id = latest.campaign_id AND cs.captured_at = latest.max_at
    ORDER BY cs.cost DESC
  `).all();
}

export function getCampaignHistory(campaignId, days = 14) {
  return getDb().prepare(`
    SELECT * FROM campaign_snapshots
    WHERE campaign_id = ?
      AND captured_at >= datetime('now', ? || ' days')
    ORDER BY captured_at ASC
  `).all(String(campaignId), `-${days}`);
}
