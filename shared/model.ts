// Het model van Heystack: lijsten met items, formulieren die ze invullen, en per formulier een logboek met gebeurtenissen.
//
// - Een **lijst** heeft items (allemaal met dezelfde velden), mensen met een rol en tags.
// - Een **formulier** staat los van lijsten: velden, onderdelen, groepen lijnen en handelingen (wat het met de items
//   van lijsten doet, shared/cells.ts), met eigen mensen en tags. Het **logboek** hoort bij het formulier: elke
//   gebeurtenis is van haar formulier. Het logboek van een lijst is wat haar items raakt.
// - Een **gebeurtenis** gebeurt op een moment. Ze heeft **lijnen** naar de items die ze raakt, per groep van haar
//   formulier: wat erbij komt (in), wat eraf gaat (uit), waarover ze gaat (voor) en waar of bij wie (bij).
// - Wat je ziet, hangt af van je rol per lijst en per formulier (zie shared/rights.ts). Voorraad, saldo's en eten worden
//   nooit bewaard maar uitgerekend (shared/cells.ts, shared/stock.ts, shared/ledger.ts, shared/food.ts).

import { ADJUST, ADJUST_DOES, presetDoes, type Handeling } from "./cells.ts";
import { FIELD_TYPES, type Attributes, type FieldDef, type Interval, type Share } from "./fields.ts";
import type { LedgerDef } from "./ledger.ts";
import type { IconKey } from "./icons.ts";
import type { NotifyDef } from "./alerts.ts";
import type { ReadPhoto } from "./photoread.ts";
import type { StockDef } from "./stock.ts";
import type { Person, Tone } from "./types.ts";

// ---------- rollen ----------

export const ROLES = {
  beheerder: { label: "Beheerder" },
  lid: { label: "Lid" },
  gast: { label: "Gast" },
} as const;
export type Role = keyof typeof ROLES;
/** Rechtstreeks bij een lijst: een rol, of `geen` (een uitzondering op een regel van een tag). */
export type DirectRole = Role | "geen";

export const isRole = (v: unknown): v is Role => typeof v === "string" && Object.hasOwn(ROLES, v);
export const isDirectRole = (v: unknown): v is DirectRole => v === "geen" || isRole(v);

export const ROLE_RANK: Record<Role, number> = { gast: 1, lid: 2, beheerder: 3 };
/** Items en gebeurtenissen toevoegen, wijzigen en verwijderen. */
export const canEdit = (r: Role | null | undefined): boolean => r === "lid" || r === "beheerder";
/** De lijst instellen: naam, velden, soorten, mensen, tags. */
export const canManage = (r: Role | null | undefined): boolean => r === "beheerder";

// ---------- formulieren ----------

/** De rol van een lijn: wat erbij komt, wat eraf gaat, waarover het gaat en waar of bij wie (enkel met de hele gebeurtenis te zien). */
export type LineRole = "in" | "uit" | "voor" | "bij";
/** Hoe een groep lijnen heet als het formulier niets zegt; `done`: achteraf. */
export const LINE_ROLES: Record<LineRole, { label: string; done: string }> = {
  in: { label: "Toevoegen", done: "Toegevoegd" },
  uit: { label: "Weghalen", done: "Weggehaald" },
  voor: { label: "Voor", done: "Voor" },
  bij: { label: "Bij", done: "Bij" },
};
export const isLineRole = (v: unknown): v is LineRole => typeof v === "string" && Object.hasOwn(LINE_ROLES, v);

/**
 * Een groep lijnen van een formulier (Wat, Waar, Ruimte): haar sleutel (`key`: een lijn onthoudt haar groep, een
 * handeling wijst ernaar; van vroeger de rol), de rol van haar lijnen (wie ze ziet, of ze een lijst raakt), haar naam
 * en uit welke lijsten ze kiest (leeg: uit elke lijst). Zoveel groepen als je wil, ook met dezelfde rol.
 * `fresh`: elke keer een nieuwe rij in een van haar lijsten in plaats van een bestaand item kiezen; met één lijst kan
 * haar naam uit het tekstveld `name` komen. `one`: hoogstens één item (een Ruimte, een wagen) in plaats van meerdere.
 */
