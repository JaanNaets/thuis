// De app instellen (Jouw gegevens → App): waar ze opent (per toestel), meerdere apps op één toestel (elk een eigen
// icoon op je beginscherm met een eigen naam, dat naar een eigen pagina gaat), de snelkoppelingen als je lang op het
// icoon drukt (Android), wat er met een gedeelde foto gebeurt, of de AI voor jou mag lezen, wat je stilzette, en welke
// lijsten je niet in je menu of bij de + wil (een hulplijst zoals Winkels).
// Alles verwijst met ids; wat je niet (meer) kan bereiken, valt weg (`cleanAppSettings`, `keepReachable`).

/** Waar iets naartoe gaat: een overzicht (je borden: Geld, Agenda, …), een lijst of een formulier. */
export type Destination =
  | { kind: "board"; board: string }
  | { kind: "list"; list: string }
  /** Loggen in een lijst (eventueel met een soort en tekst), of met `thing` een ding toevoegen. */
  | { kind: "form"; list: string; type?: string; thing?: boolean; text?: string };

export type DestinationKind = Destination["kind"];

export const DESTINATION_KINDS = {
  board: "Overzicht",
  list: "Lijst",
  form: "Formulier",
} as const satisfies Record<DestinationKind, string>;

export type AppDef = { id: string; name: string; to: Destination };
export type Shortcut = { name: string; to: Destination };

/** Een gedeelde foto: telkens vragen, of meteen als kasticket in een lijst. */
export type ShareChoice = { kind: "ask" } | { kind: "receipt"; list: string };

export type AppSettings = {
  apps: AppDef[];
  /** null = vanzelf: wat je het meest logt. */
  shortcuts: Shortcut[] | null;
  share: ShareChoice;
  /** Mag de AI voor jou lezen (✨)? Uit: geen ✨-knoppen, en de server weigert elke AI-vraag van jou. */
  ai: boolean;
  /** Lijsten of tags die je stilzette: geen melding bij iets nieuws daar. */
  muted: string[];
  /** Lijsten die je verborg: niet in je menu, of niet bij de + (Toevoegen). Zoeken en Verbanden tonen ze altijd. */
  hidden: Hidden;
};

/** Waar een lijst staat (per persoon): in het menu (zijbalk, menublad) en bij de + (Toevoegen). */
export const LIST_PLACES = { menu: "In het menu", add: "Bij de +" } as const;
export type ListPlace = keyof typeof LIST_PLACES;
export type Hidden = Record<ListPlace, string[]>;
export const NO_HIDDEN: Hidden = { menu: [], add: [] };

export const MAX_APPS = 12;
export const MAX_SHORTCUTS = 4;
export const MAX_MUTED = 200;
export const MAX_HIDDEN = 500;
export const DEFAULT_SETTINGS: AppSettings = { apps: [], shortcuts: null, share: { kind: "ask" }, ai: true, muted: [], hidden: NO_HIDDEN };

/** Staat deze lijst voor jou op die plek? */
export const shownIn = (hidden: Hidden | undefined, place: ListPlace, list: string) => !hidden?.[place].includes(list);

/**
 * Waarom een lijst voor jou stil staat (geen melding bij iets nieuws): `"list"` als je de lijst zelf stilzette, de id
 * van een tag als het via die tag is (dan laat enkel de tag ze weer melden), of null.
 */
export function mutedBy(muted: readonly string[], list: { id: string; tags: readonly string[] }): "list" | string | null {
  if (muted.includes(list.id)) return "list";
  return list.tags.find((t) => muted.includes(t)) ?? null;
}

/** Staat de AI aan in deze (bewaarde, nog niet nagekeken) instellingen? Enkel een uitdrukkelijk `false` zet ze uit. */
export const aiAllowed = (raw: unknown): boolean => !(raw && typeof raw === "object" && (raw as Record<string, unknown>).ai === false);

const ID = /^[A-Za-z0-9-]{1,64}$/;
const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

export function cleanDestination(raw: unknown): Destination | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  switch (o.kind) {
    case "board":
      return id(o.board) ? { kind: "board", board: o.board as string } : null;
    case "list":
      return id(o.list) ? { kind: "list", list: o.list as string } : null;
    case "form": {
      if (!id(o.list)) return null;
      const t = text(o.text, 120);
      return {
        kind: "form",
        list: o.list as string,
        ...(o.thing === true ? { thing: true } : id(o.type) ? { type: o.type as string } : {}),
        ...(t ? { text: t } : {}),
      };
    }
    default:
      return null;
  }
}

