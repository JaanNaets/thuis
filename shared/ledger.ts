// Geld: uitgaven, jouw deel en wie wie nog hoeveel moet, uitgerekend uit de gebeurtenissen (nooit bewaard).
//
// - Een gebeurtenis met een bedrag (een aankoop of een dienst) kost dat bedrag. Wie betaalde, staat in `paid_by`;
//   wie de kost deelt in `split` (procenten). Een lijn met een eigenaar (`owner`, "enkel van mij") is helemaal van die
//   persoon; de rest wordt verdeeld. Zonder verdeling is alles van wie betaalde (of van wie het logde).
// - Een overdracht (Jana betaalt Jaan terug) verschuift geld van `paid_by` naar `to_person`.
// - Wie moet wie: per persoon wat hij betaalde min zijn deel; zo weinig mogelijk overschrijvingen om dat recht te
//   zetten (`settleUp`). Bedragen tot op de cent: samen altijd precies het bedrag (`splitCents`).

import type { Share } from "./fields.ts";
import type { Base, Role, Status } from "./model.ts";

/** Wat nodig is om te rekenen met het geld van een gebeurtenis. */
export type MoneyEvent = {
  id: string;
  base: Base;
  status: Status;
  amount: number | null;
  paid_by: string | null;
  split: Share[] | null;
  to_person: string | null;
  created_by: string;
  lines: { price: number | null; owner: string | null }[];
};

/** Telt deze gebeurtenis als uitgave? Gebeurd, met een bedrag, en geen overdracht. */
/**
 * Met wie een nieuwe uitgave (aankoop of dienst) standaard gedeeld wordt: in een lijst waar meer mensen loggen, gelijk
 * over hen, zoals in Splitwise; anders niemand, en dan is ze van wie betaalde. Eten (gebruik: "wie at") en een
 * overdracht krijgen nooit vanzelf een verdeling. Per uitgave kan je het altijd aanpassen.
 */
export function defaultSharers(base: Base, people: { id: string; role: Role }[]): string[] {
  if (base !== "aankoop" && base !== "dienst") return [];
  const loggers = people.filter((p) => p.role === "beheerder" || p.role === "lid").map((p) => p.id);
  return loggers.length > 1 ? loggers : [];
}

export const isExpense = (e: Pick<MoneyEvent, "status" | "amount" | "base">) => e.status === "gebeurd" && e.amount !== null && e.amount !== 0 && e.base !== "overdracht";

/**
 * Een bedrag (in cent) verdelen volgens aandelen. Samen altijd precies het bedrag: een cent die niet deelbaar is,
 * draagt wie betaalde (als die meedeelt), anders wie het dichtst bij de volgende cent zat.
 */
export function splitCents(amount: number, shares: Share[], payer?: string | null): Map<string, number> {
  const out = new Map<string, number>();
  const sum = shares.reduce((s, x) => s + x.share, 0);
  if (!shares.length || !(sum > 0)) return out;
  const total = Math.abs(amount);
  const exact = shares.map((x) => ({ id: x.person_id, raw: (total * x.share) / sum }));
  let given = 0;
  for (const e of exact) {
    const cents = Math.floor(e.raw + 1e-9);
    out.set(e.id, (out.get(e.id) ?? 0) + cents);
    given += cents;
  }
  const order = [...exact].sort((a, b) => Number(b.id === payer) - Number(a.id === payer) || (b.raw % 1) - (a.raw % 1) || a.id.localeCompare(b.id));
  for (let rest = total - given, i = 0; rest > 0; rest--, i = (i + 1) % order.length) out.set(order[i].id, out.get(order[i].id)! + 1);
  if (amount < 0) for (const [id, cents] of out) out.set(id, -cents);
  return out;
}

/** Van wie hoeveel (in cent) van een uitgave is: lijnen met een eigenaar, en de rest volgens de verdeling. */
export function sharesOf(e: MoneyEvent): Map<string, number> {
  const out = new Map<string, number>();
  if (e.amount === null) return out;
  const add = (id: string, cents: number) => out.set(id, (out.get(id) ?? 0) + cents);
  let owned = 0;
  for (const l of e.lines) {
    if (l.owner && l.price) {
      add(l.owner, l.price);
      owned += l.price;
    }
  }
  const rest = e.amount - owned;
  const shares = (e.split ?? []).filter((s) => s.share > 0);
  if (rest !== 0) {
    if (shares.length) for (const [id, cents] of splitCents(rest, shares, e.paid_by)) add(id, cents);
    else add(e.paid_by ?? e.created_by, rest);
  }
  return out;
}

/** Jouw deel van een uitgave (in cent). */
export const mineOf = (e: MoneyEvent, me: string): number => (isExpense(e) ? (sharesOf(e).get(me) ?? 0) : 0);

/** Per persoon: + = krijgt nog, − = moet nog. Uit uitgaven met een betaler en overdrachten. */
export function netBalance(events: MoneyEvent[]): Map<string, number> {
  const net = new Map<string, number>();
  const add = (id: string, cents: number) => net.set(id, (net.get(id) ?? 0) + cents);
  for (const e of events) {
    if (e.status !== "gebeurd" || e.amount === null || !e.paid_by) continue;
    if (e.base === "overdracht") {
      if (!e.to_person || e.to_person === e.paid_by) continue;
      add(e.paid_by, e.amount);
      add(e.to_person, -e.amount);
      continue;
    }
    // Enkel als iemand anders meedeelt, valt er iets te verrekenen.
    const shares = sharesOf(e);
    if ([...shares.keys()].every((id) => id === e.paid_by)) continue;
    add(e.paid_by, e.amount);
    for (const [id, cents] of shares) add(id, -cents);
  }
  for (const [id, v] of net) if (v === 0) net.delete(id);
  return net;
}

export type Transfer = { from: string; to: string; amount: number };

/** Zo weinig mogelijk overschrijvingen: telkens wie het meest moet, aan wie het meest krijgt. */
export function settleUp(net: Map<string, number>): Transfer[] {
  const side = (sign: 1 | -1) =>
    [...net]
      .filter(([, v]) => v * sign > 0)
      .map(([id, v]) => ({ id, left: Math.abs(v) }))
      .sort((a, b) => b.left - a.left || a.id.localeCompare(b.id));
  const owe = side(-1);
  const get = side(1);
  const out: Transfer[] = [];
  for (let i = 0, j = 0; i < owe.length && j < get.length; ) {
    const amount = Math.min(owe[i].left, get[j].left);
    out.push({ from: owe[i].id, to: get[j].id, amount });
    owe[i].left -= amount;
    get[j].left -= amount;
    if (owe[i].left === 0) i++;
    if (get[j].left === 0) j++;
  }
  return out;
}
