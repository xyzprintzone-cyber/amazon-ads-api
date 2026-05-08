// csv-parser.js — Parsa CSV export da Amazon Ads Console
// Supporta: Campaign Performance, Search Term Report

/**
 * Mappatura colonne Amazon Ads → campi interni
 * Amazon esporta in italiano o inglese a seconda delle impostazioni account
 */
const COL_MAP = {
  // --- Campaign ---
  campaign:        ["Campaign Name","Nome campagna","Campagna"],
  state:           ["Status","Stato","Campaign Status"],
  date:            ["Date","Data","Start Date","Day"],
  impressions:     ["Impressions","Impression","Visualizzazioni"],
  clicks:          ["Clicks","Click","Clic"],
  spend:           ["Spend","Spesa","Cost","Costo"],
  sales:           ["7 Day Total Sales","14 Day Total Sales","Vendite totali 7 giorni","Vendite totali 14 giorni","Sales","Vendite","Attributed Sales"],
  orders:          ["7 Day Total Orders (#)","14 Day Total Orders (#)","Ordini totali 7 giorni","Orders","Ordini","Attributed Conversions"],
  ctr:             ["CTR","Click-Through Rate"],
  cpc:             ["CPC","Cost Per Click","Costo per clic"],
  acos:            ["ACoS","ACOS","Total ACoS"],
  roas:            ["ROAS","Total ROAS"],
  // --- Keyword ---
  keyword:         ["Keyword","Parola chiave","Customer Search Term","Search Term","Termine di ricerca"],
  matchType:       ["Match Type","Tipo di corrispondenza"],
  bid:             ["Bid","Offerta"],
  adGroup:         ["Ad Group Name","Gruppo di annunci"],
};

