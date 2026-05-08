// optimizer.js — esegue le azioni AI sulle API Amazon
import * as api from "./amazon-api.js";
import * as db from "./db.js";

const ACOS_TARGET = parseFloat(process.env.ACOS_TARGET || "0.40");
const MIN_BID = 0.10;
const MAX_BID = 2.00;
const MAX_BID_CHANGE_PCT = 0.35; // max ±35% per singola modifica

export async function executeActions(runId, actions) {
  const results = [];

  for (const action of actions) {
    const actionId = db.logAction(runId, action);
    console.log(`[OPT] Esecuzione: ${action.type} su ${action.entityName || action.entityId}`);

    try {
      await executeAction(action);
      db.markActionApplied(actionId);
      results.push({ ...action, status: "applied", actionId });
      console.log(`[OPT] ✓ ${action.type} applicato`);
    } catch (err) {
      db.markActionFailed(actionId, err.message);
      results.push({ ...action, status: "failed", error: err.message, actionId });
      console.error(`[OPT] ✗ ${action.type} fallito:`, err.message);
    }

    // Pausa tra azioni per evitare rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  return results;
}

async function executeAction(action) {
  const { type, entityId, newValue, oldValue } = action;

  switch (type) {
    case "bid_change": {
      if (!entityId) throw new Error("entityId mancante");
      const bid = parseFloat(newValue);
      if (isNaN(bid) || bid < MIN_BID || bid > MAX_BID) {
        throw new Error(`Bid non valido: ${bid} (min ${MIN_BID}, max ${MAX_BID})`);
      }
      // Verifica cambio non superi limite %
      if (oldValue) {
        const changePct = Math.abs(bid - oldValue) / oldValue;
        if (changePct > MAX_BID_CHANGE_PCT) {
          const capped = oldValue > bid
            ? Math.max(MIN_BID, oldValue * (1 - MAX_BID_CHANGE_PCT))
            : Math.min(MAX_BID, oldValue * (1 + MAX_BID_CHANGE_PCT));
          console.warn(`[OPT] Bid change capped: ${bid} → ${capped.toFixed(2)} (limite ${MAX_BID_CHANGE_PCT*100}%)`);
          await api.updateKeywordBid(entityId, parseFloat(capped.toFixed(2)));
          return;
        }
      }
      await api.updateKeywordBid(entityId, bid);
      break;
    }

    case "pause_keyword": {
      if (!entityId) throw new Error("entityId mancante");
      await api.pauseKeyword(entityId);
      break;
    }

    case "enable_keyword": {
      if (!entityId) throw new Error("entityId mancante");
      await api.enableKeyword(entityId);
      break;
    }

    case "add_negative": {
      // entityId = campaignId, newValue = { adGroupId, keywordText, matchType }
      const payload = typeof newValue === "string" ? JSON.parse(newValue) : newValue;
      if (!payload?.keywordText) throw new Error("keywordText mancante per negativa");
      await api.addNegativeKeywords(
        entityId || payload.campaignId,
        payload.adGroupId,
        [{ keywordText: payload.keywordText, matchType: payload.matchType || "exact" }]
      );
      break;
    }

    case "pause_campaign": {
      if (!entityId) throw new Error("entityId mancante");
      await api.pauseCampaign(entityId);
      break;
    }

    case "budget_change": {
      if (!entityId) throw new Error("entityId mancante");
      const budget = parseFloat(newValue);
      if (isNaN(budget) || budget < 1 || budget > 100) {
        throw new Error(`Budget non valido: ${budget}`);
      }
      // Converti in centesimi
      await api.updateCampaignBudget(entityId, Math.round(budget * 100));
      break;
    }

    default:
      throw new Error(`Tipo azione sconosciuto: ${type}`);
  }
}
