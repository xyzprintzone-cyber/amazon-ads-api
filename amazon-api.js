// amazon-api.js — Amazon Advertising SP API v3 (EU)
import fetch from "node-fetch";

const BASE = "https://advertising-api-eu.amazon.com";

// Read env lazily — .env is loaded by server.js before any calls happen
function cfg() {
  return {
    CLIENT_ID:     process.env.AMAZON_CLIENT_ID,
    CLIENT_SECRET: process.env.AMAZON_CLIENT_SECRET,
    REFRESH_TOKEN: process.env.AMAZON_REFRESH_TOKEN,
    PROFILE_ID:    process.env.AMAZON_PROFILE_ID,
  };
}

let _accessToken = null;
let _tokenExpiry = 0;

// ── OAuth ─────────────────────────────────────────────────────────────────────
export async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiry - 60_000) return _accessToken;
  const { CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN } = cfg();
  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: REFRESH_TOKEN, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  if (!res.ok) throw new Error(`OAuth failed: ${res.status} ${await res.text()}`);
  const d = await res.json();
  _accessToken = d.access_token;
  _tokenExpiry = Date.now() + d.expires_in * 1000;
  console.log("[AUTH] Token ok, expires in", d.expires_in, "s");
  return _accessToken;
}

// ── Base headers ──────────────────────────────────────────────────────────────
async function baseHeaders(contentType = "application/json", acceptType = null) {
  const token = await getAccessToken();
  const { CLIENT_ID, PROFILE_ID } = cfg();
  return {
    "Authorization": `Bearer ${token}`,
    "Amazon-Advertising-API-ClientId": CLIENT_ID,
    "Amazon-Advertising-API-Scope": PROFILE_ID,
    "Content-Type": contentType,
    "Accept": acceptType || contentType,
  };
}

// ── Generic v3 list call ──────────────────────────────────────────────────────
async function v3List(path, vndType, body = {}) {
  const ct = `application/vnd.${vndType}+json`;
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: await baseHeaders(ct, ct),
    body: JSON.stringify({ maxResults: 100, ...body }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

// ── Generic v3 UPDATE call ────────────────────────────────────────────────────
async function v3Update(path, vndType, payload) {
  const ct = `application/vnd.${vndType}+json`;
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: await baseHeaders(ct, ct),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API PUT ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

// ── Campaigns ─────────────────────────────────────────────────────────────────
export async function getCampaigns() {
  const data = await v3List("/sp/campaigns/list", "spCampaign.v3", {
    stateFilter: { include: ["ENABLED", "PAUSED"] },
  });
  return data.campaigns || [];
}

export async function updateCampaignBudget(campaignId, budget) {
  const data = await v3Update("/sp/campaigns", "spCampaign.v3", {
    campaigns: [{ campaignId, budget: { budget, budgetType: "DAILY" } }],
  });
  return data;
}

export async function pauseCampaign(campaignId) {
  const data = await v3Update("/sp/campaigns", "spCampaign.v3", {
    campaigns: [{ campaignId, state: "PAUSED" }],
  });
  return data;
}

export async function enableCampaign(campaignId) {
  const data = await v3Update("/sp/campaigns", "spCampaign.v3", {
    campaigns: [{ campaignId, state: "ENABLED" }],
  });
  return data;
}

// ── Ad Groups ─────────────────────────────────────────────────────────────────
export async function getAdGroups(campaignIds = []) {
  const body = campaignIds.length
    ? { campaignIdFilter: { include: campaignIds } }
    : {};
  const data = await v3List("/sp/adGroups/list", "spAdGroup.v3", body);
  return data.adGroups || [];
}

// ── Keywords ──────────────────────────────────────────────────────────────────
export async function getKeywords(campaignIds = []) {
  const body = {
    stateFilter: { include: ["ENABLED", "PAUSED"] },
    ...(campaignIds.length ? { campaignIdFilter: { include: campaignIds } } : {}),
  };
  const data = await v3List("/sp/keywords/list", "spKeyword.v3", body);
  return data.keywords || [];
}

export async function updateKeywordBid(keywordId, bid) {
  const data = await v3Update("/sp/keywords", "spKeyword.v3", {
    keywords: [{ keywordId, bid }],
  });
  return data;
}

export async function pauseKeyword(keywordId) {
  const data = await v3Update("/sp/keywords", "spKeyword.v3", {
    keywords: [{ keywordId, state: "PAUSED" }],
  });
  return data;
}

// ── Reports (async v3) ────────────────────────────────────────────────────────
export async function requestReport(reportSpec) {
  const token = await getAccessToken();
  const { CLIENT_ID, PROFILE_ID } = cfg();
  const res = await fetch(`${BASE}/reporting/reports`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Amazon-Advertising-API-ClientId": CLIENT_ID,
      "Amazon-Advertising-API-Scope": PROFILE_ID,
      "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
      "Accept": "application/vnd.createasyncreportrequest.v3+json",
    },
    body: JSON.stringify(reportSpec),
  });
  if (!res.ok) throw new Error(`requestReport → ${res.status}: ${await res.text()}`);
  return res.json(); // { reportId, status, ... }
}

export async function pollReport(reportId, maxWaitMs = 120_000) {
  const token = await getAccessToken();
  const { CLIENT_ID, PROFILE_ID } = cfg();
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${BASE}/reporting/reports/${reportId}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Amazon-Advertising-API-ClientId": CLIENT_ID,
        "Amazon-Advertising-API-Scope": PROFILE_ID,
      },
    });
    if (!r.ok) throw new Error(`pollReport → ${r.status}: ${await r.text()}`);
    const d = await r.json();
    if (d.status === "COMPLETED") return d.url;
    if (d.status === "FAILED") throw new Error(`Report ${reportId} failed: ${JSON.stringify(d)}`);
    await new Promise(ok => setTimeout(ok, 5000));
  }
  throw new Error(`Report ${reportId} timed out after ${maxWaitMs}ms`);
}

