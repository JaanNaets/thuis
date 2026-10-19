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
