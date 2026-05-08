// Mock data based on real XYZ PRINT ZONE account
// Replace with real API calls when Amazon grants SP API access

export const mockCampaigns = [
  {
    campaignId: 101234567,
    name: "Scritta 3D - SP - Auto",
    state: "enabled",
    dailyBudget: 1500, // €15.00 in cents
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
];

export const mockKeywords = [
  { keywordId: 201001, keywordText: "scritta 3d personalizzata", matchType: "exact", state: "enabled", bid: 0.75, campaignId: 101234568 },
  { keywordId: 201002, keywordText: "scritta led personalizzata", matchType: "phrase", state: "enabled", bid: 0.55, campaignId: 101234568 },
  { keywordId: 201003, keywordText: "scritta luminosa nome", matchType: "broad", state: "enabled", bid: 0.40, campaignId: 101234568 },
  { keywordId: 201004, keywordText: "portachiavi personalizzato", matchType: "exact", state: "enabled", bid: 0.60, campaignId: 101234570 },
  { keywordId: 201005, keywordText: "portachiavi nome inciso", matchType: "phrase", state: "enabled", bid: 0.45, campaignId: 101234570 },
  { keywordId: 201006, keywordText: "regalo personalizzato", matchType: "broad", state: "paused", bid: 0.30, campaignId: 101234568 },
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
];
