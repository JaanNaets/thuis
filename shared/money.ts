// Vreemde munt: een bedrag als "45 USD", "$45" of "£12,50" omrekenen naar euro met de dagkoers van de Europese
// Centrale Bank (gratis, één keer per werkdag). Een bedrag in de app is altijd in euro (cent).

export type Rates = { date: string; rates: Record<string, number> };

const SYMBOLS: Record<string, string> = { $: "USD", "£": "GBP", "¥": "JPY", "€": "EUR" };

/** "45 USD", "usd 45", "$45", "£12,50" → bedrag en munt; null als er geen (andere) munt bij staat. */
export function parseForeign(text: string): { amount: number; currency: string } | null {
  const m = text.trim().match(/^([A-Za-z]{3}|[$£¥€])?\s*(\d[\d.,\s]*)\s*([A-Za-z]{3}|[$£¥€])?$/);
  if (!m || (m[1] && m[3]) || !(m[1] || m[3])) return null;
  const code = m[1] ?? m[3];
  const currency = SYMBOLS[code] ?? code.toUpperCase();
  // Komma of punt als decimaalteken; een punt of spatie per duizendtal.
  let n = m[2].replace(/\s/g, "");
  const comma = n.lastIndexOf(",");
  const dot = n.lastIndexOf(".");
  if (comma > -1 && dot > -1) n = comma > dot ? n.replace(/\./g, "").replace(",", ".") : n.replace(/,/g, "");
  else if (comma > -1) n = n.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(n)) n = n.replace(/\./g, "");
  const amount = Number(n);
  return Number.isFinite(amount) && amount > 0 ? { amount, currency } : null;
}

/** Naar euro (cent) met de koersen (1 EUR = koers × munt); null als de munt onbekend is. */
export function toEuroCents(amount: number, currency: string, rates: Rates): number | null {
  if (currency === "EUR") return Math.round(amount * 100);
  const rate = rates.rates[currency];
  return rate && rate > 0 ? Math.round((amount / rate) * 100) : null;
}

/** De dagkoersen uit het XML-bestand van de ECB. */
export function fromEcbXml(xml: string): Rates | null {
  const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  const rates: Record<string, number> = {};
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[m[1]] = Number(m[2]);
  return date && Object.keys(rates).length ? { date, rates } : null;
}
