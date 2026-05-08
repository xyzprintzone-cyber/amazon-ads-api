// ai-engine.js — GPT-4o analizza le campagne e genera azioni concrete
import fetch from "node-fetch";

// Lazy config — read after .env is loaded
function cfg() {
  return {
    OPENAI_KEY:  process.env.OPENAI_API_KEY,
    ACOS_TARGET: parseFloat(process.env.ACOS_TARGET  || "0.40"),
    BUDGET_MAX:  parseFloat(process.env.DAILY_BUDGET_MAX || "30.00"),
  };
}

function getSystemPrompt() {
  const { ACOS_TARGET, BUDGET_MAX } = cfg();
  return `Sei un esperto di Amazon Advertising con 10 anni di esperienza nell'ottimizzazione di campagne Sponsored Products per il marketplace IT.

Il tuo obiettivo è massimizzare le vendite mantenendo ACoS ≤ ${(ACOS_TARGET*100).toFixed(0)}% e budget totale ≤ €${BUDGET_MAX}/giorno.

Regole di ottimizzazione:
- BID: modifica massima ±30% per singolo aggiornamento. Minimo €0.10, massimo €2.00
- PAUSA: solo keyword con ≥10 click e 0 conversioni negli ultimi 7 giorni
- NEGATIVA: aggiungi search term con ≥8 click, 0 conversioni, spesa > €2
- SCALA: aumenta bid del 10-20% su keyword con ACoS < 25% e ≥3 conversioni
- BUDGET: non aumentare mai il budget totale oltre €${BUDGET_MAX}/gg
- NON toccare campagne con meno di 5 giorni di dati

Output SOLO JSON valido, nessun testo aggiuntivo. Formato:
{
  "summary": "stringa riassuntiva di cosa hai trovato e perché agisci così",
  "actions": [
    {
      "type": "bid_change|pause_keyword|enable_keyword|add_negative|pause_campaign|budget_change",
      "entityType": "keyword|campaign|search_term",
      "entityId": "id numerico come stringa",
      "entityName": "nome leggibile",
      "campaignName": "nome campagna",
      "oldValue": numero_attuale,
      "newValue": nuovo_valore_proposto,
      "reason": "spiegazione breve in italiano",
      "expectedImpact": "es: ACoS stimato -15%, risparmio €2.40/gg"
    }
  ]
}`;
}

export async function analyzeAndGenerateActions(data) {
  const { campaigns, keywords, searchTerms } = data;

  // Prepara contesto compatto per GPT
  const context = buildContext(campaigns, keywords, searchTerms);

  const userMsg = `Analizza questi dati delle campagne Amazon Ads IT e genera le azioni di ottimizzazione necessarie.

DATI ATTUALI (ultimi 7 giorni):
${JSON.stringify(context, null, 2)}

Genera le azioni concrete da eseguire adesso.`;

  const { OPENAI_KEY } = cfg();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: getSystemPrompt() },
        { role: "user", content: userMsg },
      ],
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${err.slice(0, 200)}`);
  }

  const d = await res.json();
  const content = d.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI: risposta vuota");

  const result = JSON.parse(content);
  console.log(`[AI] Summary: ${result.summary}`);
  console.log(`[AI] Azioni generate: ${result.actions?.length || 0}`);

  return result;
}

function buildContext(campaigns, keywords, searchTerms) {
  // Campagne — top 20 per spesa
  const campContext = campaigns.slice(0, 20).map(c => ({
    id: String(c.campaignId || c.campaign_id || ""),
    name: c.name || c.campaignName || "",
    state: c.state,
    budget: c.dailyBudget ? (c.dailyBudget / 100).toFixed(2) : c.daily_budget,
    spend7d: c.cost?.toFixed(2) || "0",
    sales7d: c.sales?.toFixed(2) || "0",
    orders7d: c.orders || 0,
    acos: c.acos ? (c.acos * 100).toFixed(1) + "%" : "n/d",
    clicks7d: c.clicks || 0,
    impressions7d: c.impressions || 0,
    cpc: c.cpc?.toFixed(2) || "0",
    roas: c.roas?.toFixed(2) || "0",
  }));

  // Keyword — top 50 per spesa
  const kwContext = (keywords || []).slice(0, 50).map(k => {
    const acos = (k.attributedSales14d || k.sales || 0) > 0
      ? (k.cost || 0) / (k.attributedSales14d || k.sales)
      : null;
    return {
      id: String(k.keywordId || k.keyword_id || ""),
      text: k.keywordText || k.keyword_text || "",
      match: k.matchType || k.match_type || "",
      campaign: k.campaignName || k.campaign_name || "",
      adGroup: k.adGroupName || k.ad_group_name || "",
      state: k.state,
      bid: k.bid?.toFixed(2) || "0",
      clicks: k.clicks || 0,
      spend: (k.cost || 0).toFixed(2),
      orders: k.attributedConversions14d || k.orders || 0,
      sales: (k.attributedSales14d || k.sales || 0).toFixed(2),
      acos: acos !== null ? (acos * 100).toFixed(1) + "%" : "n/d",
    };
  });

  // Search term — top 30 problematici (click alti, 0 conv)
  const stContext = (searchTerms || [])
    .filter(s => (s.clicks || 0) >= 3)
    .sort((a, b) => (b.cost || 0) - (a.cost || 0))
    .slice(0, 30)
    .map(s => ({
      query: s.query || s.keywordText || "",
      campaign: s.campaignName || "",
      adGroup: s.adGroupName || "",
      clicks: s.clicks || 0,
      spend: (s.cost || 0).toFixed(2),
      orders: s.attributedConversions14d || 0,
      sales: (s.attributedSales14d || 0).toFixed(2),
    }));

  return {
    summary: {
      totalSpend7d: campaigns.reduce((s, c) => s + (c.cost || 0), 0).toFixed(2),
      totalSales7d: campaigns.reduce((s, c) => s + (c.sales || 0), 0).toFixed(2),
      totalOrders7d: campaigns.reduce((s, c) => s + (c.orders || 0), 0),
      acosTarget: (cfg().ACOS_TARGET * 100).toFixed(0) + "%",
      dailyBudgetMax: "€" + cfg().BUDGET_MAX,
    },
    campaigns: campContext,
    keywords: kwContext,
    searchTerms: stContext,
  };
}
