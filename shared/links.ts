// Verbanden: hoe je lijsten met elkaar en met de weergaven samenhangen. Niets hiervan wordt bewaard. Het volgt uit de
// velden van de lijsten en hun soorten (verwijzingen, datums, productinfo) en uit wat er gelogd is (lijnen van een
// gebeurtenis naar dingen van een andere lijst, soorten van een andere lijst, geld, gepland, herhalen).
//
// De Worker geeft enkel mee wat de lezer ziet: zijn lijsten (`seenLists`), en tellingen over gebeurtenissen in die
// lijsten met lijnen naar dingen in die lijsten. Wie een gebeurtenis in haar lijst ziet, ziet ze helemaal (ook een lijn
// "bij"), dus zo'n telling verraadt niets; een verband met een lijst die je niet ziet, bestaat voor jou niet.

import type { BlockKind } from "./board.ts";
import { canAgenda } from "./agenda.ts";
import { refLists, type FieldDef } from "./fields.ts";
import { BASES, LINE_ROLES, type Base, type Event, type Kind, type Line, type LineRole, type List, type Role } from "./model.ts";

// ---------- altijd mee ----------
// Elke eigenschap van een veld, een lijst, een soort, een gebeurtenis, een lijn en elk soort blok staat hieronder, met
// of ze een lijst met iets anders verbindt. Komt er een eigenschap bij, dan weigert TypeScript te bouwen tot je hier
// beslist; wat `true` is, moet `buildLinks` tonen (test/links.test.ts kijkt dat na met een voorbeeld per eigenschap).

/** Velden (van een lijst of een soort). */
export const FIELD_LINKS = {
  key: false,
  label: false,
  type: false,
  options: false,
  unit: false,
  ref_type: true, // verwijst naar de dingen van een andere lijst
  ref_also: true, // … en van nog andere lijsten
  free: false,
  format: false,
  column: false,
  filter: false,
  required: false,
  today: false,
  me: false,
  fill: false,
  default_shares: false,
  product: true, // gegevens uit Open Food Facts of NEVO; kcal rekent mee in Eten
  counter: false, // valt weg (cleanListFields): voorraad telt de lijst
  measure: false, // valt weg (cleanListFields)
  aliases: true, // de naam op een kasticket wordt onthouden
  remember: false, // valt weg (cleanListFields)
  remember_by: false,
  remember_fixed: false,
  remind: true, // een herinnering zoveel dagen vooraf
  yearly: false, // hoort bij remind
  remind_at: false, // hoort bij remind
  agenda: true, // de datum staat in de agenda
  spawn: false, // valt weg (cleanListFields)
  adjust: false, // valt weg (cleanListFields): tellen doen lijnen
  copy: true, // een verwijzing die waarden overneemt
  per: false,
  hint: false,
  portion: false,
  timer_goal: false, // valt weg (cleanListFields): een timer is een activiteit met een doel op de soort
  timer_into: false,
  calc: false, // rekent enkel binnen het ding (cleanListFields weigert een verwijzende berekening)
  result: false,
} as const satisfies Record<keyof FieldDef, boolean>;

/** Lijsten. */
export const LIST_LINKS = {
  id: false,
  name: false,
  one: false,
  icon: false,
  color: false,
  fields: true, // zie FIELD_LINKS
  stock: true, // telt voorraad (Voorraad, Bijna op)
  notify: true, // melding bij iets nieuws
  archived: false, // een gearchiveerde lijst staat niet op de kaart
  created_at: false,
} as const satisfies Record<keyof List, boolean>;

/** Eigen soorten. */
export const KIND_LINKS = {
  id: false,
  list_id: true, // een andere lijst kan met deze soort loggen
  base: true, // bepaalt mee in welke weergave een gebeurtenis komt (zie EVENT_LINKS)
  name: false,
  icon: false,
  fields: true, // zie FIELD_LINKS (kcal: Eten; een verwijzing: naar die lijst)
  goal: true, // een activiteit die loopt, geeft na zoveel minuten een melding
  sort_order: false,
} as const satisfies Record<keyof Kind, boolean>;

