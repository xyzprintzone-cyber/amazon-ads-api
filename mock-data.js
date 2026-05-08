// Mock data — XYZ PRINT ZONE · IT marketplace
// Dati giornalieri per permettere filtraggio per intervallo date

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Genera dati giornalieri per ogni campagna (ultimi 30 giorni)
// I dati di OGGI sono sempre 0 (campagne appena avviate nella giornata)
function generateDailyStats(seed, multiplier = 1.0) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = [];

  for (let i = 0; i <= 30; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateStr = date.toISOString().slice(0, 10);

    if (i === 0) {
      // Oggi: nessun dato ancora (dati Amazon arrivano con 24h di ritardo)
      rows.push({ date: dateStr, cost: 0, clicks: 0, impressions: 0, orders: 0, sales: 0 });
      continue;
    }

    // Variabilità realistica basata sul seed
    const variance = 0.7 + Math.abs(Math.sin(seed * i * 0.7)) * 0.6;
    const weekdayBoost = [0, 1, 2, 3, 4].includes(date.getDay()) ? 1.15 : 0.80; // lun-ven più alto

    const impressions = Math.round(300 * multiplier * variance * weekdayBoost);
    const ctr = 0.015 + Math.abs(Math.sin(seed * i)) * 0.02; // 1.5%–3.5%
    const clicks = Math.round(impressions * ctr);
    const cpc = (0.30 + Math.abs(Math.sin(seed * i * 1.3)) * 0.50) * multiplier;
    const cost = parseFloat((clicks * cpc).toFixed(2));
    const cvr = 0.03 + Math.abs(Math.sin(seed * i * 0.4)) * 0.05;
    const orders = Math.round(clicks * cvr);
    const aov = 10 + seed * 2.5; // average order value
    const sales = parseFloat((orders * aov).toFixed(2));

    rows.push({ date: dateStr, cost, clicks, impressions, orders, sales });
  }

  return rows;
}

// ── Campagne ─────────────────────────────────────────────────────────────────
export const mockCampaigns = [
  {
    campaignId: 101234567,
    name: "Scritta 3D - SP - Auto",
    state: "enabled",
    dailyBudget: 1500, // centesimi
    targetingType: "auto",
    dailyStats: generateDailyStats(1, 1.2),
  },
  {
    campaignId: 101234568,
    name: "Scritta 3D - SP - Manual",
    state: "enabled",
    dailyBudget: 1000,
    targetingType: "manual",
    dailyStats: generateDailyStats(2, 1.0),
  },
  {
    campaignId: 101234569,
    name: "Portachiavi - SP - Auto",
    state: "enabled",
    dailyBudget: 800,
    targetingType: "auto",
    dailyStats: generateDailyStats(3, 0.8),
  },
  {
    campaignId: 101234570,
    name: "Portachiavi - SP - Manual",
    state: "paused",
    dailyBudget: 500,
    targetingType: "manual",
    dailyStats: generateDailyStats(4, 0.0), // paused → zero
  },
  {
    campaignId: 101234571,
    name: "Targa Personalizzata - SP - Auto",
    state: "enabled",
    dailyBudget: 1200,
    targetingType: "auto",
    dailyStats: generateDailyStats(5, 1.1),
  },
  {
    campaignId: 101234572,
    name: "Targa Personalizzata - SP - Manual",
    state: "enabled",
    dailyBudget: 900,
    targetingType: "manual",
    dailyStats: generateDailyStats(6, 0.9),
  },
];

// ── Keywords ──────────────────────────────────────────────────────────────────
export const mockKeywords = [
  // Scritta 3D Manual
  { keywordId: 201001, keywordText: "scritta 3d personalizzata", matchType: "exact", state: "enabled", bid: 0.75, campaignId: 101234568, impressions: 1200, clicks: 38, cost: 13.30, attributedConversions14d: 3, attributedSales14d: 34.20 },
  { keywordId: 201002, keywordText: "scritta led personalizzata", matchType: "phrase", state: "enabled", bid: 0.55, campaignId: 101234568, impressions: 980, clicks: 22, cost: 7.70, attributedConversions14d: 2, attributedSales14d: 22.80 },
  { keywordId: 201003, keywordText: "scritta luminosa nome", matchType: "broad", state: "enabled", bid: 0.40, campaignId: 101234568, impressions: 750, clicks: 18, cost: 5.40, attributedConversions14d: 0, attributedSales14d: 0 },
  { keywordId: 201006, keywordText: "regalo personalizzato", matchType: "broad", state: "enabled", bid: 0.30, campaignId: 101234568, impressions: 2100, clicks: 55, cost: 11.00, attributedConversions14d: 0, attributedSales14d: 0 },
  // Targa Manual
  { keywordId: 201007, keywordText: "targa personalizzata casa", matchType: "exact", state: "enabled", bid: 0.90, campaignId: 101234572, impressions: 1600, clicks: 45, cost: 18.00, attributedConversions14d: 1, attributedSales14d: 9.90 },
  { keywordId: 201008, keywordText: "targa nome porta", matchType: "phrase", state: "enabled", bid: 0.65, campaignId: 101234572, impressions: 1100, clicks: 32, cost: 8.32, attributedConversions14d: 2, attributedSales14d: 19.80 },
  { keywordId: 201009, keywordText: "targa ingresso personalizzata", matchType: "broad", state: "enabled", bid: 0.50, campaignId: 101234572, impressions: 880, clicks: 18, cost: 6.30, attributedConversions14d: 0, attributedSales14d: 0 },
];

