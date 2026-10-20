// Wie betaalde wat: delen berekenen, saldo's en wie wie hoeveel moet overschrijven.
// Alles in cent, zodat er nooit een cent verloren gaat door afronding.

import type { ExpenseShare, Transfer } from "./types";

/**
 * Verdeelt een bedrag gelijk. Wat niet deelbaar is (een cent of twee), draagt wie betaalde,
 * zodat de anderen nooit iets te veel moeten.
 */
export function splitEqual(amountCents: number, memberIds: string[], payerId: string): ExpenseShare[] {
  const ids = memberIds.includes(payerId) ? memberIds : [...memberIds, payerId];
  const base = Math.floor(amountCents / ids.length);
  const remainder = amountCents - base * ids.length;
  return ids.map((id) => ({ member_id: id, share_cents: base + (id === payerId ? remainder : 0) }));
}

/** Controleert zelf ingegeven delen. Geeft een foutmelding terug, of null als alles klopt. */
export function checkCustomShares(amountCents: number, shares: ExpenseShare[]): string | null {
  const seen = new Set<string>();
  let sum = 0;
  for (const s of shares) {
    if (seen.has(s.member_id)) return "Iemand staat twee keer in de verdeling";
    if (!Number.isInteger(s.share_cents) || s.share_cents < 0) return "Elk deel moet een positief bedrag zijn";
    seen.add(s.member_id);
    sum += s.share_cents;
  }
  if (sum !== amountCents) return "De delen zijn samen niet gelijk aan het bedrag";
  return null;
}

export type Debt = { payer: string; member: string; cents: number };
export type Payment = { from: string; to: string; cents: number };

/**
 * Saldo per lid. Positief: krijgt nog geld. Negatief: moet nog betalen.
 * - debts: per (betaler, lid) de som van de delen die dat lid droeg in aankopen van de betaler;
 * - payments: terugbetalingen tussen leden.
 */
export function computeBalances(memberIds: string[], debts: Debt[], payments: Payment[]): Map<string, number> {
  const balances = new Map(memberIds.map((id) => [id, 0]));
  const add = (id: string, cents: number) => balances.set(id, (balances.get(id) ?? 0) + cents);

  for (const d of debts) {
    if (d.payer === d.member) continue;
    add(d.payer, d.cents);
    add(d.member, -d.cents);
  }
  for (const p of payments) {
    add(p.from, p.cents);
    add(p.to, -p.cents);
  }
  return balances;
}

/** Zo weinig mogelijk overschrijvingen om iedereen op nul te zetten. */
export function suggestTransfers(balances: Map<string, number>): Transfer[] {
  const debtors = [...balances].filter(([, b]) => b < 0).map(([id, b]) => ({ id, left: -b }));
  const creditors = [...balances].filter(([, b]) => b > 0).map(([id, b]) => ({ id, left: b }));
  debtors.sort((a, b) => b.left - a.left);
  creditors.sort((a, b) => b.left - a.left);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].left, creditors[j].left);
    transfers.push({ from: debtors[i].id, to: creditors[j].id, amount_cents: amount });
    debtors[i].left -= amount;
    creditors[j].left -= amount;
    if (debtors[i].left === 0) i++;
    if (creditors[j].left === 0) j++;
  }
  return transfers;
}
