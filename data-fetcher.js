// data-fetcher.js — raccoglie dati reali da Amazon Ads API v3
import * as api from "./amazon-api.js";

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function yesterday() {
  return daysAgo(1);
}

/**
 * Fetch completo: campagne + keyword
 * Ritorna { campaigns, keywords, fetchedAt, dateRange }
 */
export async function fetchAllData(days = 7) {
  const startDate = daysAgo(days);
  const endDate   = yesterday(); // Amazon ha 24h lag

  console.log(`[FETCH] Periodo: ${startDate} → ${endDate}`);

  // 1. Lista campagne (struttura + budget)
  console.log("[FETCH] Campagne...");
  const campaignList = await api.getCampaigns();

  // 2. Lista keyword (struttura + bid corrente)
  console.log("[FETCH] Keywords...");
  let keywordList = [];
  try {
    keywordList = await api.getKeywords();
  } catch (e) {
    console.warn("[FETCH] Keywords fallito:", e.message);
  }

  // 3. Report campagne (performance stats)
  let campaignStats = [];
  try {
    console.log("[FETCH] Report performance campagne (async)...");
    campaignStats = await api.fetchCampaignReport(startDate, endDate);
    console.log(`[FETCH] Report campagne: ${campaignStats.length} righe`);
  } catch (e) {
    console.warn("[FETCH] Report campagne fallito:", e.message);
  }

  // 4. Report keyword (performance stats)
  let keywordStats = [];
  try {
    console.log("[FETCH] Report performance keyword (async)...");
    keywordStats = await api.fetchKeywordReport(startDate, endDate);
    console.log(`[FETCH] Report keyword: ${keywordStats.length} righe`);
  } catch (e) {
    console.warn("[FETCH] Report keyword fallito:", e.message);
  }

  // Merge campagne struttura + stats
  const campaigns = mergeCampaignData(campaignList, campaignStats);

  // Merge keyword struttura + stats
  const keywords = mergeKeywordData(keywordList, keywordStats);

  console.log(`[FETCH] Risultati: ${campaigns.length} campagne, ${keywords.length} keyword`);

  return {
    campaigns,
    keywords,
    searchTerms: [],
    fetchedAt: new Date().toISOString(),
    dateRange: { start: startDate, end: endDate },
  };
}

function mergeCampaignData(campaignList, statsRows) {
  // statsRows fields from v3 report: campaignId, campaignName, impressions, clicks, spend, sales7d, orders7d
  const statsMap = {};
  for (const row of (statsRows || [])) {
    const id = row.campaignId;
    if (!id) continue;
    if (!statsMap[id]) statsMap[id] = { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
    statsMap[id].impressions += Number(row.impressions) || 0;
    statsMap[id].clicks      += Number(row.clicks)      || 0;
    statsMap[id].cost        += Number(row.cost)        || 0;
    statsMap[id].sales       += Number(row.sales7d)     || 0;
    statsMap[id].orders      += Number(row.purchases7d) || 0;
  }

  return campaignList.map(c => {
    const s = statsMap[c.campaignId] || {};
    const cost   = s.cost   || 0;
    const sales  = s.sales  || 0;
    const clicks = s.clicks || 0;
    const impressions = s.impressions || 0;
    const budget = c.budget?.budget ?? null;
    return {
      campaignId:    c.campaignId,
      name:          c.name,
      state:         c.state,
      targetingType: c.targetingType,
      dailyBudgetEur: budget,
      cost,
      clicks,
      impressions,
      orders: s.orders || 0,
      sales,
      acos:  sales > 0 ? cost / sales : null,
      ctr:   impressions > 0 ? clicks / impressions : 0,
      cpc:   clicks > 0 ? cost / clicks : 0,
      roas:  cost > 0 ? sales / cost : null,
      acosStatus: sales > 0
        ? (cost / sales > (parseFloat(process.env.ACOS_TARGET) || 0.40) ? "high" : "ok")
        : "no_data",
    };
  });
}

function mergeKeywordData(keywordList, statsRows) {
  // statsRows fields from v3 report: keywordId, keywordText, matchType, campaignId, adGroupId, impressions, clicks, spend, sales7d, orders7d
  const statsMap = {};
  for (const row of (statsRows || [])) {
    const id = row.keywordId;
    if (!id) continue;
    if (!statsMap[id]) statsMap[id] = { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
    statsMap[id].impressions += Number(row.impressions) || 0;
    statsMap[id].clicks      += Number(row.clicks)      || 0;
    statsMap[id].cost        += Number(row.cost)                     || 0;
    statsMap[id].sales       += Number(row.attributedSales7d)        || 0;
    statsMap[id].orders      += Number(row.attributedConversions7d)  || 0;
  }

  return keywordList.map(k => {
    const s = statsMap[k.keywordId] || {};
    const cost   = s.cost   || 0;
    const sales  = s.sales  || 0;
    const clicks = s.clicks || 0;
    const impressions = s.impressions || 0;
    return {
      keywordId:   k.keywordId,
      keywordText: k.keywordText,
      matchType:   k.matchType,
      campaignId:  k.campaignId,
      adGroupId:   k.adGroupId,
      state:       k.state,
      bid:         k.bid || 0,
      cost,
      clicks,
      impressions,
      orders: s.orders || 0,
      sales,
      acos:  sales > 0 ? cost / sales : null,
      ctr:   impressions > 0 ? clicks / impressions : 0,
      cpc:   clicks > 0 ? cost / clicks : 0,
    };
  });
}
