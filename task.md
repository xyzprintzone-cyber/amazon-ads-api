# Amazon Ads AI Optimizer — Build Plan

## Architettura
1. `amazon-api.js` — wrapper reale Amazon Advertising API (OAuth + SP API)
2. `ai-engine.js` — OpenAI GPT-4o analizza dati + genera azioni concrete
3. `optimizer.js` — esegue azioni AI: modifica bid, pausa keyword, aggiunge negative
4. `scheduler.js` — cron ogni ora: fetch dati → AI → esegui azioni → log
5. `db.js` — SQLite locale per storico azioni, log ottimizzazioni
6. `server.js` — API HTTP: dashboard data, log, override manuale
7. `index.html` — dashboard realtime: campagne vere, log AI, metriche live

## Flusso ogni ora
1. Fetch token OAuth Amazon
2. GET campagne attive + stats ultimi 7gg
3. GET keyword report + search term report
4. Invia tutto a GPT-4o con contesto business (ACoS target 40%, budget €30)
5. GPT-4o ritorna lista azioni JSON: { type, target_id, action, reason, value }
6. Optimizer esegue ogni azione via API Amazon
7. Log tutto in SQLite
8. Dashboard mostra stato live

## Status
- [ ] amazon-api.js (OAuth reale)
- [ ] ai-engine.js (GPT-4o)
- [ ] optimizer.js
- [ ] scheduler.js
- [ ] db.js
- [ ] server.js
- [ ] index.html
- [ ] Deploy Render