/** Gebeurtenissen (wat er gelogd is). */
export const EVENT_LINKS = {
  id: false,
  list_id: true, // waar ze in het logboek staat
  kind: true, // een soort van een andere lijst
  base: true, // gebruik met kcal: Eten; activiteit zonder einde: Loopt nu
  name: false,
  status: true, // gepland: Te doen, Agenda en een herinnering op de dag
  at: false, // elke gebeurtenis staat op haar dag in de agenda (zie AGENDA_NOTE)
  end_at: true, // een activiteit zonder einde loopt nog (Loopt nu)
  amount: true, // Geld
  paid_by: true, // Wie moet wie
  split: true, // Wie moet wie
  to_person: true, // Wie moet wie (een overdracht)
  data: false, // de velden van haar soort (zie KIND_LINKS)
  repeat: true, // Herhalen
  done_by: false,
  photo_version: false,
  created_by: false,
  created_at: false,
  updated_at: false,
} as const satisfies Record<keyof Event, boolean>;

/** Lijnen van een gebeurtenis. */
export const LINE_LINKS = {
  id: false,
  position: false,
  role: true, // erbij, eraf, voor of bij
  thing_id: true, // een ding van (soms) een andere lijst
  text: false, // een lijn zonder ding raakt geen lijst
  amount: false,
  unit: false,
  price: false,
  expires: false,
  owner: true, // enkel van die persoon: Wie moet wie
} as const satisfies Record<keyof Line, boolean>;

/** Blokken op een overzicht. */
export const BLOCK_LINKS = {
  list: true,
  money: false, // een weergave, geen lijst
  balance: false,
  todo: false,
  stock: false,
  food: false,
  timers: false,
  quick: true,
  thing: true,
  chart: true,
} as const satisfies Record<BlockKind, boolean>;

// ---------- de weergaven ----------

/** Wat geen lijst is maar wel iets met je lijsten doet: de weergaven, meldingen en bronnen buiten de app. */
export const VIEWS = {
  geld: { label: "Geld", to: "/geld" },
  balans: { label: "Wie moet wie", to: "/geld" },
  voorraad: { label: "Voorraad", to: "/voorraad" },
  eten: { label: "Eten", to: "/eten" },
  tedoen: { label: "Te doen", to: "/te-doen" },
  agenda: { label: "Agenda", to: "/agenda" },
  timers: { label: "Loopt nu", to: "/" },
  herinneringen: { label: "Herinneringen", to: null },
  meldingen: { label: "Meldingen", to: null },
  herhalen: { label: "Herhalen", to: null },
  productinfo: { label: "Productinfo", to: null },
  kasticket: { label: "Kasticket lezen", to: null },
  overzicht: { label: "Overzicht", to: "/" },
} as const satisfies Record<string, { label: string; to: string | null }>;
export type ViewKey = keyof typeof VIEWS;
export const VIEW_ORDER = Object.keys(VIEWS) as ViewKey[];

/** Een punt op de kaart: een lijst (haar id) of een weergave. */
export const viewNode = (v: ViewKey) => `view:${v}`;
export const viewOf = (node: string): ViewKey | null => (node.startsWith("view:") && Object.hasOwn(VIEWS, node.slice(5)) ? (node.slice(5) as ViewKey) : null);

/** Dat zie je niet als lijn: elke gebeurtenis staat op haar dag in de agenda. */
export const AGENDA_NOTE = "Elke gebeurtenis staat ook op haar dag in de agenda.";

// ---------- verbanden ----------

/** Verwijzingen (velden die naar een andere lijst wijzen), Logboek (wat er gelogd is) en Weergaven. */
export const LINK_KINDS = {
  ref: { label: "Verwijzingen" },
  log: { label: "Logboek" },
  view: { label: "Weergaven" },
} as const;
export type LinkKind = keyof typeof LINK_KINDS;
export const LINK_ORDER = Object.keys(LINK_KINDS) as LinkKind[];

/**
 * Een verband: `from` doet iets met `to` (wijst ernaar, logt met zijn dingen of soorten, komt erin voor). `texts`: wat,
 * één zin per veld, soort of rol. `count`: hoeveel gebeurtenissen (enkel bij wat gelogd is), `last`: de laatste.
 */
export type Link = { kind: LinkKind; from: string; to: string; texts: string[]; count: number | null; last: string | null };