export type LineGroup = { key: string; role: LineRole; label: string; lists: string[]; fresh?: true; name?: string; one?: true };
/** Hoeveel groepen een formulier hoogstens heeft (een vangnet, geen ontwerpgrens). */
export const MAX_GROUPS = 20;
export const GROUP_KEY = /^[a-z][a-z0-9_]{0,39}$/;
/** Een groep van een vertrekpunt: met haar rol als sleutel. */
const baseGroup = (role: LineRole, label: string): LineGroup => ({ key: role, role, label, lists: [] });

/**
 * Wat een formulier vraagt naast zijn velden: geld (bedrag, wie betaalde, de verdeling en een prijs per lijn), naar
 * iemand (een overdracht), een einde (een activiteit met een duur, of een timer) en zijn groepen lijnen.
 */
export type Parts = { money: boolean; to: boolean; duration: boolean; groups: LineGroup[] };
export const NO_PARTS: Parts = { money: false, to: false, duration: false, groups: [] };

/**
 * De vertrekpunten van een formulier: wat een nieuw formulier al vraagt (`parts`) en doet (`presetDoes` in
 * shared/cells.ts). Ze bepalen niets meer achteraf: wat een formulier doet, staat in zijn onderdelen en handelingen.
 * Een lijst zonder eigen formulieren logt met deze zes.
 */
export const BASES = {
  aankoop: {
    label: "Aankoop",
    plural: "Aankopen",
    icon: "cart",
    hint: "Er komt iets bij, tegen geld",
    parts: { money: true, to: false, duration: false, groups: [baseGroup("in", "Wat"), baseGroup("bij", "Waar")] },
  },
  gebruik: { label: "Gebruik", plural: "Gebruik", icon: "package", hint: "Er gaat iets uit de voorraad", parts: { ...NO_PARTS, groups: [baseGroup("uit", "Wat")] } },
  dienst: {
    label: "Dienst",
    plural: "Diensten",
    icon: "wrench",
    hint: "Iemand doet iets voor jou of een item",
    parts: { money: true, to: false, duration: false, groups: [baseGroup("voor", "Voor"), baseGroup("bij", "Bij")] },
  },
  activiteit: { label: "Activiteit", plural: "Activiteiten", icon: "clock", hint: "Wat je doet, met een duur", parts: { ...NO_PARTS, duration: true, groups: [baseGroup("voor", "Voor")] } },
  meting: { label: "Meting", plural: "Metingen", icon: "weight", hint: "Eén getal: gewicht, km-stand, telling", parts: { ...NO_PARTS, groups: [baseGroup("voor", "Voor")] } },
  overdracht: { label: "Overdracht", plural: "Overdrachten", icon: "transfer", hint: "Geld naar iemand anders", parts: { money: true, to: true, duration: false, groups: [] } },
} as const satisfies Record<string, { label: string; plural: string; icon: IconKey; hint: string; parts: Parts }>;
export type Base = keyof typeof BASES;
export const isBase = (v: unknown): v is Base => typeof v === "string" && Object.hasOwn(BASES, v);

/** Een nieuwe rij en haar naam rechtgezet: een nieuwe rij heeft minstens één lijst, een naam uit een veld enkel met één. */
function fitGroup({ fresh, name, one, ...g }: LineGroup, text: (key: string | undefined) => boolean): LineGroup {
  const isFresh = fresh === true && g.lists.length > 0;
  const named = isFresh && g.lists.length === 1 && text(name);
  return { ...g, ...(isFresh ? { fresh: true as const } : {}), ...(named ? { name } : {}), ...(named || one ? { one: true as const } : {}) };
}

/**
 * Groepen recht zetten na het filteren van hun lijsten: een nieuwe rij heeft minstens één lijst, en haar naam komt
 * enkel uit een tekstveld van het formulier (en enkel met één lijst).
 */
export function fitGroups(parts: Parts, fields: Pick<FieldDef, "key" | "type">[]): Parts {
  const text = (key: string | undefined) => fields.some((f) => f.key === key && FIELD_TYPES[f.type].group === "text");
  return { ...parts, groups: parts.groups.map((g) => fitGroup(g, text)) };
}

/**
 * Onderdelen van buiten nakijken: hoogstens `MAX_GROUPS` groepen, elk met een eigen sleutel (van vroeger: de rol, of
 * de rol met een volgnummer als die al genomen is), een naam van 30 tekens; null als het niet klopt.
 */
