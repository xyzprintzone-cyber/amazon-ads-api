// Mock data based on real XYZ PRINT ZONE account
// Replace with real API calls when Amazon grants SP API access

export const mockCampaigns = [
  {
    campaignId: 101234567,
    name: "Scritta 3D - SP - Auto",
    state: "enabled",
    dailyBudget: 1500, // cents
    cost: 12.34,
    clicks: 87,
    impressions: 4230,
    attributedConversions14d: 4,
    attributedSales14d: 45.60,
  },
  {
    campaignId: 101234568,
    name: "Scritta 3D - SP - Manual",
    state: "enabled",
    dailyBudget: 1000,
    cost: 8.90,
    clicks: 62,
    impressions: 3100,
    attributedConversions14d: 3,
    attributedSales14d: 34.20,
  },
  {
    campaignId: 101234569,
    name: "Portachiavi - SP - Auto",
    state: "enabled",
    dailyBudget: 800,
    cost: 5.60,
    clicks: 44,
    impressions: 2200,
    attributedConversions14d: 3,
    attributedSales14d: 25.50,
  },
  {
    campaignId: 101234570,
    name: "Portachiavi - SP - Manual",
    state: "paused",
    dailyBudget: 500,
    cost: 0,
    clicks: 0,
    impressions: 0,
    attributedConversions14d: 0,
    attributedSales14d: 0,
  },
  {
    campaignId: 101234571,
    name: "Targa Personalizzata - SP - Auto",
    state: "enabled",
    dailyBudget: 1200,
    cost: 9.80,
    clicks: 71,
    impressions: 3850,
    attributedConversions14d: 5,
    attributedSales14d: 60.00,
  },
  {
    campaignId: 101234572,
    name: "Targa Personalizzata - SP - Manual",
    state: "enabled",
    dailyBudget: 900,
    cost: 14.20,
    clicks: 95,
    impressions: 4900,
    attributedConversions14d: 2,
    attributedSales14d: 19.80,
  },
];

export const mockKeywords = [
  // Scritta 3D Manual
  { keywordId: 201001, keywordText: "scritta 3d personalizzata", matchType: "exact", state: "enabled", bid: 0.75, campaignId: 101234568, impressions: 1200, clicks: 38, cost: 13.30, attributedConversions14d: 3, attributedSales14d: 34.20 },
  { keywordId: 201002, keywordText: "scritta led personalizzata", matchType: "phrase", state: "enabled", bid: 0.55, campaignId: 101234568, impressions: 980, clicks: 22, cost: 7.70, attributedConversions14d: 2, attributedSales14d: 22.80 },
  { keywordId: 201003, keywordText: "scritta luminosa nome", matchType: "broad", state: "enabled", bid: 0.40, campaignId: 101234568, impressions: 750, clicks: 18, cost: 5.40, attributedConversions14d: 0, attributedSales14d: 0 },
  { keywordId: 201006, keywordText: "regalo personalizzato", matchType: "broad", state: "enabled", bid: 0.30, campaignId: 101234568, impressions: 2100, clicks: 55, cost: 11.00, attributedConversions14d: 0, attributedSales14d: 0 },
  // Portachiavi Manual
  { keywordId: 201004, keywordText: "portachiavi personalizzato", matchType: "exact", state: "enabled", bid: 0.60, campaignId: 101234570, impressions: 820, clicks: 28, cost: 8.40, attributedConversions14d: 2, attributedSales14d: 17.00 },
  { keywordId: 201005, keywordText: "portachiavi nome inciso", matchType: "phrase", state: "enabled", bid: 0.45, campaignId: 101234570, impressions: 530, clicks: 16, cost: 4.80, attributedConversions14d: 1, attributedSales14d: 8.50 },
  // Targa Manual
  { keywordId: 201007, keywordText: "targa personalizzata casa", matchType: "exact", state: "enabled", bid: 0.90, campaignId: 101234572, impressions: 1600, clicks: 45, cost: 18.00, attributedConversions14d: 1, attributedSales14d: 9.90 },
  { keywordId: 201008, keywordText: "targa nome porta", matchType: "phrase", state: "enabled", bid: 0.65, campaignId: 101234572, impressions: 1100, clicks: 32, cost: 8.32, attributedConversions14d: 2, attributedSales14d: 19.80 },
  { keywordId: 201009, keywordText: "targa ingresso personalizzata", matchType: "broad", state: "enabled", bid: 0.50, campaignId: 101234572, impressions: 880, clicks: 18, cost: 6.30, attributedConversions14d: 0, attributedSales14d: 0 },
];

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
