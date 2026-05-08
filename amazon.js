// Amazon Advertising API client
// NOTE: SP API access requires formal Amazon approval.
// Currently using mock data. When approved, set USE_MOCK=false in .env

const USE_MOCK = process.env.USE_MOCK !== "false";

import { mockCampaigns, mockKeywords, mockSearchTerms } from "./mock-data.js";

const CLIENT_ID = process.env.AMAZON_CLIENT_ID;
const CLIENT_SECRET = process.env.AMAZON_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.AMAZON_REFRESH_TOKEN;
const PROFILE_ID = process.env.AMAZON_PROFILE_ID;
const API_BASE = "https://advertising-api-eu.amazon.com";

let accessToken = null;
let tokenExpiry = 0;

export async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry - 60000) return accessToken;

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: REFRESH_TOKEN,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh failed: " + JSON.stringify(data));

  accessToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return accessToken;
}

async function amazonRequest(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Amazon-Advertising-API-ClientId": CLIENT_ID,
      "Amazon-Advertising-API-Scope": PROFILE_ID,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, data: text };
  }
}

// ── Campaigns ─────────────────────────────────────────────────────────────────
export async function getCampaigns() {
  if (USE_MOCK) return { ok: true, data: mockCampaigns };
  return amazonRequest("/v2/sp/campaigns?count=100&stateFilter=enabled,paused");
}

export async function updateCampaign(campaignId, updates) {
  if (USE_MOCK) {
    const idx = mockCampaigns.findIndex(c => c.campaignId == campaignId);
    if (idx > -1) Object.assign(mockCampaigns[idx], updates);
    return { ok: true, data: [{ campaignId, code: "SUCCESS" }] };
  }
  return amazonRequest("/v2/sp/campaigns", {
    method: "PUT",
    body: JSON.stringify([{ campaignId, ...updates }]),
  });
}

// ── Ad Groups ─────────────────────────────────────────────────────────────────
export async function getAdGroups(campaignId) {
  if (USE_MOCK) return { ok: true, data: [] };
  const qs = campaignId ? `?campaignIdFilter=${campaignId}` : "?count=100";
  return amazonRequest(`/v2/sp/adGroups${qs}`);
}

// ── Keywords ──────────────────────────────────────────────────────────────────
export async function getKeywords(campaignId) {
  if (USE_MOCK) {
    const filtered = campaignId
      ? mockKeywords.filter(k => k.campaignId == campaignId)
      : mockKeywords;
    return { ok: true, data: filtered };
  }
  const qs = campaignId ? `?campaignIdFilter=${campaignId}&count=100` : "?count=100";
  return amazonRequest(`/v2/sp/keywords${qs}`);
}

export async function updateKeyword(keywordId, bid) {
  if (USE_MOCK) {
    const kw = mockKeywords.find(k => k.keywordId == keywordId);
    if (kw) kw.bid = bid;
    return { ok: true, data: [{ keywordId, code: "SUCCESS" }] };
  }
  return amazonRequest("/v2/sp/keywords", {
    method: "PUT",
    body: JSON.stringify([{ keywordId, bid, state: "enabled" }]),
  });
}

export async function pauseKeyword(keywordId) {
  if (USE_MOCK) {
    const kw = mockKeywords.find(k => k.keywordId == keywordId);
    if (kw) kw.state = "paused";
    return { ok: true, data: [{ keywordId, code: "SUCCESS" }] };
  }
  return amazonRequest("/v2/sp/keywords", {
    method: "PUT",
    body: JSON.stringify([{ keywordId, state: "paused" }]),
  });
}

export async function addNegativeKeyword(campaignId, adGroupId, keywordText) {
  if (USE_MOCK) return { ok: true, data: [{ code: "SUCCESS", keywordText }] };
  return amazonRequest("/v2/sp/negativeKeywords", {
    method: "POST",
    body: JSON.stringify([{ campaignId, adGroupId, keywordText, matchType: "negativeExact", state: "enabled" }]),
  });
}

// ── Search Terms Report ───────────────────────────────────────────────────────
export async function requestSearchTermReport() {
  if (USE_MOCK) return { ok: true, data: { reportId: "mock-report-001", status: "SUCCESS" } };
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return amazonRequest("/v2/reports", {
    method: "POST",
    body: JSON.stringify({
      reportDate: today,
      metrics: "campaignName,adGroupName,keywordText,query,impressions,clicks,cost,attributedConversions14d,attributedSales14d",
      segment: "query",
    }),
  });
}

export async function getReport(reportId) {
  if (USE_MOCK || reportId === "mock-report-001") {
    return { ok: true, data: { reportId, status: "SUCCESS", location: "mock://search-terms" } };
  }
  return amazonRequest(`/v2/reports/${reportId}`);
}

export async function downloadReport(url) {
  if (USE_MOCK || url === "mock://search-terms") return mockSearchTerms;
  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Amazon-Advertising-API-ClientId": CLIENT_ID,
    },
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}