export function cleanParts(raw: unknown): Parts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const groups: LineGroup[] = [];
  for (const g of Array.isArray(o.groups) ? o.groups : []) {
    const x = (g ?? {}) as Record<string, unknown>;
    if (!isLineRole(x.role) || groups.length >= MAX_GROUPS) continue;
    const role = x.role;
    const wanted = typeof x.key === "string" && GROUP_KEY.test(x.key) ? x.key : role;
    let key = wanted;
    for (let n = 2; groups.some((h) => h.key === key); n++) key = `${wanted}_${n}`;
    const label = typeof x.label === "string" && x.label.trim() ? x.label.trim().slice(0, 30) : LINE_ROLES[role].label;
    // Uit welke lijsten; van vroeger één lijst (`list`).
    const raw = Array.isArray(x.lists) ? x.lists : typeof x.list === "string" ? [x.list] : [];
    const lists = [...new Set(raw.filter((l): l is string => typeof l === "string" && /^[A-Za-z0-9-]{1,64}$/.test(l)))].slice(0, 20);
    const name = typeof x.name === "string" && GROUP_KEY.test(x.name) ? x.name : undefined;
    const group: LineGroup = { key, role, label, lists, ...(x.fresh === true ? { fresh: true as const } : {}), ...(name ? { name } : {}), ...(x.one === true ? { one: true as const } : {}) };
    // De naam uit een veld kijkt fitGroups na (met de velden van het formulier); hier enkel of hij er kan staan.
    groups.push(fitGroup(group, () => true));
  }
  const money = o.money === true;
  return { money, to: money && o.to === true, duration: o.duration === true, groups };
}

/** De onderdelen van een vertrekpunt (een kopie, om aan te passen). */
export const baseParts = (base: Base): Parts => {
  const p = BASES[base].parts;
  return { money: p.money, to: p.to, duration: p.duration, groups: p.groups.map((g) => ({ ...g })) };
};

/**
 * Een eigen formulier (Gegeten, Tankbeurt, Schilderwerk): een naam, eigen velden, onderdelen (`parts`; null = die van
 * het vertrekpunt `base`) en wat het doet (`does`: de handelingen, shared/cells.ts; zonder eigen onderdelen komen die
 * van het vertrekpunt erbij). `goal`: een activiteit die loopt (een timer) geeft na zoveel minuten een melding (16 u
 * vasten). `planned`: een nieuwe gebeurtenis ermee begint gepland (een boodschap, een taak), tot je ze afvinkt.
 */
export type Kind = {
  id: string;
  base: Base;
  name: string;
  icon: IconKey | null;
  fields: FieldDef[];
  goal: number | null;
  planned: boolean;
  parts: Parts | null;
  does: Handeling[];
  /** Een melding bij iets nieuws (shared/alerts.ts). */
  notify: NotifyDef | null;
  /** Een foto lezen met AI: aan, uit, of null = de standaard (shared/photoread.ts). */
  reads: boolean | null;
  archived: 0 | 1;
  created_by: string;
  created_at: string;
};

/**
 * Een formulier zoals een gebeurtenis het gebruikt: een vertrekpunt (id = het vertrekpunt) of een eigen formulier, met
 * zijn onderdelen en alles wat het doet.
 */
export type KindInfo = {
  id: string;
  base: Base;
  name: string;
  icon: IconKey;
  fields: FieldDef[];
  goal: number | null;
  planned: boolean;
  parts: Parts;
  does: Handeling[];
  reads: boolean | null;
  /** Een systeemformulier (Aanpassing): zonder eigen mensen, je ziet het met de lijst van zijn item. */
  system?: true;
};

/** Het vertrekpunt zelf als formulier (zonder eigen velden, behalve een meting: een waarde). */
export function baseKind(base: Base): KindInfo {
  const b = BASES[base];
  const fields: FieldDef[] = base === "meting" ? [{ key: "waarde", label: "Waarde", type: "number" }] : [];
  return { id: base, base, name: b.label, icon: b.icon, fields, goal: null, planned: false, parts: baseParts(base), does: presetDoes(base), reads: null };
}

/** Een cel rechtstreeks aanpassen (in het item): een gebeurtenis die de nieuwe waarde zet (shared/cells.ts). */
export const ADJUST_KIND: KindInfo = {
  id: ADJUST,
  base: "meting",
  name: "Aanpassing",
  icon: "note",
  fields: [],
  goal: null,
  planned: false,
  parts: { ...NO_PARTS, groups: [baseGroup("voor", "Voor")] },
  does: ADJUST_DOES,
  reads: false,
  system: true,
};