export function cleanAppSettings(raw: unknown, newId: () => string = () => crypto.randomUUID().slice(0, 8)): AppSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const apps: AppDef[] = [];
  for (const a of Array.isArray(o.apps) ? o.apps.slice(0, MAX_APPS * 2) : []) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const to = cleanDestination(r.to);
    const name = text(r.name, 30);
    if (!to || !name) continue;
    const appId = id(r.id) && !seen.has(r.id as string) ? (r.id as string) : newId();
    seen.add(appId);
    apps.push({ id: appId, name, to });
    if (apps.length === MAX_APPS) break;
  }
  const shortcuts = Array.isArray(o.shortcuts)
    ? o.shortcuts
        .map((s) => {
          const r = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
          const to = cleanDestination(r.to);
          const name = text(r.name, 30);
          return to && name ? { name, to } : null;
        })
        .filter((s): s is Shortcut => s !== null)
        .slice(0, MAX_SHORTCUTS)
    : null;
  const s = o.share && typeof o.share === "object" ? (o.share as Record<string, unknown>) : {};
  const share: ShareChoice = s.kind === "receipt" && id(s.list) ? { kind: "receipt", list: s.list as string } : { kind: "ask" };
  const muted = Array.isArray(o.muted) ? [...new Set(o.muted.map(id).filter((x): x is string => x !== null))].slice(0, MAX_MUTED) : [];
  return { apps, shortcuts, share, ai: aiAllowed(o), muted, hidden: cleanHidden(o.hidden) };
}

export function cleanHidden(raw: unknown): Hidden {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(id).filter((x): x is string => x !== null))].slice(0, MAX_HIDDEN) : []);
  return { menu: ids(o.menu), add: ids(o.add) };
}

export function destinationPath(d: Destination): string {
  switch (d.kind) {
    case "board":
      return boardPath(d.board);
    case "list":
      return `/lijsten/${d.list}`;
    case "form": {
      const q = new URLSearchParams();
      if (d.type) q.set("soort", d.type);
      if (d.text) q.set("tekst", d.text);
      const query = q.toString();
      return `/lijsten/${d.list}/${d.thing ? "nieuw" : "loggen"}${query ? `?${query}` : ""}`;
    }
  }
}

/** Wat je kan bereiken: je overzichten, en de lijsten die je ziet (en of je erin mag loggen), met hun soorten. */
export type Reach = {
  boards: { id: string; name: string; icon?: string }[];
  lists: Map<string, { name: string; one: string | null; edit: boolean; kinds: Map<string, string> }>;
};

export function reachable(d: Destination, reach: Reach): boolean {
  switch (d.kind) {
    case "board":
      return reach.boards.some((b) => b.id === d.board);
    case "list":
      return reach.lists.has(d.list);
    case "form": {
      const l = reach.lists.get(d.list);
      if (!l?.edit) return false;
      if (d.thing) return Boolean(l.one);
      return !d.type || l.kinds.has(d.type);
    }
  }
}

/** Hoe een bestemming heet ("Keuken", "Geld", "Wijnen", "Gegeten loggen", "Wijn toevoegen"). */
export function destinationLabel(d: Destination, reach: Reach): string {
  switch (d.kind) {
    case "board":
      return reach.boards.find((b) => b.id === d.board)?.name ?? "Overzicht";
    case "list":
      return reach.lists.get(d.list)?.name ?? "Lijst";
    case "form": {
      const l = reach.lists.get(d.list);
      if (d.thing) return `${l?.one ?? "Ding"} toevoegen`;
      return `${(d.type && l?.kinds.get(d.type)) || "Iets"} loggen`;
    }
  }
}

export function keepReachable(s: AppSettings, reach: Reach): AppSettings {
  const share = s.share.kind === "receipt" && !reachable({ kind: "form", list: s.share.list }, reach) ? ({ kind: "ask" } as const) : s.share;
  return {
    apps: s.apps.filter((a) => reachable(a.to, reach)),
    shortcuts: s.shortcuts && s.shortcuts.filter((x) => reachable(x.to, reach)),
    share,
    ai: s.ai,
    muted: s.muted,
    hidden: { menu: s.hidden.menu.filter((l) => reach.lists.has(l)), add: s.hidden.add.filter((l) => reach.lists.has(l)) },
  };
}

export const appPath = (appId: string) => `/app/${appId}`;
/** Een bord (overzicht) heeft een eigen adres; het eerste is ook het beginscherm (/). */
export const boardPath = (board: string) => `/bord/${encodeURIComponent(board)}`;

export function sameDestination(a: Destination, b: Destination): boolean {
  const key = (d: Destination) => JSON.stringify(cleanDestination(d));
  return key(a) === key(b);
}
