// Regels: gedrag bovenop een lijst. Een lijst blijft een gewone lijst met velden; een regel zegt welke velden samen
// iets betekenen (dit is het bedrag, dit is wie betaalde) en wat de app ermee doet.
//
// - split (Kosten verdelen): elk item is een uitgave. Wie betaalde, legde het bedrag voor; de verdeling zegt wie welk
//   deel draagt. Leeg = de standaardverdeling van de regel, anders gelijk over iedereen in het project.
// - settle (Terugbetalingen): elk item is geld dat iemand aan iemand anders gaf.
//
// Samen geven ze per project wie wie nog hoeveel moet. Alles in cent.

import { FIELD_TYPES, normalizeShares, type Attributes, type FieldDef, type FieldType, type Share } from "./fields.ts";

export type SplitRule = { kind: "split"; amount: string; payer: string; for: string; default?: Share[] };
export type SettleRule = { kind: "settle"; amount: string; from: string; to: string };
export type Rule = SplitRule | SettleRule;
export type RuleKind = Rule["kind"];

export const RULE_KINDS = {
  split: {
    label: "Kosten verdelen",
    hint: "Elk item is een uitgave: wie betaalde en hoe het verdeeld wordt. Samen geeft dat wie wie nog hoeveel moet.",
  },
  settle: {
    label: "Terugbetalingen",
    hint: "Elk item is geld dat iemand aan iemand anders gaf. Telt mee in wie wie nog hoeveel moet.",
  },
} as const satisfies Record<RuleKind, { label: string; hint: string }>;

/** Welke velden een regel nodig heeft, en van welke soort. */
export const RULE_FIELDS = {
  split: [
    { role: "amount", label: "Bedrag", type: "money" },
    { role: "payer", label: "Betaald door", type: "person" },
    { role: "for", label: "Verdeling", type: "share" },
  ],
  settle: [
    { role: "amount", label: "Bedrag", type: "money" },
    { role: "from", label: "Van", type: "person" },
    { role: "to", label: "Aan", type: "person" },
  ],
} as const satisfies Record<RuleKind, readonly { role: string; label: string; type: FieldType }[]>;

/**
 * De regels van een lijst nakijken tegen haar velden. Hooguit één (een lijst is uitgaven of terugbetalingen). Gooit
 * een fout met uitleg.
 */
export function cleanRules(raw: unknown, fields: FieldDef[]): Rule[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 1) throw new Error("Hooguit één regel per lijst");
  return raw.map((r): Rule => {
    const o = (r ?? {}) as Record<string, unknown>;
    if (o.kind !== "split" && o.kind !== "settle") throw new Error("Onbekende regel");
    const kind = o.kind;
    const pick: Record<string, string> = {};
    for (const need of RULE_FIELDS[kind]) {
      const def = fields.find((f) => f.key === o[need.role]);
      if (!def || def.type !== need.type)
        throw new Error(`${RULE_KINDS[kind].label}: kies een veld voor "${need.label}" (${FIELD_TYPES[need.type].label.toLowerCase()})`);
      pick[need.role] = def.key;
    }
    if (kind === "settle") {
      if (pick.from === pick.to) throw new Error("Terugbetalingen: Van en Aan zijn twee verschillende velden");
      return { kind, amount: pick.amount, from: pick.from, to: pick.to };
    }
    const rule: SplitRule = { kind, amount: pick.amount, payer: pick.payer, for: pick.for };
    const shares = normalizeShares(o.default ?? null);
    if (shares.length) rule.default = shares;
    return rule;
  });
}

/** De velden die een regel gebruikt (die kan je niet weghalen zolang de regel er is). */
export function ruleFieldKeys(rule: Rule): string[] {
  return rule.kind === "split" ? [rule.amount, rule.payer, rule.for] : [rule.amount, rule.from, rule.to];
}

/** De verdeling als ze leeg is: de standaard van de regel (wie nog in het project zit), anders gelijk over iedereen. */
export function defaultShares(rule: SplitRule, members: string[]): Share[] {
  const kept = (rule.default ?? []).filter((s) => members.includes(s.person_id));
  if (kept.length) return normalizeShares(kept);
  return members.length ? normalizeShares(members.map((id) => ({ person_id: id }))) : [];
}

/**
 * Wat een regel invult als het leeg is: de verdeling, en bij een nieuw item wie betaalde (jij, als je in het
 * project zit). Wat ingevuld is, blijft.
 */
export function applyRuleDefaults(rules: Rule[], data: Attributes, members: string[], me: string, isNew: boolean): Attributes {
  const out = { ...data };
  for (const rule of rules) {
    if (rule.kind !== "split") continue;
    if (isNew && out[rule.payer] === undefined && members.includes(me)) out[rule.payer] = me;
    if (out[rule.for] === undefined) {
      const shares = defaultShares(rule, members);
      if (shares.length) out[rule.for] = shares;
    }
  }
  return out;
}

/**
 * Een bedrag (in cent) verdelen volgens aandelen. Samen altijd precies het bedrag: een cent die niet deelbaar is,
 * draagt wie betaalde (als die meedeelt), anders wie het dichtst bij de volgende cent zat.
 */
export function splitCents(amount: number, shares: Share[], payer?: string): Map<string, number> {
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

/** Eén geldbeweging: wie legde voor, en wie draagt welk deel. */
export type Movement = { amount: number; payer: string; shares: Share[] };

/** Van een item naar een geldbeweging; null als er iets ontbreekt (dan telt het niet mee). */
export function movementOf(rule: Rule, data: Attributes): Movement | null {
  const amount = data[rule.amount];
  if (typeof amount !== "number" || amount === 0) return null;
  if (rule.kind === "settle") {
    const from = data[rule.from];
    const to = data[rule.to];
    if (typeof from !== "string" || typeof to !== "string" || from === to) return null;
    return { amount, payer: from, shares: [{ person_id: to, share: 100 }] };
  }
  const payer = data[rule.payer];
  const shares = data[rule.for];
  if (typeof payer !== "string" || !Array.isArray(shares) || shares.length === 0) return null;
  return { amount, payer, shares: shares as Share[] };
}

/** Per persoon: meer dan 0 = krijgt nog geld, minder dan 0 = moet nog betalen. Samen altijd 0. */
export function balances(movements: Movement[]): Map<string, number> {
  const net = new Map<string, number>();
  const add = (id: string, cents: number) => net.set(id, (net.get(id) ?? 0) + cents);
  for (const m of movements) {
    add(m.payer, m.amount);
    for (const [id, cents] of splitCents(m.amount, m.shares, m.payer)) add(id, -cents);
  }
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
