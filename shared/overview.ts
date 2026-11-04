// Wat op je overzicht staat: blokken in jouw volgorde, per persoon bewaard (people.overview). Leeg (null) = vanzelf:
// elk project met al zijn lijsten. Een blok bewaart enkel ids; wat erin staat, haalt de app op met jouw rechten, dus
// een blok over iets dat je (niet meer) mag zien, blijft gewoon weg.

const ID = /^[A-Za-z0-9-]{1,64}$/;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;

export type Block =
  /** Een project (of subproject) met zijn lijsten; `hide`: de lijsten die je er niet wil zien. */
  | { kind: "project"; project: string; hide?: string[] }
  /** Eén lijst: hoeveel erin zit, en openen. */
  | { kind: "list"; project: string; list: string }
  /** Meteen iets toevoegen aan een lijst ("Eten toevoegen"). */
  | { kind: "add"; project: string; list: string }
  /** Een totaal van een lijst (Kcal vandaag, Uitgaven deze maand). */
  | { kind: "total"; project: string; list: string; total: string }
  /** Eén veld van één item, ook een berekening (Pellets · Aantal, Laatst bijgevuld). */
  | { kind: "value"; item: string; field: string };

export type BlockKind = Block["kind"];

/** De soorten blokken, in de volgorde van de keuze bij Toevoegen. */
export const BLOCK_KINDS = {
  project: "Project",
  list: "Lijst",
  add: "Snel toevoegen",
  total: "Totaal",
  value: "Waarde van een item",
} as const satisfies Record<BlockKind, string>;

export const MAX_BLOCKS = 40;

/** Herkent een blok (twee keer hetzelfde blok kan niet). */
export function blockKey(b: Block): string {
  switch (b.kind) {
    case "project":
      return `project/${b.project}`;
    case "list":
    case "add":
      return `${b.kind}/${b.project}/${b.list}`;
    case "total":
      return `total/${b.project}/${b.list}/${b.total}`;
    case "value":
      return `value/${b.item}/${b.field}`;
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
      b = { kind: "project", project: o.project as string, ...(hide.length ? { hide } : {}) };
    } else if ((o.kind === "list" || o.kind === "add") && id(o.project) && id(o.list)) {
      b = { kind: o.kind, project: o.project as string, list: o.list as string };
    } else if (o.kind === "total" && id(o.project) && id(o.list) && id(o.total)) {
      b = { kind: "total", project: o.project as string, list: o.list as string, total: o.total as string };
    } else if (o.kind === "value" && id(o.item) && typeof o.field === "string" && KEY.test(o.field)) {
      b = { kind: "value", item: o.item as string, field: o.field };
    }
    if (!b || seen.has(blockKey(b))) continue;
    seen.add(blockKey(b));
    out.push(b);
    if (out.length === MAX_BLOCKS) break;
  }
  return out;
}

/** Het overzicht vanzelf: elk project (in de volgorde van je boom) met al zijn lijsten. */
export const defaultBlocks = (projectIds: string[]): Block[] => projectIds.map((project) => ({ kind: "project", project }));