export function kindInfo(kind: Kind): KindInfo {
  return {
    id: kind.id,
    base: kind.base,
    name: kind.name,
    icon: kind.icon ?? BASES[kind.base].icon,
    fields: kind.fields,
    goal: kind.goal,
    planned: kind.planned,
    parts: kind.parts ?? baseParts(kind.base),
    does: kind.parts ? kind.does : [...presetDoes(kind.base), ...kind.does],
    reads: kind.reads,
  };
}

/**
 * Twee formulieren samen (`from` gaat op in `into`, zie POST /forms/:id/merge): de velden van beide (bij dezelfde sleutel
 * die van `into`), de onderdelen samen (geld, naar iemand of een einde als een van beide het heeft; per rol één groep,
 * met de lijsten van beide, of uit elke lijst als een van beide dat deed) en de handelingen van beide (één keer). Volgen
 * beide hun vertrekpunt, dan blijft dat zo; anders worden de onderdelen uitdrukkelijk.
 */
export function mergeKinds(into: Kind, from: Kind): Pick<Kind, "fields" | "parts" | "does" | "goal" | "notify"> {
  const fields = [...into.fields, ...from.fields.filter((f) => !into.fields.some((g) => g.key === f.key))];
  const once = (does: Handeling[]) => [...new Map(does.map((h) => [JSON.stringify(h), h])).values()];
  const goal = into.goal ?? from.goal;
  const notify = into.notify ?? from.notify;
  if (!into.parts && !from.parts && into.base === from.base) return { fields, parts: null, does: once([...into.does, ...from.does]), goal, notify };
  const a = kindInfo(into);
  const b = kindInfo(from);
  // Groepen met dezelfde sleutel worden één (hun lijnen blijven zo bij hun groep); de andere komen erbij.
  const groups = [...a.parts.groups];
  for (const g of b.parts.groups) {
    const i = groups.findIndex((x) => x.key === g.key);
    if (i < 0) groups.push(g);
    else groups[i] = { ...groups[i], lists: groups[i].lists.length && g.lists.length ? [...new Set([...groups[i].lists, ...g.lists])] : [] };
  }
  const money = a.parts.money || b.parts.money;
  const parts: Parts = { money, to: money && (a.parts.to || b.parts.to), duration: a.parts.duration || b.parts.duration, groups };
  return { fields, parts, does: once([...a.does, ...b.does]), goal, notify };
}

/** De lijsten die een formulier uitdrukkelijk invult: een groep lijnen uit één lijst, of een handeling op een lijst. */
export function fillsLists(kind: Pick<KindInfo, "parts" | "does">): string[] {
  return [...new Set([...kind.parts.groups.flatMap((g) => g.lists), ...kind.does.flatMap((h) => (h.list ? [h.list] : []))])];
}

/** De eerste groep lijnen van een formulier (waar een item komt als je logt vanaf dat item). */
export const mainGroup = (kind: Pick<KindInfo, "parts">): LineGroup => kind.parts.groups[0] ?? baseGroup("voor", LINE_ROLES.voor.label);

/**
 * De lijnen van de nieuwe rijen die hun naam uit een veld halen (een Proeverij in Geproefd met de Wijn als naam): enkel
 * als het veld ingevuld is en de gebeurtenis nog geen lijn in die groep heeft (`taken`: de sleutels van de groepen).
 */
export function namedLines(kind: Pick<KindInfo, "parts">, taken: string[], data: Record<string, unknown>) {
  return kind.parts.groups.flatMap((g) => {
    const name = g.fresh && g.name && g.lists.length === 1 ? data[g.name] : null;
    if (typeof name !== "string" || !name.trim() || taken.includes(g.key)) return [];
    return [{ role: g.role, group: g.key, new_item: { list_id: g.lists[0], name: name.trim().slice(0, 120) }, amount: null, unit: null, price: null, expires: null, owner: null }];
  });
}

/**
 * De groep van een lijn in een formulier: die met haar sleutel, of (een groep die het formulier niet meer heeft) een
 * groep met de rol van de lijn als naam.
 */
export const groupOf = (kind: Pick<KindInfo, "parts">, line: { group?: string | null; role: LineRole }): LineGroup => {
  const key = line.group || line.role;
  return kind.parts.groups.find((g) => g.key === key) ?? { key, role: line.role, label: LINE_ROLES[line.role].label, lists: [] };
};
/** De sleutel van de groep van een lijn (van vroeger: haar rol). */
export const lineGroup = (line: { group?: string | null; role: LineRole }): string => line.group || line.role;

