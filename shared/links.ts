// Verbanden tussen lijsten: wat de ene lijst met de andere doet. Niets hiervan wordt bewaard; het volgt uit de velden,
// berekeningen en totalen van elke lijst (en de lijsten die een subproject als tab toont). De Worker geeft enkel de
// velden mee die de lezer mag zien, dus een verband dat op iets verborgens steunt, bestaat voor hem niet.
//
// Op de kaart (zie `layoutLinks`) is elk project een kolom, elke lijst een punt en elk verband een lijn. Alles wat in
// dezelfde lijst toekomt, rijdt op één rij: zo blijft de kaart rustig, en volgt de plaats van alles uit een vaste regel
// (geen zware berekening, en niets verspringt als er iets bijkomt).

import { canAgenda } from "./agenda.ts";
import { refLists, type FieldDef } from "./fields.ts";
import type { IconKey } from "./templates.ts";
import type { CalcKind } from "./calc.ts";
import { totalLabel, type TotalDef } from "./totals.ts";
import type { Tone } from "./types.ts";

export type LinkKind = "adjust" | "total" | "calc" | "agenda" | "ref" | "tab";

/** De soorten verbanden, in de volgorde van de knoppen. `tone`: de kleur van de lijn (geen: grijs). */
export const LINK_KINDS = {
  adjust: { label: "Telt bij of af", tone: "peach" },
  total: { label: "Totalen", tone: "sky" },
  calc: { label: "Berekeningen", tone: "lilac" },
  agenda: { label: "Agenda", tone: "mint" },
  ref: { label: "Verwijzingen", tone: null },
  tab: { label: "Tabs in subprojecten", tone: null },
} as const satisfies Record<LinkKind, { label: string; tone: Tone | null }>;

export const KIND_ORDER = Object.keys(LINK_KINDS) as LinkKind[];

/** Geen lijst, wel een eindpunt: de agenda, en Wie moet wie op het project. */
export const AGENDA_NODE = "agenda";
export const BALANCE_NODE = "balance";

/** Een verband: de items van `from` werken in op `to` (of wijzen ernaar). `texts`: wat het doet, per veld of totaal. */
export type Link = { kind: LinkKind; from: string; to: string; texts: string[] };

/** De kolom rechts op de kaart: lijsten in andere projecten (en de agenda). */
export const OUTSIDE = "out";
/** Zoveel subprojecten op één kaart (naast het project zelf); de rest heeft elk een eigen kaart. */
export const MAX_COLUMNS = 6;
/** Zoveel lijsten uit andere projecten op één kaart. */
export const MAX_OUTSIDE = 24;
/** Zoveel namen van subprojecten die niet meer op de kaart passen (de rest vind je via zoeken of de boom). */
export const MAX_MORE = 30;

/**
 * Een punt op de kaart: een lijst (in haar project), een lijst als tab in een subproject (`id` = lijst@project), de
 * agenda of Wie moet wie. `count`: items van de lijst in dat project (enkel op de kaart zelf).
 */
export type LinkNode = {
  id: string;
  list_id: string | null;
  name: string;
  icon: IconKey | null;
  project_id: string;
  project_name: string;
  column: string;
  count: number | null;
};
/** Een kolom: het project zelf (eerst), dan zijn subprojecten. */
export type LinkColumn = { id: string; name: string; color: Tone | null };
/**
 * De kaart van één project. `quiet`: subprojecten zonder verbanden. `more`: wat niet meer op deze kaart past (de
 * eerste subprojecten bij naam, en hoeveel het er zijn).
 */
export type LinkMap = {
  columns: LinkColumn[];
  nodes: LinkNode[];
  links: Link[];
  quiet: { id: string; name: string }[];
  more: { projects: { id: string; name: string }[]; project_count: number; outside: number };
};

/** Een lijst zoals de kaart ze nodig heeft: enkel de velden en totalen die de lezer ziet. */
export type LinkList = { id: string; fields: FieldDef[]; totals: TotalDef[] };

// ---------- altijd mee ----------
// Elke eigenschap van een veld, een berekening en een totaal staat hieronder, met of ze een verband met een andere
// lijst maakt. Komt er een eigenschap bij (een nieuwe werking van de app), dan weigert TypeScript te bouwen tot je hier
// beslist; wat `true` is, moet `listLinks` tonen (test/links.test.ts kijkt dat na met een voorbeeld per eigenschap).

