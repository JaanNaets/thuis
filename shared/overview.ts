import { cleanChart, type ChartDef } from "./charts.ts";

// Wat op je overzicht staat: blokken in jouw volgorde, per persoon bewaard (people.overview). Leeg (null) = vanzelf:
// elk project met al zijn lijsten. Een blok bewaart enkel ids; wat erin staat, haalt de app op met jouw rechten, dus
// een blok over iets dat je (niet meer) mag zien, blijft gewoon weg.

const ID = /^[A-Za-z0-9-]{1,64}$/;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

export type Block = (
  /**
   * Een project (of subproject) met zijn lijsten; `hide`: de lijsten die je er niet wil zien; `views`: per lijst een
   * bewaarde weergave om te tellen (Voorraad · Te kopen 3).
   */
  | { kind: "project"; project: string; hide?: string[]; views?: Record<string, string> }
  /**
   * Eén lijst: hoeveel erin zit, en openen. `view`: een bewaarde weergave (hoeveel daarin zit: "Te kopen 3");
   * `show: "items"`: de eerste items zelf, als kleine tabel (met − en + bij een voorraad).
   */
  | { kind: "list"; project: string; list: string; view?: string; show?: "items" }
  /** Meteen iets toevoegen aan een lijst ("Eten toevoegen"). */
  | { kind: "add"; project: string; list: string }
  /** Een totaal van een lijst (Kcal vandaag, Uitgaven deze maand). */
  | { kind: "total"; project: string; list: string; total: string }
  /** Eén veld van één item, ook een berekening (Pellets · Aantal, Laatst bijgevuld). */
  | { kind: "value"; item: string; field: string }
  /** Een grafiek over een lijst, helemaal zelf samengesteld (zie shared/charts.ts); `id`: om er meer per lijst te hebben. */
  | { kind: "chart"; id: string; project: string; list: string; chart: ChartDef; title?: string }
  /** Een titel en tekst (bv. bovenaan een verslag). */
  | { kind: "text"; id: string; title?: string; text?: string }
  /** Een timer van een lijst (veldsoort Timer): starten (een nieuw item) en stoppen met één tik. */
  | { kind: "timer"; project: string; list: string; field: string }
) & {
  /** Breed: over twee kolommen (op tablet en computer). */
  wide?: true;
};

/** Zoveel items toont een lijstblok met `show: "items"`. */
export const BLOCK_ITEMS = 5;

export type BlockKind = Block["kind"];

/** De soorten blokken, in de volgorde van de keuze bij Toevoegen. */
export const BLOCK_KINDS = {
  project: "Project",
  list: "Lijst",
  add: "Snel toevoegen",
  total: "Totaal",
  value: "Waarde van een item",
  chart: "Grafiek",
  text: "Tekst",
  timer: "Timer",
} as const satisfies Record<BlockKind, string>;

export const MAX_BLOCKS = 40;

/** Herkent een blok (twee keer hetzelfde blok kan niet). */
export function blockKey(b: Block): string {
  switch (b.kind) {
    case "project":
      return `project/${b.project}`;
    case "list":
      return `list/${b.project}/${b.list}${b.view ? `/${b.view}` : ""}${b.show ? `/${b.show}` : ""}`;
    case "add":
      return `add/${b.project}/${b.list}`;
    case "total":
      return `total/${b.project}/${b.list}/${b.total}`;
    case "value":
      return `value/${b.item}/${b.field}`;
    case "chart":
      return `chart/${b.id}`;
    case "text":
      return `text/${b.id}`;
    case "timer":
      return `timer/${b.project}/${b.list}/${b.field}`;
  }
}

/** Wat binnenkomt (of bewaard staat), nagekeken: enkel geldige blokken, geen dubbels, hoogstens MAX_BLOCKS. */
export function cleanBlocks(raw: unknown): Block[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
  const seen = new Set<string>();
  const out: Block[] = [];
  for (const r of raw.slice(0, MAX_BLOCKS * 2)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    let b: Block | null = null;
    if (o.kind === "project" && id(o.project)) {
      const hide = Array.isArray(o.hide) ? [...new Set(o.hide.map(id).filter((x): x is string => x !== null))].slice(0, 60) : [];
      const raw = o.views && typeof o.views === "object" && !Array.isArray(o.views) ? (o.views as Record<string, unknown>) : {};
      const views = Object.fromEntries(
        Object.entries(raw)
          .filter(([list, view]) => id(list) && id(view))
          .slice(0, 60),
      ) as Record<string, string>;
      b = { kind: "project", project: o.project as string, ...(hide.length ? { hide } : {}), ...(Object.keys(views).length ? { views } : {}) };
    } else if (o.kind === "list" && id(o.project) && id(o.list)) {
      b = { kind: "list", project: o.project as string, list: o.list as string, ...(id(o.view) ? { view: o.view as string } : {}), ...(o.show === "items" ? { show: "items" as const } : {}) };
    } else if (o.kind === "add" && id(o.project) && id(o.list)) {
      b = { kind: "add", project: o.project as string, list: o.list as string };
    } else if (o.kind === "total" && id(o.project) && id(o.list) && id(o.total)) {
      b = { kind: "total", project: o.project as string, list: o.list as string, total: o.total as string };
    } else if (o.kind === "value" && id(o.item) && typeof o.field === "string" && KEY.test(o.field)) {
      b = { kind: "value", item: o.item as string, field: o.field };
    } else if (o.kind === "chart" && id(o.id) && id(o.project) && id(o.list)) {
      const chart = cleanChart(o.chart);
      const title = text(o.title, 60);
      if (chart) b = { kind: "chart", id: o.id as string, project: o.project as string, list: o.list as string, chart, ...(title ? { title } : {}) };
    } else if (o.kind === "timer" && id(o.project) && id(o.list) && typeof o.field === "string" && KEY.test(o.field)) {
      b = { kind: "timer", project: o.project as string, list: o.list as string, field: o.field };
    } else if (o.kind === "text" && id(o.id)) {
      const title = text(o.title, 80);
      const body = typeof o.text === "string" ? o.text.trim().slice(0, 2000) : "";
      if (title || body) b = { kind: "text", id: o.id as string, ...(title ? { title } : {}), ...(body ? { text: body } : {}) };
    }
    if (b && o.wide === true) b = { ...b, wide: true };
    if (!b || seen.has(blockKey(b))) continue;
    seen.add(blockKey(b));
    out.push(b);
    if (out.length === MAX_BLOCKS) break;
  }
  return out;
}

