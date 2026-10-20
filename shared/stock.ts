// Voorraadlogica die de Worker gebruikt en die we los kunnen testen.

import type { StockLevel } from "./types";

/** Hoeveelheden op 3 cijfers na de komma (1,5 kg; 0,25 l), zonder zwevendekommaruis. */
export function roundQuantity(q: number): number {
  return Math.round(q * 1000) / 1000;
}

/**
 * Waar nemen we iets weg als niemand een plaats koos? Eerst wat het eerst vervalt,
 * dan de standaardplaats van het item, dan waar het meeste ligt.
 */
export function pickConsumeLocation(levels: StockLevel[], defaultLocationId: string | null): StockLevel | undefined {
  return levels
    .filter((l) => l.quantity > 0)
    .sort(
      (a, b) =>
        (a.next_expiry ?? "9999").localeCompare(b.next_expiry ?? "9999") ||
        Number(b.location_id === defaultLocationId) - Number(a.location_id === defaultLocationId) ||
        b.quantity - a.quantity,
    )[0];
}

/** Totaal over alle plaatsen en de vroegste vervaldatum. */
export function summarizeLevels(levels: StockLevel[]): { quantity: number; next_expiry: string | null } {
  let quantity = 0;
  let next: string | null = null;
  for (const l of levels) {
    quantity += l.quantity;
    if (l.next_expiry && (!next || l.next_expiry < next)) next = l.next_expiry;
  }
  return { quantity: roundQuantity(quantity), next_expiry: next };
}

/** Op of bijna op: onder het minimum dat je zelf instelde. */
export function isLow(quantity: number, minQuantity: number | null): boolean {
  return minQuantity !== null && quantity < minQuantity;
}

/** Vervalt binnen `days` dagen (of is al vervallen). */
export function expiresSoon(nextExpiry: string | null, today: string, days = 7): boolean {
  if (!nextExpiry) return false;
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  return nextExpiry <= limit.toISOString().slice(0, 10);
}
