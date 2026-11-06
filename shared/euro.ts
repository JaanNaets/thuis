// Bedragen tonen zoals in België: "€ 1.234,56" (ook op de server, voor meldingen).

const EURO = new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" });

/** Cent naar "€ 12,50". */
export const formatEuro = (cents: number) => EURO.format(cents / 100);
