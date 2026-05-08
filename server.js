import { createServer } from "http";
import * as amazon from "./amazon.js";

const PORT = process.env.PORT || 8787;

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
      return json(res, { ok: true, ts: Date.now() });
    }
    if (path === "/api/campaigns" && req.method === "GET") {
      const result = await amazon.getCampaigns();
      return json(res, result.data, result.ok ? 200 : 500);
    }
    if (path === "/api/campaigns" && req.method === "PUT") {
      const body = await readBody(req);
      const result = await amazon.updateCampaign(body.campaignId, body.updates);
      return json(res, result.data, result.ok ? 200 : 500);
    }
    if (path === "/api/keywords" && req.method === "GET") {
      const campaignId = url.searchParams.get("campaignId");
      const result = await amazon.getKeywords(campaignId);
      return json(res, result.data, result.ok ? 200 : 500);
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
    json(res, { error: "Not found" }, 404);
  } catch (err) {
    console.error(err);
    json(res, { error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
