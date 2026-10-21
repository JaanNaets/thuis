// Verkopers: soorten, en het controleren en netjes tonen van IBAN, ondernemingsnummer en website.

export const VENDOR_KINDS = {
  store: { label: "Winkel", plural: "Winkels" },
  webshop: { label: "Webshop", plural: "Webshops" },
  craftsman: { label: "Vakman", plural: "Vakmensen" },
  service: { label: "Dienst", plural: "Diensten" },
  private: { label: "Particulier", plural: "Particulieren" },
} as const;
export type VendorKind = keyof typeof VENDOR_KINDS;

export function isVendorKind(value: unknown): value is VendorKind {
  return typeof value === "string" && Object.hasOwn(VENDOR_KINDS, value);
}

// ---------- IBAN ----------

/** Lengte van een IBAN per land (de landen waar we het meest mee te maken hebben). Andere landen: 15–34. */
const IBAN_LENGTHS: Record<string, number> = { BE: 16, NL: 18, LU: 20, FR: 27, DE: 22, ES: 24, IT: 27, GB: 22, AT: 20 };

/** "be68 5390 0754 7034" → "BE68539007547034". */
export function normalizeIban(value: string): string {
  return value.replace(/[\s.-]/g, "").toUpperCase();
}

/** Controle met de officiële mod-97-test, zodat een tikfout meteen opvalt. */
export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected && iban.length !== expected) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/** "BE68539007547034" → "BE68 5390 0754 7034". */
export function formatIban(value: string): string {
  return normalizeIban(value).replace(/(.{4})(?=.)/g, "$1 ");
}

// ---------- ondernemingsnummer ----------

/**
 * Belgisch ondernemingsnummer (= btw-nummer zonder "BE"): "BE 0123.456.749" → "0123456749".
 * Een buitenlands nummer (bv. "NL123456789B01") blijft zoals het is, zonder spaties.
 */
export function normalizeCompanyNumber(value: string): string {
  const compact = value.replace(/[\s.-]/g, "").toUpperCase();
  const belgian = compact.replace(/^BE/, "");
  if (/^\d{9,10}$/.test(belgian)) return belgian.padStart(10, "0");
  return compact;
}

/** Belgische nummers krijgen de controle op de laatste twee cijfers; buitenlandse enkel een vorm-controle. */
export function isValidCompanyNumber(value: string): boolean {
  const number = normalizeCompanyNumber(value);
  if (/^\d{10}$/.test(number)) {
    if (number[0] !== "0" && number[0] !== "1") return false;
    return 97 - (Number(number.slice(0, 8)) % 97) === Number(number.slice(8));
  }
  return /^[A-Z]{2}[A-Z0-9]{2,18}$/.test(number);
}

/** "0123456749" → "0123.456.749"; buitenlandse nummers ongewijzigd. */
export function formatCompanyNumber(value: string): string {
  const number = normalizeCompanyNumber(value);
  return /^\d{10}$/.test(number) ? `${number.slice(0, 4)}.${number.slice(4, 7)}.${number.slice(7)}` : number;
}

// ---------- website ----------

/** "coolblue.be" → "https://coolblue.be". Leeg blijft leeg. */
export function normalizeWebsite(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** "https://www.coolblue.be/nl" → "coolblue.be/nl", om te tonen. */
export function displayWebsite(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}
