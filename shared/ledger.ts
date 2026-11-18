// Geld: jouw deel van een uitgave en wie wie nog hoeveel moet.
//
// - Een gebeurtenis met een bedrag kost dat bedrag. Wie betaalde, staat in `paid_by`; wie de kost deelt in `split`
//   (procenten). Een lijn met een eigenaar (`owner`, "enkel van mij") is helemaal van die persoon; de rest wordt
//   verdeeld. Zonder verdeling is alles van wie betaalde (of van wie het logde). Bedragen tot op de cent: samen altijd
//   precies het bedrag (`splitCents`).
// - Wie moet wie is het saldo per persoon: een cel (shared/cells.ts, `BALANCE`) in een lijst met een saldo per persoon.
//   Wie betaalde krijgt het bedrag erbij, wie deelt zijn deel eraf, wie een overdracht krijgt het bedrag eraf. Zo
//   weinig mogelijk overschrijvingen om dat recht te zetten: `settleUp`.

import type { FieldDef, Share } from "./fields.ts";
import type { Parts, Role } from "./model.ts";

/** Een lijst met een saldo per persoon: in welke kolom de persoon van een rij staat, en in welke zijn saldo. */
export type LedgerDef = { person: string; field: string };

/** Nakijken: een persoonveld en een bedrag (of getal) van de lijst; anders null (geen saldo). */
export function cleanLedger(raw: unknown, fields: Pick<FieldDef, "key" | "type">[]): LedgerDef | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const person = fields.find((f) => f.key === o.person && f.type === "person");
  const field = fields.find((f) => f.key === o.field && (f.type === "money" || f.type === "number"));
  return person && field ? { person: person.key, field: field.key } : null;
}

/** Wat nodig is om een bedrag te verdelen. */
export type Money = {
  amount: number | null;
  paid_by: string | null;
  split: Share[] | null;
  created_by: string;
  lines: { price: number | null; owner: string | null }[];
};

/**
 * Met wie een nieuwe uitgave standaard gedeeld wordt: met een formulier met geld (geen overdracht) in een lijst waar
 * meer mensen loggen, gelijk over hen, zoals in Splitwise; anders niemand, en dan is ze van wie betaalde. Per uitgave
 * kan je het altijd aanpassen.
 */
export function defaultSharers(parts: Pick<Parts, "money" | "to">, people: { id: string; role: Role }[]): string[] {
  if (!parts.money || parts.to) return [];
  const loggers = people.filter((p) => p.role === "beheerder" || p.role === "lid").map((p) => p.id);
  return loggers.length > 1 ? loggers : [];
}

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
export function sharesOf(e: Money): Map<string, number> {
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
