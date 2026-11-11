// Het model van Heystack: lijsten met dingen, en per lijst een logboek met gebeurtenissen.
//
// - Een **lijst** heeft dingen (allemaal met dezelfde velden; mag leeg zijn), mensen met een rol, tags en een logboek.
// - Een **gebeurtenis** gebeurt op een moment en heeft een soort: een van de zes basissoorten (`BASES`) of een eigen
//   soort erop (Gegeten is een Gebruik met kcal). Ze heeft **lijnen** naar de dingen die ze raakt: wat erbij komt
//   (in), wat eraf gaat (uit), waarover ze gaat (voor) en waar of bij wie (bij).
// - Wat je ziet, hangt af van je rol per lijst (zie shared/rights.ts). Voorraad, uitgaven, wie moet wie en eten
//   worden nooit bewaard maar uitgerekend uit de lijnen (shared/stock.ts, shared/ledger.ts, shared/food.ts).

import type { Attributes, FieldDef, Interval, Share } from "./fields.ts";
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
/** Dingen en gebeurtenissen toevoegen, wijzigen en verwijderen. */
export const canEdit = (r: Role | null | undefined): boolean => r === "lid" || r === "beheerder";
/** De lijst instellen: naam, velden, soorten, mensen, tags. */
export const canManage = (r: Role | null | undefined): boolean => r === "beheerder";

// ---------- soorten ----------

/** Welke rol een lijn standaard heeft, en wat een soort kan. */
export type LineRole = "in" | "uit" | "voor" | "bij";
/** `label`: wat je kiest in het formulier (Toevoegen: een fles erbij, of een nieuwe wijn); `done`: achteraf. */
export const LINE_ROLES: Record<LineRole, { label: string; done: string }> = {
  in: { label: "Toevoegen", done: "Toegevoegd" },
  uit: { label: "Weghalen", done: "Weggehaald" },
  voor: { label: "Voor", done: "Voor" },
  bij: { label: "Bij", done: "Bij" },
};
export const isLineRole = (v: unknown): v is LineRole => typeof v === "string" && Object.hasOwn(LINE_ROLES, v);

export const BASES = {
  aankoop: { label: "Aankoop", plural: "Aankopen", icon: "cart", money: true, line: "in", hint: "Er komt iets bij, tegen geld" },
  gebruik: { label: "Gebruik", plural: "Gebruik", icon: "package", money: false, line: "uit", hint: "Er gaat iets uit de voorraad" },
  dienst: { label: "Dienst", plural: "Diensten", icon: "wrench", money: true, line: "voor", hint: "Iemand doet iets voor jou of een ding" },
  activiteit: { label: "Activiteit", plural: "Activiteiten", icon: "clock", money: false, line: "voor", hint: "Wat je doet, met een duur" },
  meting: { label: "Meting", plural: "Metingen", icon: "weight", money: false, line: "voor", hint: "Eén getal: gewicht, km-stand, telling" },
  overdracht: { label: "Overdracht", plural: "Overdrachten", icon: "transfer", money: true, line: "voor", hint: "Geld of iets naar iemand anders" },
} as const satisfies Record<string, { label: string; plural: string; icon: IconKey; money: boolean; line: LineRole; hint: string }>;
export type Base = keyof typeof BASES;
export const isBase = (v: unknown): v is Base => typeof v === "string" && Object.hasOwn(BASES, v);

/** Een eigen soort: een basissoort met een naam en eigen velden (Gegeten, Carwash, Proeverij). */
/** `goal`: een activiteit die loopt (een timer), geeft na zoveel minuten een melding (16 u vasten). */
/** `planned`: een nieuwe gebeurtenis ermee begint gepland (een boodschap, een taak), tot je ze afvinkt. */
export type Kind = { id: string; list_id: string; base: Base; name: string; icon: IconKey | null; fields: FieldDef[]; goal: number | null; planned: boolean; sort_order: number };

/** Een soort zoals een gebeurtenis ze gebruikt: een basissoort (id = de basissoort) of een eigen soort. */
export type KindInfo = { id: string; base: Base; name: string; icon: IconKey; fields: FieldDef[]; list_id: string | null; goal: number | null; planned: boolean };

/** De basissoort zelf als soort (zonder eigen velden, behalve een meting: een waarde). */
export function baseKind(base: Base): KindInfo {
  const b = BASES[base];
  const fields: FieldDef[] = base === "meting" ? [{ key: "waarde", label: "Waarde", type: "number" }] : [];
  return { id: base, base, name: b.label, icon: b.icon, fields, list_id: null, goal: null, planned: false };
}

