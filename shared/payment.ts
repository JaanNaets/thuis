// Betalen met je bank-app: een IBAN nakijken, en een betaal-QR (de Europese EPC-code, "Scan en betaal") die de
// meeste bank-apps kunnen lezen. Zo betaal je iemand terug zonder over te typen.

/** Zonder spaties en in hoofdletters: "be68 5390 0754 7034" → "BE68539007547034". */
export const normalizeIban = (raw: string) => raw.replace(/[\s-]/g, "").toUpperCase();

/** Een IBAN met een kloppend controlegetal (mod 97). */
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/** Per vier, om te tonen: "BE68 5390 0754 7034". */
export const formatIban = (raw: string) => normalizeIban(raw).replace(/(.{4})(?=.)/g, "$1 ");

/**
 * De tekst van een betaal-QR (EPC069-12, versie 002): wie je betaalt, het IBAN, het bedrag in euro en een mededeling.
 * Null als het niet kan (geen geldig IBAN, of een bedrag buiten 0,01–999.999.999,99).
 */
export function epcPayload(to: { name: string; iban: string }, cents: number, message: string): string | null {
  const iban = normalizeIban(to.iban);
  if (!isValidIban(iban) || !Number.isInteger(cents) || cents < 1 || cents > 99_999_999_999) return null;
  const clean = (s: string, max: number) => s.replace(/[\r\n]+/g, " ").trim().slice(0, max);
  return ["BCD", "002", "1", "SCT", "", clean(to.name, 70), iban, `EUR${(cents / 100).toFixed(2)}`, "", "", clean(message, 140)].join("\n");
}