/** Velden: welke eigenschappen een lijst met een andere verbinden. */
export const FIELD_LINKS = {
  key: false,
  label: false,
  type: false,
  options: false,
  unit: false,
  ref_type: true,
  ref_also: true,
  free: false,
  format: false,
  column: false,
  filter: false,
  required: false,
  today: false,
  me: false,
  fill: false,
  default_shares: false,
  product: false,
  counter: false,
  remind: false,
  yearly: false,
  agenda: true,
  adjust: true,
  copy: true,
  hint: false,
  calc: true,
  result: false,
} as const satisfies Record<keyof FieldDef, boolean>;

/** Berekeningen: welke soorten met andere lijsten rekenen. */
export const CALC_LINKS = {
  math: false,
  formula: false,
  compare: false,
  days_until: false,
  since: false,
  date_add: false,
  lookup: true,
  rollup: true,
} as const satisfies Record<CalcKind, boolean>;

/** Totalen: welke eigenschappen een lijst met een andere (of met Wie moet wie) verbinden. */
export const TOTAL_LINKS = {
  id: false,
  label: false,
  agg: false,
  field: false,
  period: false,
  date: false,
  by: false,
  goal: false,
  goal_kind: false,
  scope: false,
  sources: true,
  against: false,
  settle: true,
  mine: false,
  goals: false,
  size: false,
  chart: false,
} as const satisfies Record<keyof TotalDef, boolean>;

const labelOf = (fields: FieldDef[] | undefined, key: string | undefined) => (key ? fields?.find((f) => f.key === key)?.label : undefined);

/**
 * De verbanden die uit één lijst volgen. `fieldsOf`: de velden (die de lezer ziet) van een andere lijst, voor de namen
 * in de uitleg; onbekend = de naam blijft weg. Een verwijzing naar zichzelf (een plaats in een plaats) telt niet.
 */
export function listLinks(list: LinkList, fieldsOf: (listId: string) => FieldDef[] | undefined = () => undefined): Link[] {
  const out: Link[] = [];
  const add = (kind: LinkKind, from: string | undefined, to: string | undefined, text: string) => {
    if (from && to && from !== to) out.push({ kind, from, to, texts: [text] });
  };
  for (const f of list.fields) {
    for (const to of f.type === "item" || f.type === "items" ? refLists(f) : []) {
      if (f.adjust) {
        const by = f.adjust.by ? labelOf(list.fields, f.adjust.by) : "1";
        const target = labelOf(fieldsOf(to), f.adjust.field);
        const text =
          f.adjust.sign < 0
            ? by && target
              ? `Trekt ${by} af van ${target}`
              : "Trekt af"
            : by && target
              ? `Telt ${by} bij ${target}`
              : "Telt bij";
        add("adjust", list.id, to, text);
      } else {
        add("ref", list.id, to, f.copy ? `Verwijst met ${f.label} en neemt over` : `Verwijst met ${f.label}`);
      }
    }
    if (f.type === "calc" && f.calc) {
      const c = f.calc;
      if (c.kind === "lookup" || (c.kind === "rollup" && c.from === "links")) {
        const via = list.fields.find((x) => x.key === c.via);
        for (const from of via ? refLists(via) : []) add("calc", from, list.id, `Levert ${f.label}`);
      } else if (c.kind === "rollup" && c.from === "backlinks") {
        add("calc", c.list, list.id, `Levert ${f.label}`);
      }
    }
    if (f.agenda && canAgenda(f)) add("agenda", list.id, AGENDA_NODE, `${f.label} in de agenda`);
  }
  for (const t of list.totals) {
    const label = totalLabel(t, list.fields);
    for (const source of t.sources ?? []) add("total", source, list.id, `Telt mee in ${label}`);
    if (t.settle) add("total", list.id, BALANCE_NODE, `Telt mee in ${label}`);
  }
  return out;
}

/**
 * Samenvoegen: één verband per richting en soort (met alle uitleg erin). Een gewone verwijzing valt weg als dezelfde
 * twee lijsten al op een andere manier verbonden zijn (een samenvatting over een verwijzing is één verband, geen twee).
 */
