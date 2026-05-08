// ai-engine.js — Groq (llama-3.3-70b) optimizer
import fetch from "node-fetch";

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const MODEL    = "llama-3.3-70b-versatile";

export async function analyzeAndGenerateActions(data, acosTarget = 0.40) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");

  const { campaigns = [], keywords = [], reportData = {} } = data;

  // Build compact summary for the prompt
  const campSummary = campaigns.slice(0, 50).map(c => ({
    id:     c.campaignId,
    name:   c.name,
    state:  c.state,
    budget: c.budget?.budget,
  }));

  const kwSummary = (keywords || []).slice(0, 100).map(k => ({
    id:       k.keywordId,
    text:     k.keywordText,
    matchType: k.matchType,
    bid:      k.bid,
    state:    k.state,
    campId:   k.campaignId,
  }));

  const perfMap = {};
  if (reportData.campaigns) {
    for (const r of reportData.campaigns) {
      perfMap[r.campaignId] = {
        impressions: r.impressions,
        clicks:      r.clicks,
        cost:        r.cost,
        sales:       r.sales7d || r.attributedSales7d || 0,
        acos:        r.cost && r.sales7d ? r.cost / r.sales7d : null,
      };
    }
  }
  if (reportData.keywords) {
    for (const r of reportData.keywords) {
      perfMap[`kw_${r.keywordId}`] = {
        impressions: r.impressions,
        clicks:      r.clicks,
        cost:        r.cost,
        sales:       r.attributedSales7d || r.sales7d || 0,
        acos:        r.cost && (r.attributedSales7d || r.sales7d)
                       ? r.cost / (r.attributedSales7d || r.sales7d) : null,
      };
    }
  }

  const prompt = `You are an Amazon Ads optimizer. ACoS target: ${(acosTarget * 100).toFixed(0)}%.

CAMPAIGNS (${campSummary.length}):
${JSON.stringify(campSummary, null, 1)}

KEYWORDS (${kwSummary.length}):
${JSON.stringify(kwSummary, null, 1)}

PERFORMANCE (last 7 days):
${JSON.stringify(perfMap, null, 1)}

Rules:
- Bid changes max ±35%, min €0.10, max €2.00
- Only act on keywords with enough data (>5 clicks or >100 impressions)
- Pause keywords with 0 conversions and cost > 2x ACoS target
- Increase bids when ACoS is well below target and CTR is good
- Decrease bids when ACoS is above target

Respond with ONLY a JSON array of actions, no explanation:
[
  {"type":"update_bid","keywordId":"...","newBid":0.50,"reason":"..."},
  {"type":"pause_keyword","keywordId":"...","reason":"..."},
  {"type":"enable_keyword","keywordId":"...","reason":"..."},
  {"type":"update_budget","campaignId":"...","newBudget":15.00,"reason":"..."},
  {"type":"pause_campaign","campaignId":"...","reason":"..."}
]

If no actions needed, return [].`;

  const res = await fetch(GROQ_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model:       MODEL,
      messages:    [{ role: "user", content: prompt }],
      max_tokens:  4096,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Groq error ${res.status}: ${txt}`);
  }

  const d = await res.json();
  const content = d.choices?.[0]?.message?.content || "[]";

  // Extract JSON array from response
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) {
    console.warn("[AI] No JSON array in response:", content.slice(0, 200));
    return [];
  }

  try {
    const actions = JSON.parse(match[0]);
    console.log(`[AI] Groq generated ${actions.length} actions`);
    return Array.isArray(actions) ? actions : [];
  } catch (e) {
    console.warn("[AI] JSON parse failed:", e.message);
    return [];
  }
}
