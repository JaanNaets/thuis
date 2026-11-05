// De app instellen (Jouw gegevens → App): waar ze opent (per toestel), meerdere apps op één toestel (elk een eigen
// icoon op je beginscherm met een eigen naam, dat naar een eigen pagina gaat), de snelkoppelingen als je lang op het
// icoon drukt (Android), wat er met een gedeelde foto gebeurt, en of de AI voor jou mag lezen (Jouw gegevens → AI). Alles verwijst met ids; wat je niet (meer) mag zien,
// valt weg bij het nakijken (`cleanAppSettings`, `keepReachable`) en bij het maken van een manifest.

/** Waar iets naartoe gaat. */
export type Destination =
  | { kind: "board"; board: string }
  | { kind: "agenda" }
  | { kind: "project"; project: string }
  | { kind: "list"; project: string; list: string }
  | { kind: "form"; project: string; list: string; text?: string };

export type DestinationKind = Destination["kind"];

/** De soorten bestemmingen, in de volgorde van de keuze. */
export const DESTINATION_KINDS = {
  board: "Overzicht",
  agenda: "Agenda",
  project: "Project",
  list: "Lijst",
  form: "Formulier",
} as const satisfies Record<DestinationKind, string>;

/** Een eigen app: een icoon op je beginscherm met deze naam, dat meteen naar `to` gaat (zie /app/:id). */
export type AppDef = { id: string; name: string; to: Destination };

/** Een snelkoppeling op het app-icoon (Android): een naam en waar ze heen gaat. */
export type Shortcut = { name: string; to: Destination };

/** Een gedeelde foto: telkens vragen, of meteen als kasticket bij een voorraad. */
export type ShareChoice = { kind: "ask" } | { kind: "receipt"; project: string; list: string };

export type AppSettings = {
  apps: AppDef[];
  /** null = vanzelf: je meestgebruikte lijsten. */
  shortcuts: Shortcut[] | null;
  share: ShareChoice;
  /** Mag de AI voor jou lezen (✨)? Uit: geen ✨-knoppen, en de server weigert elke AI-vraag van jou. */
  ai: boolean;
  /** Projecten die je stilzette: geen melding bij een nieuw item daar (ook niet in hun subprojecten). */
  muted: string[];
};

export const MAX_APPS = 12;
export const MAX_SHORTCUTS = 4;
export const DEFAULT_SETTINGS: AppSettings = { apps: [], shortcuts: null, share: { kind: "ask" }, ai: true, muted: [] };

/** Zoveel projecten kan je hoogstens stilzetten. */
export const MAX_MUTED = 200;

/** Staat de AI aan in deze (bewaarde, nog niet nagekeken) instellingen? Enkel een uitdrukkelijk `false` zet ze uit. */
export const aiAllowed = (raw: unknown): boolean => !(raw && typeof raw === "object" && (raw as Record<string, unknown>).ai === false);

const ID = /^[A-Za-z0-9-]{1,64}$/;
const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** Een bestemming nagekeken (enkel geldige ids), of null. */
export function cleanDestination(raw: unknown): Destination | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  switch (o.kind) {
    case "board":
      return id(o.board) ? { kind: "board", board: o.board as string } : null;
    case "agenda":
      return { kind: "agenda" };
    case "project":
      return id(o.project) ? { kind: "project", project: o.project as string } : null;
    case "list":
      return id(o.project) && id(o.list) ? { kind: "list", project: o.project as string, list: o.list as string } : null;
    case "form": {
      if (!id(o.project) || !id(o.list)) return null;
      const t = text(o.text, 120);
      return { kind: "form", project: o.project as string, list: o.list as string, ...(t ? { text: t } : {}) };
    }
    default:
      return null;
  }
}

/** Alles nagekeken: geldige bestemmingen, namen, hoogstens MAX_APPS apps en MAX_SHORTCUTS snelkoppelingen. */
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
  const share: ShareChoice = s.kind === "receipt" && id(s.project) && id(s.list) ? { kind: "receipt", project: s.project as string, list: s.list as string } : { kind: "ask" };
  const muted = Array.isArray(o.muted) ? [...new Set(o.muted.map(id).filter((x): x is string => x !== null))].slice(0, MAX_MUTED) : [];
  return { apps, shortcuts, share, ai: aiAllowed(o), muted };
}

/** Het pad van een bestemming in de app. */
export function destinationPath(d: Destination): string {
  switch (d.kind) {
    case "board":
      return `/?bord=${encodeURIComponent(d.board)}`;
    case "agenda":
      return "/agenda";
    case "project":
      return `/projecten/${d.project}`;
    case "list":
      return `/projecten/${d.project}?lijst=${d.list}`;
    case "form":
      return `/projecten/${d.project}/nieuw?lijst=${d.list}${d.text ? `&tekst=${encodeURIComponent(d.text)}` : ""}`;
  }
}

/** Wat je mag bereiken: je projecten, en per project de lijsten die je ziet (en waarin je iets mag toevoegen). */
export type Reach = {
  boards: { id: string; name: string }[];
  projects: Map<string, { name: string; lists: Map<string, { name: string; plural: string; create: boolean }> }>;
};

/** Kan je er (nog) heen? Een formulier enkel als je er iets mag toevoegen. */
export function reachable(d: Destination, reach: Reach): boolean {
  switch (d.kind) {
    case "board":
      return reach.boards.some((b) => b.id === d.board);
    case "agenda":
      return true;
    case "project":
      return reach.projects.has(d.project);
    case "list":
      return Boolean(reach.projects.get(d.project)?.lists.has(d.list));
    case "form":
      return Boolean(reach.projects.get(d.project)?.lists.get(d.list)?.create);
  }
}

/** Hoe een bestemming heet ("Overzicht Keuken", "Agenda", "Bijvullen", "Bijvulling toevoegen"). */
export function destinationLabel(d: Destination, reach: Reach): string {
  switch (d.kind) {
    case "board":
      return reach.boards.find((b) => b.id === d.board)?.name ?? "Overzicht";
    case "agenda":
      return "Agenda";
    case "project":
      return reach.projects.get(d.project)?.name ?? "Project";
    case "list":
      return reach.projects.get(d.project)?.lists.get(d.list)?.plural ?? "Lijst";
    case "form":
      return `${reach.projects.get(d.project)?.lists.get(d.list)?.name ?? "Item"} toevoegen`;
  }
}

/** Enkel wat je nog kan bereiken (rechten veranderen: een app of snelkoppeling naar iets dat weg is, valt weg). */
export function keepReachable(s: AppSettings, reach: Reach): AppSettings {
  const share = s.share.kind === "receipt" && !reachable({ kind: "form", project: s.share.project, list: s.share.list }, reach) ? ({ kind: "ask" } as const) : s.share;
  return {
    apps: s.apps.filter((a) => reachable(a.to, reach)),
    shortcuts: s.shortcuts && s.shortcuts.filter((x) => reachable(x.to, reach)),
    share,
    ai: s.ai,
    muted: s.muted,
  };
}

/** Het pad van een eigen app (en de id in haar manifest). */
export const appPath = (appId: string) => `/app/${appId}`;

/** Gaan twee bestemmingen naar hetzelfde? (Een lijst die je op je beginscherm zet, hergebruikt haar app.) */
export function sameDestination(a: Destination, b: Destination): boolean {
  const key = (d: Destination) => JSON.stringify(cleanDestination(d));
  return key(a) === key(b);
}