/** Tot zoveel projecten krijgt vanzelf elk een blok; heb je er meer, dan enkel de projecten bovenaan. */
export const DEFAULT_ALL = 12;

/**
 * Het overzicht vanzelf: elk project (in de volgorde van je boom) met al zijn lijsten, of bij veel projecten enkel die
 * bovenaan (hun ouder zit er niet bij). Zo blijft het overzicht licht, ook met 1000 projecten.
 */
export function defaultBlocks(projects: { id: string; parent_id: string | null }[]): Block[] {
  const ids = new Set(projects.map((p) => p.id));
  const shown = projects.length <= DEFAULT_ALL ? projects : projects.filter((p) => !p.parent_id || !ids.has(p.parent_id));
  return shown.map((p) => ({ kind: "project", project: p.id }));
}

/**
 * De projecten waarvan de blokken de lijsten nodig hebben: een projectblok toont ze, een lijst-, snel-toevoegen- of
 * totaalblok zoekt er zijn lijst in (ook zonder projectblok erbij, bv. op een overzicht "Keuken").
 */
export const blockProjects = (blocks: Block[]): string[] => [...new Set(blocks.flatMap((b) => ("project" in b ? [b.project] : [])))];

// ---------- meerdere overzichten ----------

/** Een overzicht met een naam ("Thuis", "Keuken", "Kelder"), elk met zijn eigen blokken (null = vanzelf). */
export type Board = { id: string; name: string; blocks: Block[] | null };
export type BoardInfo = { id: string; name: string };

export const MAX_BOARDS = 8;
/** Het eerste overzicht (ook het oude, van voor er meer konden). */
export const MAIN_BOARD = "main";

const boardName = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 30) : "");

/**
 * Wat in people.overview staat, nagekeken: altijd minstens één overzicht. Het oude formaat (enkel blokken, of null)
 * wordt het eerste overzicht "Overzicht".
 */
export function cleanBoards(raw: unknown): Board[] {
  const fallback = (blocks: Block[] | null): Board[] => [{ id: MAIN_BOARD, name: "Overzicht", blocks }];
  if (raw === null || raw === undefined) return fallback(null);
  if (Array.isArray(raw)) return fallback(cleanBlocks(raw));
  const list = raw && typeof raw === "object" ? (raw as { boards?: unknown }).boards : null;
  if (!Array.isArray(list)) return fallback(null);
  const seen = new Set<string>();
  const out: Board[] = [];
  for (const b of list) {
    if (!b || typeof b !== "object") continue;
    const o = b as Record<string, unknown>;
    const id = typeof o.id === "string" && ID.test(o.id) ? o.id : null;
    const name = boardName(o.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, blocks: cleanBlocks(o.blocks) });
    if (out.length === MAX_BOARDS) break;
  }
  return out.length ? out : fallback(null);
}

/**
 * Nieuwe namen en volgorde van je overzichten (`wanted`: id en naam; zonder id = een nieuw, leeg overzicht). Wat er
 * niet meer in staat, valt weg; er blijft er altijd minstens één.
 */
export function renameBoards(current: Board[], wanted: unknown, newId: () => string): Board[] {
  if (!Array.isArray(wanted)) return current;
  const byId = new Map(current.map((b) => [b.id, b]));
  const out: Board[] = [];
  for (const w of wanted.slice(0, MAX_BOARDS)) {
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    const name = boardName(o.name);
    if (!name) continue;
    const old = typeof o.id === "string" ? byId.get(o.id) : undefined;
    if (old && !out.some((b) => b.id === old.id)) out.push({ ...old, name });
    else if (!old && o.id === undefined) out.push({ id: newId(), name, blocks: [] });
  }
  return out.length ? out : current.slice(0, 1);
}
