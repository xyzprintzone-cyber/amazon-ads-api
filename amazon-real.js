// amazon-real.js — Amazon Advertising API v3 (SP)
// Marketplace IT, Endpoint EU

const BASE = "https://advertising-api-eu.amazon.com";
const AUTH = "https://api.amazon.com/auth/o2/token";

let _token = null;
let _expiry = 0;

export async function getAccessToken() {
  if (_token && Date.now() < _expiry - 30000) return _token;
  const res = await fetch(AUTH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.AMAZON_REFRESH_TOKEN,
      client_id: process.env.AMAZON_CLIENT_ID,
      client_secret: process.env.AMAZON_CLIENT_SECRET,
    }),
  });
  const d = await res.json();
  if (!d.access_token) throw new Error("Auth failed: " + JSON.stringify(d));
  _token = d.access_token;
  _expiry = Date.now() + (d.expires_in || 3600) * 1000;
  return _token;
}

async function call(method, path, body = null, accept = "application/json", ct = "application/json") {
  const token = await getAccessToken();
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Amazon-Advertising-API-ClientId": process.env.AMAZON_CLIENT_ID,
    "Amazon-Advertising-API-Scope": process.env.AMAZON_PROFILE_ID,
    "Accept": accept,
    "Content-Type": ct,
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

// ── Campaigns ────────────────────────────────────────────────────────────────
export async function getCampaigns() {
  return call("POST", "/sp/campaigns/list",
    { stateFilter: { include: ["ENABLED", "PAUSED"] }, maxResults: 100 },
    "application/vnd.spCampaign.v3+json",
    "application/vnd.spCampaign.v3+json"
  );
}

export async function updateCampaign(campaignId, updates) {
  return call("PUT", "/sp/campaigns",
    { campaigns: [{ campaignId, ...updates }] },
    "application/vnd.spCampaign.v3+json",
    "application/vnd.spCampaign.v3+json"
  );
}

// ── Ad Groups ────────────────────────────────────────────────────────────────
export async function getAdGroups(campaignId = null) {
  const body = { stateFilter: { include: ["ENABLED", "PAUSED"] }, maxResults: 200 };
  if (campaignId) body.campaignIdFilter = { include: [campaignId] };
  return call("POST", "/sp/adGroups/list",
    body,
    "application/vnd.spAdGroup.v3+json",
    "application/vnd.spAdGroup.v3+json"
  );
}

// ── Keywords ─────────────────────────────────────────────────────────────────
export async function getKeywords(campaignId = null) {
  const body = { stateFilter: { include: ["ENABLED", "PAUSED"] }, maxResults: 500 };
  if (campaignId) body.campaignIdFilter = { include: [campaignId] };
  return call("POST", "/sp/keywords/list",
    body,
    "application/vnd.spKeyword.v3+json",
    "application/vnd.spKeyword.v3+json"
  );
}

export async function updateKeyword(keywordId, bid) {
  return call("PUT", "/sp/keywords",
    { keywords: [{ keywordId, bid: { bidValue: bid, bidValueType: "MANUAL" } }] },
    "application/vnd.spKeyword.v3+json",
    "application/vnd.spKeyword.v3+json"
  );
}

export async function pauseKeyword(keywordId) {
  return call("PUT", "/sp/keywords",
    { keywords: [{ keywordId, state: "PAUSED" }] },
    "application/vnd.spKeyword.v3+json",
    "application/vnd.spKeyword.v3+json"
  );
}

export async function createKeyword(campaignId, adGroupId, keywordText, matchType, bid) {
  return call("POST", "/sp/keywords",
    { keywords: [{ campaignId, adGroupId, keywordText, matchType, bid: { bidValue: bid, bidValueType: "MANUAL" }, state: "ENABLED" }] },
    "application/vnd.spKeyword.v3+json",
    "application/vnd.spKeyword.v3+json"
  );
}

export async function getNegativeKeywords(campaignId = null) {
  const body = { stateFilter: { include: ["ENABLED"] }, maxResults: 500 };
  if (campaignId) body.campaignIdFilter = { include: [campaignId] };
  return call("POST", "/sp/negativeKeywords/list",
    body,
    "application/vnd.spNegativeKeyword.v3+json",
    "application/vnd.spNegativeKeyword.v3+json"
  );
}

export async function addNegativeKeyword(campaignId, adGroupId, keywordText, matchType = "NEGATIVE_EXACT") {
  return call("POST", "/sp/negativeKeywords",
    { negativeKeywords: [{ campaignId, adGroupId, keywordText, matchType, state: "ENABLED" }] },
    "application/vnd.spNegativeKeyword.v3+json",
    "application/vnd.spNegativeKeyword.v3+json"
  );
}

// ── Reports v3 ───────────────────────────────────────────────────────────────
export async function requestReport(reportTypeId, startDate, endDate, columns, groupBy) {
  const body = {
    name: `${reportTypeId}-${startDate}-${endDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy,
      columns,
      reportTypeId,
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    }
  };
  return call("POST", "/reporting/reports", body,
    "application/vnd.createasyncreportrequest.v3+json",
    "application/vnd.createasyncreportrequest.v3+json"
  );
}

export async function getReportStatus(reportId) {
  return call("GET", `/reporting/reports/${reportId}`);
}

// Non-blocking poll — runs in background, resolves when done
// maxWaitMs default 10 min — safe for background jobs, NOT for request handlers
export async function pollReport(reportId, maxWaitMs = 600000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 15000)); // wait 15s between checks
    const { data } = await getReportStatus(reportId);
    if (data.status === "COMPLETED") {
      const token = await getAccessToken();
      const res = await fetch(data.location, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Amazon-Advertising-API-ClientId": process.env.AMAZON_CLIENT_ID,
        }
      });
      if (!res.ok) throw new Error("Download failed " + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      const { gunzipSync } = await import("zlib");
      return JSON.parse(gunzipSync(buf).toString());
    }
    if (data.status === "FAILED") throw new Error("Report failed: " + JSON.stringify(data));
    // PENDING or IN_PROGRESS → keep waiting
  }
  throw new Error("Report timeout after " + maxWaitMs + "ms");
}

// ── Performance via report (all blocking — only call from background jobs) ───
export async function getCampaignPerformance(startDate, endDate) {
  const { data } = await requestReport(
    "spCampaign",
    startDate,
    endDate,
    ["date","campaignId","campaignName","campaignStatus","spend","clicks","impressions","orders","sales7d","attributedSales14d"],
    ["campaign"]
  );
  if (!data.reportId) throw new Error("Report req failed: " + JSON.stringify(data));
  return pollReport(data.reportId);
}

export async function getKeywordPerformance(startDate, endDate) {
  const { data } = await requestReport(
    "spKeyword",
    startDate,
    endDate,
    ["date","campaignId","campaignName","adGroupId","keywordId","keywordText","matchType","bid","spend","clicks","impressions","orders","sales7d","attributedSales14d","attributedConversions14d"],
    ["keyword"]
  );
  if (!data.reportId) throw new Error("Report req failed: " + JSON.stringify(data));
  return pollReport(data.reportId);
}

export async function getSearchTermPerformance(startDate, endDate) {
  const { data } = await requestReport(
    "spSearchTerm",
    startDate,
    endDate,
    ["date","campaignId","campaignName","adGroupId","keywordId","keywordText","query","matchType","spend","clicks","impressions","orders","sales7d","attributedSales14d","attributedConversions14d"],
    ["searchTerm"]
  );
  if (!data.reportId) throw new Error("Report req failed: " + JSON.stringify(data));
  return pollReport(data.reportId);
}