function findCol(headers, candidates) {
  for (const c of candidates) {
    const idx = headers.findIndex(h => h.trim().toLowerCase() === c.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseNum(val) {
  if (!val || val.trim() === "" || val.trim() === "--" || val.trim() === "-") return 0;
  // Rimuovi simboli valuta, spazi, e gestisci sia virgola che punto decimale
  const cleaned = val.replace(/[€$£%\s]/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseDate(val) {
  if (!val) return null;
  const s = val.trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // MM/DD/YYYY or DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [a, b, y] = s.split("/");
    // Se primo > 12 è DD/MM
    if (parseInt(a) > 12) return `${y}-${b.padStart(2,"0")}-${a.padStart(2,"0")}`;
    // Altrimenti assume MM/DD (Amazon US) ma se contesto IT usa DD/MM
    return `${y}-${a.padStart(2,"0")}-${b.padStart(2,"0")}`;
  }
  return null;
}

/**
 * Parsea testo CSV completo
 * Ritorna { type, campaigns, searchTerms, keywords, dateRange, rowCount }
 */
export function parseAmazonCSV(csvText) {
  // Normalizza line endings
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  
  // Trova la riga header (salta righe vuote e summary iniziali)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const l = lines[i];
    if (l.includes("Campaign") || l.includes("Campagna") || l.includes("Keyword") || l.includes("Date") || l.includes("Data")) {
      headerIdx = i;
      break;
    }
  }

  const rawHeaders = parseCSVLine(lines[headerIdx]);
  const headers = rawHeaders.map(h => h.trim());

  // Determina tipo di report
  const hasKeyword = findCol(headers, ["Keyword","Parola chiave"]) !== -1;
  const hasSearchTerm = findCol(headers, ["Customer Search Term","Search Term","Termine di ricerca"]) !== -1;
  const hasDate = findCol(headers, COL_MAP.date) !== -1;

  const idxCampaign    = findCol(headers, COL_MAP.campaign);
  const idxDate        = findCol(headers, COL_MAP.date);
  const idxImpressions = findCol(headers, COL_MAP.impressions);
  const idxClicks      = findCol(headers, COL_MAP.clicks);
  const idxSpend       = findCol(headers, COL_MAP.spend);
  const idxSales       = findCol(headers, COL_MAP.sales);
  const idxOrders      = findCol(headers, COL_MAP.orders);
  const idxKeyword     = findCol(headers, COL_MAP.keyword);
  const idxMatchType   = findCol(headers, COL_MAP.matchType);
  const idxBid         = findCol(headers, COL_MAP.bid);
  const idxAdGroup     = findCol(headers, COL_MAP.adGroup);

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    if (cols.length < 3) continue;
    // Salta righe totale/summary
    const first = (cols[0] || "").toLowerCase();
    if (first.includes("totale") || first.includes("total") || first === "") continue;
    rows.push(cols);
  }

  if (rows.length === 0) {
    return { ok: false, error: "Nessun dato trovato nel CSV. Verifica il formato." };
  }

  // Aggrega per campagna e data
  const campaignMap = {}; // campaignName → { name, state, dailyStats: {date→stats} }
  const keywordList = [];
  const searchTermList = [];
  let minDate = "9999-99-99", maxDate = "0000-00-00";

  for (const cols of rows) {
    const campaignName = idxCampaign !== -1 ? (cols[idxCampaign] || "").trim() : "Campagna sconosciuta";
    const dateStr      = idxDate !== -1 ? parseDate(cols[idxDate]) : null;
    const impressions  = idxImpressions !== -1 ? parseNum(cols[idxImpressions]) : 0;
    const clicks       = idxClicks !== -1 ? parseNum(cols[idxClicks]) : 0;
    const spend        = idxSpend !== -1 ? parseNum(cols[idxSpend]) : 0;
    const sales        = idxSales !== -1 ? parseNum(cols[idxSales]) : 0;
    const orders       = idxOrders !== -1 ? parseNum(cols[idxOrders]) : 0;

    if (!campaignMap[campaignName]) {
      campaignMap[campaignName] = { name: campaignName, state: "enabled", dailyStats: {} };
    }

    const key = dateStr || "nodate";
    if (!campaignMap[campaignName].dailyStats[key]) {
      campaignMap[campaignName].dailyStats[key] = { date: dateStr, cost: 0, clicks: 0, impressions: 0, orders: 0, sales: 0 };
    }
    campaignMap[campaignName].dailyStats[key].cost        += spend;
    campaignMap[campaignName].dailyStats[key].clicks      += clicks;
    campaignMap[campaignName].dailyStats[key].impressions += impressions;
    campaignMap[campaignName].dailyStats[key].orders      += orders;
    campaignMap[campaignName].dailyStats[key].sales       += sales;

    if (dateStr && dateStr < minDate) minDate = dateStr;
    if (dateStr && dateStr > maxDate) maxDate = dateStr;

    // Keyword report
    if (hasKeyword && idxKeyword !== -1) {
      const kwText = (cols[idxKeyword] || "").trim();
      if (kwText) {
        keywordList.push({
          keywordText: kwText,
          matchType: idxMatchType !== -1 ? (cols[idxMatchType] || "broad").trim() : "broad",
          bid: idxBid !== -1 ? parseNum(cols[idxBid]) : 0,
          campaignName,
          adGroup: idxAdGroup !== -1 ? (cols[idxAdGroup] || "").trim() : "",
          clicks, spend, sales, orders, impressions,
          acos: sales > 0 ? spend / sales : null,
        });
      }
    }

    // Search term report
    if (hasSearchTerm && idxKeyword !== -1) {
      const query = (cols[idxKeyword] || "").trim();
      if (query) {
        searchTermList.push({
          query,
          campaignName,
          adGroup: idxAdGroup !== -1 ? (cols[idxAdGroup] || "").trim() : "",
          clicks, cost: spend, sales, orders: orders, impressions,
          attributedConversions14d: orders,
          attributedSales14d: sales,
          acos: sales > 0 ? spend / sales : null,
        });
      }
    }
  }

  // Converti campaignMap → array con dailyStats array
  const campaigns = Object.values(campaignMap).map((c, idx) => ({
    campaignId: 900000 + idx,
    name: c.name,
    state: c.state,
    dailyBudget: 3000, // default €30 — non disponibile nel report
    targetingType: c.name.toLowerCase().includes("auto") ? "auto" : "manual",
    dailyStats: Object.values(c.dailyStats).map(s => ({
      ...s,
      cost: parseFloat(s.cost.toFixed(2)),
      sales: parseFloat(s.sales.toFixed(2)),
    })).sort((a, b) => (a.date || "").localeCompare(b.date || "")),
  }));

  return {
    ok: true,
    type: hasSearchTerm ? "search_term" : hasKeyword ? "keyword" : "campaign",
    campaigns,
    keywords: keywordList,
    searchTerms: searchTermList,
    dateRange: { start: minDate === "9999-99-99" ? null : minDate, end: maxDate === "0000-00-00" ? null : maxDate },
    rowCount: rows.length,
    uploadedAt: new Date().toISOString(),
  };
}

/**
 * Parsea una riga CSV rispettando i campi tra virgolette
 */
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if ((ch === "," || ch === "\t") && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