/** Of een nieuwe gebeurtenis gepland begint: als je erom vroeg (Plannen, een geplande actie) of als haar formulier dat doet. */
export const startsPlanned = (kind: Pick<KindInfo, "planned">, asked: boolean): boolean => asked || kind.planned;

/**
 * De formulieren om mee te loggen, zoals je ze kiest: die een lijst invullen (`fills`) eerst, de rest onder Ander
 * formulier. Een formulier dat al gekozen is (een gebeurtenis die je bewerkt, een actie, een kasticket), staat er
 * vooraan bij.
 */
export function formsOf(kinds: KindInfo[], fills: (k: KindInfo) => boolean, chosen?: string | null): { shown: KindInfo[]; more: KindInfo[] } {
  const own = kinds.filter(fills);
  const first = own.length ? own : kinds;
  const rest = own.length ? kinds.filter((k) => !own.includes(k)) : [];
  const extra = rest.find((k) => k.id === chosen);
  return { shown: extra ? [...first, extra] : first, more: rest.filter((k) => k !== extra) };
}

// ---------- formulieren zoals jij ze ziet ----------

/** Een formulier in je menu: met je rol en zijn tags. */
export type FormNode = { id: string; name: string; icon: IconKey; base: Base; role: Role; tags: string[]; archived: 0 | 1 };

/** Een formulier met wie erbij is, zijn tags en instellingen (zijn pagina en Instellen). */
export type FormDetail = {
  form: KindInfo;
  role: Role;
  tags: Tag[];
  people: ListPerson[];
  notify: NotifyDef | null;
  archived: 0 | 1;
  counts: { events: number; planned: number };
};

// ---------- lijsten ----------

export type List = {
  id: string;
  name: string;
  /** Hoe één item heet ("Wijn"); null = een lijst zonder items (enkel een logboek). */
  one: string | null;
  icon: IconKey | null;
  color: Tone | null;
  fields: FieldDef[];
  stock: StockDef | null;
  /** Een saldo per persoon (Wie moet wie): welke kolom de persoon is en welke het saldo (shared/ledger.ts). */
  ledger: LedgerDef | null;
  notify: NotifyDef | null;
  /** Welke formulieren een foto lezen met de AI (shared/photoread.ts); null = de standaard. */
  read_photo: ReadPhoto | null;
  archived: 0 | 1;
  created_at: string;
};

/** Een lijst zoals jij ze ziet: met je rol en haar tags. */
export type ListNode = Pick<List, "id" | "name" | "one" | "icon" | "color" | "archived"> & {
  role: Role;
  tags: string[];
  /** Telt voorraad. */
  stock: boolean;
  /** Jouw volgorde (lager = eerder). */
  position: number;
};

export type Tag = { id: string; name: string; color: Tone | null; created_by: string };
/** Een regel op een tag: deze persoon krijgt deze rol op elke lijst met de tag (waar wie de regel maakte, beheert). */
export type TagRule = { person_id: string; role: Role; created_by: string };

/** Iemand bij een lijst: rechtstreeks, of via een regel van een tag (`via`: de tag). */
export type ListPerson = { person: Person; role: Role; direct: DirectRole | null; via: { tag_id: string; tag: string } | null };

export type ListDetail = {
  list: List;
  role: Role;
  tags: Tag[];
  people: ListPerson[];
  /** De formulieren die je ziet (die deze lijst invullen eerst, zie `formsOf`). */
  kinds: KindInfo[];
  counts: { items: number; events: number; planned: number };
};

// ---------- items ----------

export type Item = {
  id: string;
  list_id: string;
  name: string;
  data: Attributes;
  part_of: string | null;
  photo_version: number | null;
  archived: 0 | 1;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Gekoppeld (zie shared/transfer.ts): de koppeling en het item in de bron. */
  mirror_id?: string | null;
  mirror_of?: string | null;
};

/** Een item in een lijst, met zijn voorraad als de lijst telt. */
export type ItemRow = Item & { stock?: StockLevel | null };

export type StockLevel = {
  amount: number;
  unit: string | null;
  /** Onder of op het minimum. */
  low: boolean;
  /** De vroegste houdbaarheidsdatum van wat er nog is (benadering). */
  expires: string | null;
};

/** Een item om naar te verwijzen of te kiezen (zoeken, een lijn). */
export type ItemRef = {
  id: string;
  name: string;
  list_id: string;
  list: string;
  unit?: string | null;
  /** Bij zoeken in een tekst: de rol die het meestal heeft in wat je ziet (Colruyt: bij), en of zijn lijst voorraad telt. */
  usual?: LineRole | null;
  stock?: boolean;
};