/** Een lijst zoals de kaart ze nodig heeft (enkel lijsten die de lezer ziet, niet gearchiveerd). */
export type LinkList = Pick<List, "id" | "name" | "fields" | "stock" | "notify"> & { role: Role };
/** Een eigen soort (van een lijst die de lezer ziet, of die een gebeurtenis gebruikt die hij ziet). */
export type LinkKindDef = Pick<Kind, "id" | "list_id" | "base" | "name" | "fields" | "goal">;
/** Wat er gelogd is, per lijst en soort: tellingen, enkel van gebeurtenissen in lijsten die de lezer ziet. */
export type LogStat = {
  list: string;
  kind: string;
  base: Base;
  events: number;
  /** Gebeurd met een bedrag, geen overdracht (Geld). */
  money: number;
  /** Gebeurd, betaald door iemand, en gedeeld (een verdeling, een overdracht of een lijn van één persoon). */
  shared: number;
  planned: number;
  repeats: number;
  /** Een activiteit zonder einde die loopt. */
  running: number;
  /** Gebeurd gebruik dat als eten telt (zie shared/food.ts). */
  food: number;
  last: string | null;
};
/** Lijnen van gebeurtenissen in `list` naar dingen in `to` (beide gezien), per soort en rol: in hoeveel gebeurtenissen. */
export type LineStat = { list: string; kind: string; base: Base; role: LineRole; to: string; events: number; last: string | null };
/** Hoeveel gebeurtenissen in `list` lijnen hebben naar dingen in `to`, in totaal (een gebeurtenis telt één keer). */
export type LinePair = { list: string; to: string; events: number; last: string | null };
/** Een blok op een van je overzichten dat een lijst toont. */
export type BoardUse = { board: string; list: string; block: BlockKind };

export type LinkInput = { lists: LinkList[]; kinds: LinkKindDef[]; log: LogStat[]; lines: LineStat[]; pairs: LinePair[]; boards: BoardUse[] };

/** Verbanden en wat een lijst met haar eigen dingen doet (dat is geen lijn op de kaart). */
export type LinkResult = { links: Link[]; own: Record<string, string[]> };

const BLOCK_TEXT: Partial<Record<BlockKind, string>> = { list: "een blok", quick: "Snel loggen", thing: "één ding", chart: "een grafiek" };
const PRODUCT_SOURCE = "uit Open Food Facts of NEVO";

const times = (n: number) => `${n}×`;
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/** Hoe de lezer een soort noemt: haar eigen naam, of die van de basissoort. */
function kindName(kinds: Map<string, LinkKindDef>, kind: string, base: Base): string {
  return kinds.get(kind)?.name ?? BASES[base]?.label ?? kind;
}