export function mergeLinks(links: Link[]): Link[] {
  const byKey = new Map<string, Link>();
  for (const l of links) {
    const key = `${l.kind}\u0000${l.from}\u0000${l.to}`;
    const cur = byKey.get(key);
    if (cur) cur.texts = [...new Set([...cur.texts, ...l.texts])];
    else byKey.set(key, { ...l, texts: [...l.texts] });
  }
  const pair = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const other = new Set([...byKey.values()].filter((l) => l.kind !== "ref").map((l) => pair(l.from, l.to)));
  return [...byKey.values()]
    .filter((l) => l.kind !== "ref" || !other.has(pair(l.from, l.to)))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

// ---------- de kaart ----------

export type LayoutNode = { id: string; column: string };
/** Waar een punt staat: kolom, plaats in de kolom (`slot`) en rij. */
export type Place = { col: number; slot: number; row: number };
export type Layout = {
  /** Per rij: de lijst waar alles op deze rij naartoe gaat, en de soorten die er rijden (elk een eigen baan). */
  rows: { hub: string; kinds: LinkKind[] }[];
  places: Map<string, Place>;
  /** Hoeveel plaatsen naast elkaar elke kolom nodig heeft (minstens 1). */
  slots: number[];
};

/**
 * Schikt de kaart. De regel:
 * - Elke lijst waar een verband in toekomt, krijgt een eigen rij (wie het meest binnenkrijgt bovenaan, de agenda
 *   onderaan). Een lijst die enkel iets doorgeeft, staat op de rij van de eerste lijst waar ze in toekomt.
 * - Een lijn loopt eerst verticaal bij de lijst waar ze vertrekt (naar de rij van haar doel), dan horizontaal naar het
 *   doel. Op een rij staan dus enkel lijsten die naar die rij gaan: een lijn die erdoor loopt, hoort er echt bij.
 * - In een kolom krijgen twee punten elk een eigen plaats naast elkaar als hun verticale lijnen elkaar zouden raken.
 * Zuiver en voorspelbaar: dezelfde lijsten geven altijd dezelfde kaart.
 */
export function layoutLinks(columns: string[], nodes: LayoutNode[], links: Pick<Link, "kind" | "from" | "to">[]): Layout {
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const known = links.filter((l) => order.has(l.from) && order.has(l.to));
  const incoming = new Map<string, number>();
  for (const l of known) incoming.set(l.to, (incoming.get(l.to) ?? 0) + 1);

  const hubs = [...incoming.keys()].sort(
    (a, b) =>
      Number(a === AGENDA_NODE) - Number(b === AGENDA_NODE) || incoming.get(b)! - incoming.get(a)! || order.get(a)! - order.get(b)!,
  );
  const hubRow = new Map(hubs.map((h, i) => [h, i]));
  const targets = new Map<string, number[]>();
  for (const l of known) targets.set(l.from, [...(targets.get(l.from) ?? []), hubRow.get(l.to)!]);

  const rowOf = (id: string) => hubRow.get(id) ?? Math.min(...(targets.get(id) ?? [0]));
  const colIndex = new Map(columns.map((c, i) => [c, i]));
  const placed = nodes.filter((n) => colIndex.has(n.column) && (incoming.has(n.id) || targets.has(n.id)));

  const places = new Map<string, Place>();
  const slots = columns.map(() => 1);
  // Per kolom en plaats: de rijen die een punt (met zijn verticale lijnen) al inneemt.
  const taken = columns.map(() => [] as [number, number][][]);
  const sorted = [...placed].sort((a, b) => rowOf(a.id) - rowOf(b.id) || order.get(a.id)! - order.get(b.id)!);
  for (const n of sorted) {
    const row = rowOf(n.id);
    const reach = [row, ...(targets.get(n.id) ?? [])];
    const span: [number, number] = [Math.min(...reach), Math.max(...reach)];
    const col = colIndex.get(n.column)!;
    let slot = 0;
    while (taken[col][slot]?.some(([a, b]) => a <= span[1] && span[0] <= b)) slot++;
    (taken[col][slot] ??= []).push(span);
    slots[col] = Math.max(slots[col], slot + 1);
    places.set(n.id, { col, slot, row });
  }

  const rows = hubs.map((hub) => ({
    hub,
    kinds: KIND_ORDER.filter((k) => known.some((l) => l.to === hub && l.kind === k)),
  }));
  return { rows, places, slots };
}