// ---------- gebeurtenissen ----------

export type Status = "gebeurd" | "gepland" | "afgevinkt";
export const STATUSES: Record<Status, { label: string }> = {
  gebeurd: { label: "Gebeurd" },
  gepland: { label: "Gepland" },
  afgevinkt: { label: "Afgevinkt" },
};
export const isStatus = (v: unknown): v is Status => typeof v === "string" && Object.hasOwn(STATUSES, v);

export type Repeat = { every: Interval; next_on: string };

export type Line = {
  id: string;
  position: number;
  role: LineRole;
  /** De groep van het formulier waarin de lijn staat (de `key` van een groep; van vroeger de rol). */
  group: string;
  item_id: string | null;
  text: string | null;
  amount: number | null;
  unit: string | null;
  price: number | null;
  expires: string | null;
  owner: string | null;
};

export type Event = {
  id: string;
  /** Het formulier (en zo het logboek) van de gebeurtenis. */
  kind: string;
  base: Base;
  name: string;
  status: Status;
  at: string;
  end_at: string | null;
  amount: number | null;
  paid_by: string | null;
  split: Share[] | null;
  to_person: string | null;
  data: Attributes;
  repeat: Repeat | null;
  done_by: string | null;
  photo_version: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

/**
 * Een gebeurtenis zoals jij ze ziet. `partial`: je ziet de lijst van de gebeurtenis niet, enkel de lijnen over items
 * die je wel ziet (zonder naam, bedrag, foto of andere lijnen).
 */
export type EventView = Omit<Event, "data"> & {
  data: Attributes;
  lines: Line[];
  /** De lijsten die haar lijnen raken (die je ziet), voor de kolom Lijst. */
  lists: string[];
  partial: boolean;
};

/** Een lijn zoals je ze invoert: een item, een nieuw item of tekst. */
export type LineInput = {
  role: LineRole;
  /** De groep van het formulier (zonder: de eerste groep met die rol). */
  group?: string | null;
  item_id?: string | null;
  text?: string | null;
  /** Een nieuw item in een lijst (een product dat nog niet bestaat). */
  new_item?: { list_id: string; name: string; data?: Attributes; alias?: string } | null;
  amount?: number | null;
  unit?: string | null;
  price?: number | null;
  expires?: string | null;
  owner?: string | null;
};

export type EventInput = {
  kind: string;
  name: string;
  status: Status;
  at: string;
  end_at?: string | null;
  amount?: number | null;
  paid_by?: string | null;
  split?: Share[] | null;
  to_person?: string | null;
  data?: Attributes;
  lines: LineInput[];
  repeat?: { every: Interval } | null;
};

// ---------- tijd ----------

const AT_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

/** Een moment: een dag ("2026-11-06") of een dag met uur ("2026-11-06T18:42"). */
export function isAt(value: unknown): value is string {
  if (typeof value !== "string" || !AT_RE.test(value)) return false;
  const day = value.slice(0, 10);
  if (Number.isNaN(Date.parse(day))) return false;
  if (value.length > 10) {
    const [h, m] = value.slice(11).split(":").map(Number);
    if (h > 23 || m > 59) return false;
  }
  return true;
}

export const dayOf = (at: string) => at.slice(0, 10);
export const timeOf = (at: string): string | null => (at.length > 10 ? at.slice(11, 16) : null);

/** Minuten tussen twee momenten met een uur (een activiteit); null zonder uur. */
export function minutesBetween(from: string, to: string): number | null {
  if (from.length <= 10 || to.length <= 10) return null;
  const a = Date.parse(`${from}:00Z`);
  const b = Date.parse(`${to}:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 60000);
}

/** Het moment nu in België, tot op de minuut ("2026-11-06T18:42"). */
export function brusselsNow(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** De naam van een gebeurtenis om te tonen: haar naam, anders de soort (met het eerste item). */
export function eventTitle(e: Pick<EventView, "name" | "lines">, kind: Pick<KindInfo, "name">, itemName: (id: string) => string | undefined): string {
  if (e.name.trim()) return e.name;
  const first = e.lines.find((l) => l.role !== "bij");
  const what = first ? (first.item_id ? itemName(first.item_id) : first.text) : null;
  return what ? `${kind.name}: ${what}` : kind.name;
}
