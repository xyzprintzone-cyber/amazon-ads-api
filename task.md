# Amazon Ads AI Optimizer — Task Status

## Status: DEPLOYED LOCALLY ✅ | Render: Redeploying 🔄

## What works (confirmed)
- [x] OAuth v3 — token refresh working
- [x] GET /api/health — returns mock:false, scheduler status
- [x] GET /api/campaigns — 32 real campaigns from Amazon
- [x] GET /api/keywords — 100 real keywords with bids
- [x] Amazon report API v3 — confirmed COMPLETED with real data
  - 11 campaigns with spend (e.g. "AUTO SCRITTE 3D" €43 spend, 26.9% ACoS)
  - Reports take ~4 minutes (Amazon async) — poll timeout now 10min
- [x] Dashboard (index.html) — new real-data UI written + Gist updated
- [x] GitHub push — all files pushed

## Pending
- [ ] Render redeploy — triggered by push, check env vars:
  - AMAZON_CLIENT_ID / AMAZON_CLIENT_SECRET / AMAZON_REFRESH_TOKEN / AMAZON_PROFILE_ID
  - OPENAI_API_KEY / USE_MOCK=false / ACOS_TARGET=0.40 / DAILY_BUDGET_MAX=30.00
- [ ] First full AI optimization cycle (fetch → GPT-4o → apply)
  - Run via "Esegui AI ora" button or wait for 5min scheduler boot

## Known issues
- Report fetch times out on first /api/campaigns call (takes ~4min)
  - UI shows campaigns WITHOUT stats on first load
  - Cache (5min TTL) means subsequent loads are fast with stats
  - Fix: pre-warm cache on boot (but avoid duplicate reports)
- Render "no-server" — service sleeping or needs env vars

## Fixed bugs (this session)
- [x] res.buffer() → Buffer.from(await res.arrayBuffer())
- [x] MODULE_LOAD_TIMING — all env vars now read lazily via cfg()
- [x] API v2 paths → v3 POST endpoints
- [x] Report columns → correct v3 field names  
- [x] Keyword groupBy "keyword" → "adGroup"
- [x] Duplicate report 425 → timestamp in report name
- [x] OpenAI key undefined → lazy cfg() in ai-engine.js

## Files
- server.js — Hono-like HTTP server, routes, cache
- amazon-api.js — SP API v3, OAuth, reports
- data-fetcher.js — merges structure + stats
- ai-engine.js — GPT-4o prompt + response parsing
- optimizer.js — executes AI actions via API
- scheduler.js — node-cron hourly + 5min boot run
- db.js — SQLite via better-sqlite3
- amazon-ads-web/index.html — dashboard