export async function downloadReport(url) {
  // S3 presigned URL — no auth headers needed (they break it)
  const res = await fetch(url);
  if (!res.ok) throw new Error(`downloadReport → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Reports are gzip-compressed JSON
  try {
    const { gunzipSync } = await import("zlib");
    return JSON.parse(gunzipSync(buf).toString("utf8"));
  } catch {
    // Some reports are plain JSON
    return JSON.parse(buf.toString("utf8"));
  }
}

// ── Fetch SP campaign performance report ─────────────────────────────────────
export async function fetchCampaignReport(startDate, endDate, maxWaitMs = 600_000) {
  const spec = {
    name: `CampaignReport-${startDate}-${Date.now()}`,
    startDate,
    endDate,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy: ["campaign"],
      columns: ["campaignId", "campaignName", "campaignStatus", "impressions", "clicks", "cost", "sales7d", "purchases7d"],
      reportTypeId: "spCampaigns",
      timeUnit: "SUMMARY",
      format: "GZIP_JSON",
    },
  };
  const { reportId } = await requestReport(spec);
  const url = await pollReport(reportId, maxWaitMs);
  return downloadReport(url);
}

// ── Fetch SP keyword performance report ──────────────────────────────────────
export async function fetchKeywordReport(startDate, endDate, maxWaitMs = 600_000) {
  const spec = {
    name: `KeywordReport-${startDate}-${Date.now()}`,
    startDate,
    endDate,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy: ["adGroup"],
      columns: ["campaignId", "campaignName", "adGroupId", "adGroupName", "impressions", "clicks", "cost", "purchases7d", "sales7d"],
      reportTypeId: "spKeywords",
      timeUnit: "SUMMARY",
      format: "GZIP_JSON",
    },
  };
  const { reportId } = await requestReport(spec);
  const url = await pollReport(reportId, maxWaitMs);
  return downloadReport(url);
}
