// De app instellen (Jouw gegevens → App): waar ze opent (per toestel), meerdere apps op één toestel (elk een eigen
// icoon op je beginscherm met een eigen naam, dat naar een eigen pagina gaat), de snelkoppelingen als je lang op het
// icoon drukt (Android), wat er met een gedeelde foto gebeurt, of de AI voor jou mag lezen, en wat je stilzette.
// Alles verwijst met ids; wat je niet (meer) kan bereiken, valt weg (`cleanAppSettings`, `keepReachable`).

/** De ingebouwde weergaven over al je lijsten. */
export const VIEWS = {
  geld: { label: "Geld", path: "/geld" },
  voorraad: { label: "Voorraad", path: "/voorraad" },
  eten: { label: "Eten", path: "/eten" },
  "te-doen": { label: "Te doen", path: "/te-doen" },
} as const;
export type ViewKey = keyof typeof VIEWS;
export const isViewKey = (v: unknown): v is ViewKey => typeof v === "string" && Object.hasOwn(VIEWS, v);

/** Waar iets naartoe gaat. */
export type Destination =
  | { kind: "board"; board: string }
  | { kind: "agenda" }
  | { kind: "view"; view: ViewKey }
  | { kind: "list"; list: string }
  /** Loggen in een lijst (eventueel met een soort en tekst), of met `thing` een ding toevoegen. */
  | { kind: "form"; list: string; type?: string; thing?: boolean; text?: string };

export type DestinationKind = Destination["kind"];

export const DESTINATION_KINDS = {
  board: "Overzicht",
  agenda: "Agenda",
  view: "Weergave",
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
};

export const MAX_APPS = 12;
export const MAX_SHORTCUTS = 4;
export const MAX_MUTED = 200;
export const DEFAULT_SETTINGS: AppSettings = { apps: [], shortcuts: null, share: { kind: "ask" }, ai: true, muted: [] };

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
    case "agenda":
      return { kind: "agenda" };
    case "view":
      return isViewKey(o.view) ? { kind: "view", view: o.view } : null;
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
  return { apps, shortcuts, share, ai: aiAllowed(o), muted };
}

export function destinationPath(d: Destination): string {
  switch (d.kind) {
    case "board":
      return `/?bord=${encodeURIComponent(d.board)}`;
    case "agenda":
      return "/agenda";
    case "view":
      return VIEWS[d.view].path;
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
  boards: { id: string; name: string }[];
  lists: Map<string, { name: string; one: string | null; edit: boolean; kinds: Map<string, string> }>;
};

export function reachable(d: Destination, reach: Reach): boolean {
  switch (d.kind) {
    case "board":
      return reach.boards.some((b) => b.id === d.board);
    case "agenda":
    case "view":
      return true;
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

/** Hoe een bestemming heet ("Overzicht Keuken", "Geld", "Voorraad", "Gegeten loggen", "Wijn toevoegen"). */
export function destinationLabel(d: Destination, reach: Reach): string {
  switch (d.kind) {
    case "board":
      return reach.boards.find((b) => b.id === d.board)?.name ?? "Overzicht";
    case "agenda":
      return "Agenda";
    case "view":
      return VIEWS[d.view].label;
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
  };
}

export const appPath = (appId: string) => `/app/${appId}`;

export function sameDestination(a: Destination, b: Destination): boolean {
  const key = (d: Destination) => JSON.stringify(cleanDestination(d));
  return key(a) === key(b);
}