/** De verbanden die volgen uit wat de lezer ziet. */
export function buildLinks(input: LinkInput): LinkResult {
  const lists = new Map(input.lists.map((l) => [l.id, l]));
  const kinds = new Map(input.kinds.map((k) => [k.id, k]));
  const byKey = new Map<string, Link>();
  const own: Record<string, string[]> = {};

  const add = (kind: LinkKind, from: string, to: string, text: string, count: number | null = null, last: string | null = null) => {
    if (from === to) return;
    const key = `${kind} ${from} ${to}`;
    const had = byKey.get(key);
    if (!had) {
      byKey.set(key, { kind, from, to, texts: [text], count, last });
      return;
    }
    if (!had.texts.includes(text)) had.texts.push(text);
    if (count !== null) had.count = (had.count ?? 0) + count;
    had.last = later(had.last, last);
  };
  const ownNote = (list: string, text: string) => {
    const notes = (own[list] ??= []);
    if (!notes.includes(text)) notes.push(text);
  };

  /** Wat de velden van een lijst (of van een soort, met haar naam ervoor) verbinden. */
  const fieldLinks = (from: string, fields: FieldDef[], prefix: string) => {
    const products: string[] = [];
    for (const f of fields) {
      const label = `${prefix}${f.label}`;
      for (const to of f.type === "item" || f.type === "items" ? refLists(f) : []) {
        if (to === from) ownNote(from, `${label} verwijst naar een ander ding van deze lijst`);
        else if (lists.has(to)) add("ref", from, to, f.copy ? `${label} verwijst ernaar en neemt over` : `${label} verwijst ernaar`);
      }
      if (f.agenda && canAgenda(f)) add("view", from, viewNode("agenda"), `${label} staat in de agenda`);
      if (f.remind !== undefined && canAgenda(f)) add("view", from, viewNode("herinneringen"), `${label}: ${f.remind === 0 ? "op de dag" : `${f.remind} ${f.remind === 1 ? "dag" : "dagen"} vooraf`}${f.yearly ? ", elk jaar" : ""}`);
      if (f.product) {
        products.push(f.label);
        if (f.product === "kcal" && f.type === "number") add("view", from, viewNode("eten"), `${label} rekent mee in wat je eet`);
      }
      if (f.aliases) add("view", viewNode("kasticket"), from, `${label}: de naam op een kasticket wordt onthouden`);
    }
    if (products.length) add("view", viewNode("productinfo"), from, `${prefix}${products.join(", ")} ${PRODUCT_SOURCE}`);
  };

  for (const list of input.lists) {
    fieldLinks(list.id, list.fields, "");
    if (list.stock) add("view", list.id, viewNode("voorraad"), list.stock.min ? "Telt voorraad, met bijna op" : "Telt voorraad");
    if (list.notify) add("view", list.id, viewNode("meldingen"), list.notify.to === "all" ? "Iets nieuws: een melding aan iedereen bij de lijst" : "Iets nieuws: een melding aan wie erin staat");
  }
  for (const k of input.kinds) {
    if (!lists.has(k.list_id)) continue;
    fieldLinks(k.list_id, k.fields, `${k.name}: `);
    if (k.goal) add("view", k.list_id, viewNode("meldingen"), `${k.name}: een melding na ${k.goal % 60 ? `${k.goal} min` : `${k.goal / 60} u`}`);
  }

  // Wat er gelogd is.
  for (const s of input.log) {
    if (!lists.has(s.list)) continue;
    const name = kindName(kinds, s.kind, s.base);
    const owner = kinds.get(s.kind)?.list_id;
    if (owner && owner !== s.list && lists.has(owner)) add("log", s.list, owner, `Logt met de soort ${name}, ${times(s.events)}`, s.events, s.last);
    if (s.money) add("view", s.list, viewNode("geld"), `${name}: ${times(s.money)} met een bedrag`, s.money, s.last);
    if (s.shared) add("view", s.list, viewNode("balans"), `${name}: ${times(s.shared)} gedeeld`, s.shared, s.last);
    if (s.food) add("view", s.list, viewNode("eten"), `${name}: ${times(s.food)} gegeten`, s.food, s.last);
    if (s.planned) {
      add("view", s.list, viewNode("tedoen"), `${name}: ${s.planned} gepland`, s.planned, null);
      add("view", s.list, viewNode("agenda"), `${name}: ${s.planned} gepland`, s.planned, null);
      add("view", s.list, viewNode("herinneringen"), `${name}: om 7 u op de dag zelf`);
    }
    if (s.repeats) add("view", s.list, viewNode("herhalen"), `${name}: ${s.repeats} ${s.repeats === 1 ? "herhaalt" : "herhalen"}`, s.repeats, null);
    if (s.running) add("view", s.list, viewNode("timers"), `${name}: ${s.running} ${s.running === 1 ? "loopt" : "lopen"} nu`, s.running, null);
  }
  for (const s of input.lines) {
    if (!lists.has(s.list) || !lists.has(s.to)) continue;
    const to = lists.get(s.to)!;
    const role = LINE_ROLES[s.role].verb;
    const stock = to.stock && (s.role === "in" || s.role === "uit") ? (s.role === "in" ? " (telt bij de voorraad)" : " (gaat af van de voorraad)") : "";
    const text = `${kindName(kinds, s.kind, s.base)}: ${role}${stock}, ${times(s.events)}`;
    if (s.list === s.to) ownNote(s.list, text);
    else add("log", s.list, s.to, text);
  }
  for (const p of input.pairs) {
    if (p.list === p.to || !lists.has(p.list) || !lists.has(p.to)) continue;
    const link = byKey.get(`log ${p.list} ${p.to}`);
    if (link) {
      // Het aantal gebeurtenissen met lijnen (en die met de soort van daar, als dat er meer zijn).
      link.count = Math.max(link.count ?? 0, p.events);
      link.last = later(link.last, p.last);
    }
  }

  for (const b of input.boards) {
    if (!BLOCK_LINKS[b.block] || !lists.has(b.list)) continue;
    add("view", b.list, viewNode("overzicht"), `Op ${b.board}: ${BLOCK_TEXT[b.block] ?? "een blok"}`);
  }

  const links = [...byKey.values()].sort((a, b) => LINK_ORDER.indexOf(a.kind) - LINK_ORDER.indexOf(b.kind));
  return { links, own };
}

/** De lijsten waar een lijst van afhangt om te werken: waar ze naar verwijst en met wiens dingen ze logt. */
export function dependsOn(links: Link[], list: string): string[] {
  return [...new Set(links.filter((l) => l.from === list && (l.kind === "ref" || l.kind === "log") && !viewOf(l.to)).map((l) => l.to))];
}

