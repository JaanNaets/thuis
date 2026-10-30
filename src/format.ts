const euro = new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" });
const shortDate = new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "short", year: "numeric" });

export function formatCents(cents: number | null): string {
  return cents === null ? "" : euro.format(cents / 100);
}

/** Zet wat iemand intypt ("12,50", "1.234,56", "€ 8") om naar cent. Leeg = null, onleesbaar = NaN. */
export function parseEuro(input: string): number | null {
  let s = input.replace(/[€\s]/g, "");
  if (s === "") return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Beide aanwezig: het laatste teken is het decimaalteken.
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    s = s.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma > -1) {
    s = s.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.234" is in België duizend tweehonderdvierendertig.
    s = s.split(".").join("");
  }

  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

/** Bedrag in cent terug naar invoertekst ("12,50"). */
export function centsToInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

/** Datums zijn "YYYY-MM-DD" zonder tijdzone; we rekenen ermee als lokale datum. */
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatDate(iso: string): string {
  return shortDate.format(parseLocalDate(iso));
}

export function today(): string {
  return toIso(new Date());
}

export function addYears(iso: string, years: number): string {
  const date = parseLocalDate(iso);
  date.setFullYear(date.getFullYear() + years);
  return toIso(date);
}

export type WarrantyStatus = { label: string; tone: "ok" | "soon" | "expired" | "none" };

export function warrantyStatus(until: string | null): WarrantyStatus {
  if (!until) return { label: "Geen garantie", tone: "none" };
  const now = today();
  if (until < now) return { label: "Garantie verlopen", tone: "expired" };
  const daysLeft = Math.round((parseLocalDate(until).getTime() - parseLocalDate(now).getTime()) / 86_400_000);
  if (daysLeft <= 60) return { label: `Garantie nog ${daysLeft} d`, tone: "soon" };
  return { label: `Garantie tot ${formatDate(until)}`, tone: "ok" };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const dateTime = new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const monthName = new Intl.DateTimeFormat("nl-BE", { month: "long", year: "numeric" });
// Zonder duizendtallen: "1.000" zou bij het terug inlezen 1 worden.
const number = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 3, useGrouping: false });

/** SQLite bewaart "2026-10-19 14:32:00" in UTC; we tonen het in lokale tijd. */
export function formatDateTime(sqlUtc: string): string {
  return dateTime.format(new Date(`${sqlUtc.replace(" ", "T")}Z`));
}

/** "2026-10" → "oktober 2026". */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return monthName.format(new Date(y, m - 1, 1));
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function thisMonth(): string {
  return today().slice(0, 7);
}

export function formatNumber(n: number): string {
  return number.format(n);
}

const big = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 0 });
const small = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 1 });

/** Een getal in een totaal: met duizendtallen, vanaf 100 zonder kommagetal ("1.050 kcal", "12,5 km"). */
export function formatTotal(n: number): string {
  return (Math.abs(n) >= 100 ? big : small).format(n);
}

/** "1 fles", "3 flessen", "1,5 kg". */
export function formatQuantity(quantity: number, unit: string, plurals: Record<string, string>): string {
  const word = quantity === 1 ? unit : (plurals[unit] ?? unit);
  return `${formatNumber(quantity)} ${word}`;
}

/** "1,5" of "1.5" → 1.5. Leeg = null, onleesbaar = NaN. */
export function parseQuantity(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (s === "") return null;
  return /^\d+(\.\d{1,3})?$/.test(s) ? Number(s) : NaN;
}

/** Aantal dagen tot een datum (negatief = voorbij). */
export function daysUntil(iso: string): number {
  return Math.round((parseLocalDate(iso).getTime() - parseLocalDate(today()).getTime()) / 86_400_000);
}