// ── Search Terms ──────────────────────────────────────────────────────────────
export const mockSearchTerms = [
  { query: "scritta 3d personalizzata camera", keywordText: "scritta 3d personalizzata", campaignName: "Scritta 3D - SP - Manual", impressions: 450, clicks: 23, cost: 8.05, attributedConversions14d: 3, attributedSales14d: 34.20 },
  { query: "scritta led nome", keywordText: "scritta led personalizzata", campaignName: "Scritta 3D - SP - Manual", impressions: 320, clicks: 18, cost: 5.40, attributedConversions14d: 2, attributedSales14d: 22.80 },
  { query: "decorazione camera led", keywordText: "scritta luminosa nome", campaignName: "Scritta 3D - SP - Manual", impressions: 680, clicks: 12, cost: 3.60, attributedConversions14d: 0, attributedSales14d: 0 },
  { query: "luce notturna personalizzata", keywordText: "scritta luminosa nome", campaignName: "Scritta 3D - SP - Manual", impressions: 210, clicks: 8, cost: 2.40, attributedConversions14d: 0, attributedSales14d: 0 },
  { query: "portachiavi personalizzato nome", keywordText: "portachiavi personalizzato", campaignName: "Portachiavi - SP - Manual", impressions: 380, clicks: 19, cost: 4.75, attributedConversions14d: 2, attributedSales14d: 17.00 },
  { query: "portachiavi incisione", keywordText: "portachiavi nome inciso", campaignName: "Portachiavi - SP - Manual", impressions: 290, clicks: 14, cost: 4.20, attributedConversions14d: 1, attributedSales14d: 8.50 },
  { query: "regalo compleanno originale", keywordText: "regalo personalizzato", campaignName: "Scritta 3D - SP - Manual", impressions: 920, clicks: 31, cost: 6.20, attributedConversions14d: 0, attributedSales14d: 0 },
  { query: "idee regalo bambini", keywordText: "regalo personalizzato", campaignName: "Scritta 3D - SP - Manual", impressions: 750, clicks: 22, cost: 4.40, attributedConversions14d: 0, attributedSales14d: 0 },
  { query: "targa porta ingresso personalizzata", keywordText: "targa personalizzata casa", campaignName: "Targa Personalizzata - SP - Manual", impressions: 540, clicks: 24, cost: 9.60, attributedConversions14d: 1, attributedSales14d: 9.90 },
  { query: "targa con nome famiglia", keywordText: "targa nome porta", campaignName: "Targa Personalizzata - SP - Manual", impressions: 410, clicks: 16, cost: 5.20, attributedConversions14d: 2, attributedSales14d: 19.80 },
  { query: "targa casa legno personalizzata", keywordText: "targa ingresso personalizzata", campaignName: "Targa Personalizzata - SP - Manual", impressions: 330, clicks: 11, cost: 3.85, attributedConversions14d: 0, attributedSales14d: 0 },
  // High-converting search terms NOT in keywords list — AI should suggest adding these
  { query: "scritta neon personalizzata", keywordText: "scritta led personalizzata", campaignName: "Scritta 3D - SP - Auto", impressions: 290, clicks: 14, cost: 4.20, attributedConversions14d: 4, attributedSales14d: 45.60 },
  { query: "portachiavi cuore incisione", keywordText: "portachiavi personalizzato", campaignName: "Portachiavi - SP - Auto", impressions: 180, clicks: 9, cost: 2.70, attributedConversions14d: 3, attributedSales14d: 22.50 },
  { query: "targa benvenuto personalizzata", keywordText: "targa personalizzata casa", campaignName: "Targa Personalizzata - SP - Auto", impressions: 220, clicks: 12, cost: 3.60, attributedConversions14d: 3, attributedSales14d: 29.70 },
];