export function kindInfo(kind: Kind): KindInfo {
  return { id: kind.id, base: kind.base, name: kind.name, icon: kind.icon ?? BASES[kind.base].icon, fields: kind.fields, list_id: kind.list_id, goal: kind.goal, planned: kind.planned };
}

/** Of een nieuwe gebeurtenis gepland begint: als je erom vroeg (Plannen, een geplande actie) of als haar formulier dat doet. */
export const startsPlanned = (kind: Pick<KindInfo, "planned">, asked: boolean): boolean => asked || kind.planned;

/**
 * De formulieren (soorten) om in een lijst te loggen, zoals je ze kiest: haar eigen, of zonder eigen de zes
 * basissoorten (`shown`). De rest (de basissoorten naast eigen formulieren, de formulieren van andere lijsten) staat
 * onder Ander formulier (`more`). Een formulier dat al gekozen is (een gebeurtenis die je bewerkt, een actie, een
 * kasticket), staat er vooraan bij.
 */
export function formsOf(kinds: KindInfo[], listId: string, chosen?: string | null): { shown: KindInfo[]; more: KindInfo[] } {
  const own = kinds.filter((k) => k.list_id === listId);
  const bases = kinds.filter((k) => !k.list_id);
  const others = kinds.filter((k) => k.list_id && k.list_id !== listId);
  const first = own.length ? own : bases;
  const rest = own.length ? [...bases, ...others] : others;
  const extra = rest.find((k) => k.id === chosen);
  return { shown: extra ? [...first, extra] : first, more: rest.filter((k) => k !== extra) };
}

// ---------- lijsten ----------

export type List = {
  id: string;
  name: string;
  /** Hoe één ding heet ("Wijn"); null = een lijst zonder dingen (enkel een logboek). */
  one: string | null;
  icon: IconKey | null;
  color: Tone | null;
  fields: FieldDef[];
  stock: StockDef | null;
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
  /** De soorten die je hier kan loggen: de basissoorten, die van deze lijst en die van andere lijsten die je ziet. */
  kinds: KindInfo[];
  counts: { things: number; events: number; planned: number };
};

// ---------- dingen ----------

export type Thing = {
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
  /** Gekoppeld (zie shared/transfer.ts): de koppeling en het ding in de bron. */
  mirror_id?: string | null;
  mirror_of?: string | null;
};

/** Een ding in een lijst, met zijn voorraad als de lijst telt. */
export type ThingRow = Thing & { stock?: StockLevel | null };

export type StockLevel = {
  amount: number;
  unit: string | null;
  /** Onder of op het minimum. */
  low: boolean;
  /** De vroegste houdbaarheidsdatum van wat er nog is (benadering). */
  expires: string | null;
};

/** Een ding om naar te verwijzen of te kiezen (zoeken, een lijn). */
export type ThingRef = {
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
  thing_id: string | null;
  text: string | null;
  amount: number | null;
  unit: string | null;
  price: number | null;
  expires: string | null;
  owner: string | null;
};

export type Event = {
  id: string;
  list_id: string;
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
 * Een gebeurtenis zoals jij ze ziet. `partial`: je ziet de lijst van de gebeurtenis niet, enkel de lijnen over dingen
 * die je wel ziet (zonder naam, bedrag, foto of andere lijnen).
 */
export type EventView = Omit<Event, "data"> & { data: Attributes; lines: Line[]; partial: boolean };

/** Een lijn zoals je ze invoert: een ding, een nieuw ding of tekst. */
export type LineInput = {
  role: LineRole;
  thing_id?: string | null;
  text?: string | null;
  /** Een nieuw ding in een lijst (een product dat nog niet bestaat). */
  new_thing?: { list_id: string; name: string; data?: Attributes; alias?: string } | null;
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

/** De naam van een gebeurtenis om te tonen: haar naam, anders de soort (met het eerste ding). */
export function eventTitle(e: Pick<EventView, "name" | "lines">, kind: Pick<KindInfo, "name">, thingName: (id: string) => string | undefined): string {
  if (e.name.trim()) return e.name;
  const first = e.lines.find((l) => l.role !== "bij");
  const what = first ? (first.thing_id ? thingName(first.thing_id) : first.text) : null;
  return what ? `${kind.name}: ${what}` : kind.name;
}
