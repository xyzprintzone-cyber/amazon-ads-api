// ai-engine.js — GPT-4o ottimizzazione automatica Amazon Ads
// Analizza dati reali, genera azioni, le applica automaticamente

const OPENAI_API = "https://api.openai.com/v1/chat/completions";
const ACOS_TARGET = parseFloat(process.env.ACOS_TARGET || "0.40");
const BUDGET_MAX = parseFloat(process.env.DAILY_BUDGET_MAX || "30.00");

// ── Analisi AI con GPT-4o ─────────────────────────────────────────────────────
export async function analyzeWithAI(campaigns, keywords, searchTerms, actionLog) {
  const prompt = buildPrompt(campaigns, keywords, searchTerms, actionLog);

  const res = await fetch(OPENAI_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Sei un esperto di Amazon Ads per un venditore italiano (XYZ Print Zone) che vende prodotti stampati personalizzati (scritte 3D, portachiavi, targhe). 
Analizza i dati delle campagne e restituisci SOLO un JSON con le azioni di ottimizzazione da eseguire.
Target ACoS: ${(ACOS_TARGET * 100).toFixed(0)}%. Budget max giornaliero totale: €${BUDGET_MAX}.
Sii aggressivo nell'ottimizzazione — ogni euro speso deve generare profitto.
Restituisci JSON con questo schema esatto:
{
  "summary": "stringa breve con stato generale delle campagne",
  "overallHealth": "good|warning|critical",
  "actions": [
    {
      "id": "unique-id",
      "type": "bid_reduce|bid_increase|pause_keyword|add_negative|add_keyword|pause_campaign|adjust_budget",
      "priority": "critical|high|medium|low",
      "auto": true/false,  // true = esegui automaticamente senza conferma
      "title": "titolo breve",
      "reason": "spiegazione in italiano",
      "expectedImpact": "impatto atteso",
      "params": {
        // per bid_reduce/bid_increase: keywordId, keywordText, currentBid, newBid, campaignName
        // per pause_keyword: keywordId, keywordText, campaignName
        // per add_negative: campaignId, adGroupId, keywordText, matchType, campaignName
        // per adjust_budget: campaignId, campaignName, currentBudget, newBudget
        // per pause_campaign: campaignId, campaignName
      }
    }
  ]
}`,
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  const d = await res.json();
  if (!d.choices?.[0]) throw new Error("OpenAI error: " + JSON.stringify(d));
  const content = d.choices[0].message.content;
  return JSON.parse(content);
}

function buildPrompt(campaigns, keywords, searchTerms, actionLog) {
  const campSummary = campaigns.map(c => ({
    id: c.campaignId,
    name: c.name,
    state: c.state,
    budget: c.budget,
    spend: c.spend,
    sales: c.sales,
    acos: c.acos,
    clicks: c.clicks,
    impressions: c.impressions,
    orders: c.orders,
    roas: c.roas,
  }));

  const kwTop = keywords
    .filter(k => k.clicks > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 30)
    .map(k => ({
      id: k.keywordId,
      text: k.keywordText,
      match: k.matchType,
      bid: k.bid,
      clicks: k.clicks,
      spend: k.spend,
      orders: k.orders,
      sales: k.sales,
      acos: k.acos,
      campaign: k.campaignName,
      adGroupId: k.adGroupId,
      campaignId: k.campaignId,
    }));

  const stTop = searchTerms
    .filter(s => s.clicks > 3)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 30)
    .map(s => ({
      query: s.query,
      campaign: s.campaignName,
      campaignId: s.campaignId,
      adGroupId: s.adGroupId,
      clicks: s.clicks,
      spend: s.spend,
      orders: s.orders || s.attributedConversions14d,
      sales: s.sales || s.attributedSales14d,
      acos: s.acos,
    }));

  const recentActions = (actionLog || []).slice(0, 10).map(a =>
    `${a.timestamp}: ${a.type} - ${a.description}`
  );

  return `
Dati campagne (ultimi 7 giorni):
${JSON.stringify(campSummary, null, 2)}

Keyword top per spesa:
${JSON.stringify(kwTop, null, 2)}

Search term con più click:
${JSON.stringify(stTop, null, 2)}

Azioni recenti già eseguite (non ripetere):
${recentActions.join("\n") || "Nessuna"}

Data attuale: ${new Date().toISOString()}

Analizza e fornisci le azioni di ottimizzazione più importanti. 
Marca come "auto: true" solo le azioni sicure (riduci bid su ACoS > 80%, pausa keyword senza conversioni dopo 20+ click, aggiungi negativa search term con 10+ click e 0 conversioni).
Tutto il resto "auto: false" (richiede conferma dell'utente).
`;
}

// ── Auto-esecuzione azioni sicure ─────────────────────────────────────────────
export async function executeAutoActions(actions, amazon) {
  const results = [];

  for (const action of actions.filter(a => a.auto)) {
    try {
      let result;
      switch (action.type) {
        case "bid_reduce":
        case "bid_increase":
          result = await amazon.updateKeyword(
            action.params.keywordId,
            action.params.newBid
          );
          break;

        case "pause_keyword":
          result = await amazon.pauseKeyword(action.params.keywordId);
          break;

        case "add_negative":
          result = await amazon.addNegativeKeyword(
            action.params.campaignId,
            action.params.adGroupId,
            action.params.keywordText,
            action.params.matchType || "NEGATIVE_EXACT"
          );
          break;

        case "adjust_budget":
          result = await amazon.updateCampaign(action.params.campaignId, {
            budget: { budget: action.params.newBudget, budgetType: "DAILY" }
          });
          break;

        default:
          continue;
      }

      results.push({
        actionId: action.id,
        type: action.type,
        success: result.ok,
        status: result.status,
        description: action.title,
        params: action.params,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      results.push({
        actionId: action.id,
        type: action.type,
        success: false,
        error: e.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return results;
}

// ── Regole deterministiche (fallback senza AI / sempre attive) ────────────────
export function applyRules(campaigns, keywords, searchTerms) {
  const actions = [];
  const acosTgt = ACOS_TARGET;

  for (const kw of keywords) {
    if (kw.state !== "ENABLED" && kw.state !== "enabled") continue;
    const acos = kw.sales > 0 ? kw.spend / kw.sales : (kw.clicks >= 10 ? 999 : null);
    if (acos === null) continue;

    // ACoS > 2x target + 10+ click → riduci bid automaticamente
    if (acos > acosTgt * 2 && kw.clicks >= 10) {
      const newBid = acos < 999
        ? Math.max(0.10, parseFloat((kw.bid * acosTgt / acos).toFixed(2)))
        : parseFloat((kw.bid * 0.65).toFixed(2));
      actions.push({
        id: `rule-bid-${kw.keywordId}`,
        type: "bid_reduce",
        priority: acos > acosTgt * 3 ? "critical" : "high",
        auto: true,
        title: `Riduci offerta: "${kw.keywordText}"`,
        reason: `ACoS ${acos === 999 ? "∞" : (acos*100).toFixed(0)}% — oltre 2x il target`,
        expectedImpact: `ACoS → ~${(acosTgt*100).toFixed(0)}%`,
        params: {
          keywordId: kw.keywordId,
          keywordText: kw.keywordText,
          currentBid: kw.bid,
          newBid,
          campaignName: kw.campaignName,
          campaignId: kw.campaignId,
          adGroupId: kw.adGroupId,
        },
      });
    }

    // ACoS ok e budget sottoutilizzato → aumenta bid
    if (acos < acosTgt * 0.6 && kw.clicks >= 5 && kw.bid < 2.0) {
      const newBid = Math.min(2.0, parseFloat((kw.bid * 1.20).toFixed(2)));
      actions.push({
        id: `rule-bidup-${kw.keywordId}`,
        type: "bid_increase",
        priority: "low",
        auto: false,
        title: `Aumenta offerta: "${kw.keywordText}"`,
        reason: `ACoS ${(acos*100).toFixed(0)}% — sotto target, si può scalare`,
        expectedImpact: `+${Math.round(kw.clicks * 0.2)} click stimati`,
        params: {
          keywordId: kw.keywordId,
          keywordText: kw.keywordText,
          currentBid: kw.bid,
          newBid,
          campaignName: kw.campaignName,
          campaignId: kw.campaignId,
          adGroupId: kw.adGroupId,
        },
      });
    }
  }

  // Search term: 15+ click, 0 conversioni → aggiungi negativa
  for (const st of searchTerms) {
    const conv = st.orders || st.attributedConversions14d || 0;
    if (st.clicks >= 15 && conv === 0 && st.adGroupId) {
      actions.push({
        id: `rule-neg-${st.query?.replace(/\s+/g,"-")}`,
        type: "add_negative",
        priority: "high",
        auto: true,
        title: `Negativa: "${st.query}"`,
        reason: `${st.clicks} click, €${(st.spend||0).toFixed(2)} spesi, 0 conversioni`,
        expectedImpact: `Risparmio ~€${((st.spend||0)*0.9).toFixed(2)}`,
        params: {
          campaignId: st.campaignId,
          adGroupId: st.adGroupId,
          keywordText: st.query,
          matchType: "NEGATIVE_EXACT",
          campaignName: st.campaignName,
        },
      });
    }
  }

  const order = { critical:0, high:1, medium:2, low:3 };
  return actions.sort((a,b) => order[a.priority] - order[b.priority]);
}