/** Iemand bij een lijst, zoals de kaart hem nodig heeft. */
export type LinkPerson = { id: string; name: string; role: Role };

/**
 * Een verband dat voor iemand niet werkt: hij kan in `list` loggen of dingen maken, maar ziet `to` niet (dus geen ding
 * daarvan kiezen, en het verband niet zien).
 */
export type LinkProblem = { list: string; to: string; person: string; name: string };

/**
 * De problemen: wie in een lijst kan bewerken, maar een lijst niet ziet waar die lijst van afhangt. Enkel als de lezer
 * een van beide beheert (`managed`): dan kan hij er iets aan doen. `people`: per lijst wie erbij is (zonder wie er
 * rechtstreeks niet bij mag).
 */
export function linkProblems(links: Link[], people: Map<string, LinkPerson[]>, managed: Set<string>): LinkProblem[] {
  const out: LinkProblem[] = [];
  for (const [list, members] of people) {
    const editors = members.filter((p) => p.role === "beheerder" || p.role === "lid");
    for (const to of dependsOn(links, list)) {
      if (!managed.has(list) && !managed.has(to)) continue;
      const there = new Set((people.get(to) ?? []).map((p) => p.id));
      for (const p of editors) if (!there.has(p.id)) out.push({ list, to, person: p.id, name: p.name });
    }
  }
  return out;
}

// ---------- de kaart ----------
// Op de kaart staan de verbanden tussen lijsten (verwijzingen en het logboek); de weergaven staan als kleine iconen bij
// elke lijst (`viewsOf`), anders kreeg elke weergave een eigen rij en elke lijst een eigen spoor.

/** De verbanden tussen twee lijsten (geen weergave). */
export const betweenLists = (links: Link[]) => links.filter((l) => !viewOf(l.from) && !viewOf(l.to));

/** De weergaven waar een lijst in voorkomt of die haar iets geven, in de vaste volgorde. */
export function viewsOf(links: Link[], list: string): ViewKey[] {
  const out = new Set<ViewKey>();
  for (const l of links) {
    const v = l.from === list ? viewOf(l.to) : l.to === list ? viewOf(l.from) : null;
    if (v) out.add(v);
  }
  return VIEW_ORDER.filter((v) => out.has(v));
}

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
 * Schikt de kaart (een metrokaart). De regel:
 * - Elke lijst waar een verband in toekomt, krijgt een eigen rij (wie het meest binnenkrijgt bovenaan). Een lijst die
 *   enkel iets doorgeeft, staat op de rij van de eerste lijst waar ze in toekomt.
 * - Een lijn loopt eerst verticaal bij de lijst waar ze vertrekt (naar de rij van haar doel), dan horizontaal naar het
 *   doel. Op een rij staan dus enkel lijsten die naar die rij gaan: een lijn die erdoor loopt, hoort er echt bij.
 * - In een kolom krijgen twee punten elk een eigen plaats naast elkaar als hun verticale lijnen elkaar zouden raken.
 * Zuiver en voorspelbaar: dezelfde lijsten geven altijd dezelfde kaart.
 */
export function layoutLinks(columns: string[], nodes: LayoutNode[], links: Pick<Link, "kind" | "from" | "to">[]): Layout {
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const known = links.filter((l) => order.has(l.from) && order.has(l.to) && l.from !== l.to);
  const incoming = new Map<string, number>();
  for (const l of known) incoming.set(l.to, (incoming.get(l.to) ?? 0) + 1);

  const hubs = [...incoming.keys()].sort((a, b) => incoming.get(b)! - incoming.get(a)! || order.get(a)! - order.get(b)!);
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

  const rows = hubs.map((hub) => ({ hub, kinds: LINK_ORDER.filter((k) => known.some((l) => l.to === hub && l.kind === k)) }));
  return { rows, places, slots };
}

/** Iemand bij een lijst op de kaart: met zijn rol, en via welke tag als het geen rechtstreekse rol is. */
export type LinkPersonView = LinkPerson & { via: string | null };

/** Wat GET /insights/links geeft. */
export type LinksResponse = {
  links: Link[];
  /** Wat een lijst met haar eigen dingen doet (geen lijn op de kaart). */
  own: Record<string, string[]>;
  counts: Record<string, { things: number; events: number }>;
  people: Record<string, LinkPersonView[]>;
  problems: LinkProblem[];
};
