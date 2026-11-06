// Je overzicht: een of meer borden (Overzicht, Keuken) met blokken die je zelf kiest. Elk blok bewaart enkel ids;
// wat erin staat, haalt de app op met de gewone routes (dus met jouw rechten): een blok over iets dat je niet (meer)
// ziet, blijft gewoon leeg of weg. `null` = vanzelf (`defaultBlocks`).

import { cleanChart, type ChartDef } from "./charts.ts";

export type Block = (
  | { kind: "list"; list: string; show: "count" | "things" | "log"; view?: string }
  | { kind: "money" }
  | { kind: "balance" }
  | { kind: "todo" }
  | { kind: "stock" }
  | { kind: "food" }
  | { kind: "timers" }
  | { kind: "quick"; list: string; type?: string }
  | { kind: "thing"; thing: string }
  | { kind: "chart"; list: string | null; source: "logboek" | "dingen"; chart: ChartDef }
) & { wide?: boolean };

export type BlockKind = Block["kind"];

export const BLOCK_KINDS = {
  list: "Lijst",
  money: "Uitgaven deze maand",
  balance: "Wie moet wie",
  todo: "Te doen",
  stock: "Bijna op",
  food: "Eten vandaag",
  timers: "Loopt nu",
  quick: "Snel loggen",
  thing: "Eén ding",
  chart: "Grafiek",
} as const satisfies Record<BlockKind, string>;

/** Zoveel items toont een blok met dingen of een logboek. */
export const BLOCK_ITEMS = 5;
export const MAX_BLOCKS = 40;
/** Vanzelf: zoveel lijsten hoogstens (de rest via de zijbalk). */

const ID = /^[A-Za-z0-9-]{1,64}$/;
const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);

/** Eén blok nagekeken, of null. */
export function cleanBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const wide = o.wide === true ? { wide: true } : {};
  switch (o.kind) {
    case "list": {
      const list = id(o.list);
      if (!list) return null;
      const show = o.show === "things" || o.show === "log" ? o.show : "count";
      return { kind: "list", list, show, ...(id(o.view) ? { view: o.view as string } : {}), ...wide };
    }
    case "money":
    case "balance":
    case "todo":
    case "stock":
    case "food":
    case "timers":
      return { kind: o.kind, ...wide };
    case "quick": {
      const list = id(o.list);
      return list ? { kind: "quick", list, ...(id(o.type) ? { type: o.type as string } : {}), ...wide } : null;
    }
    case "thing":
      return id(o.thing) ? { kind: "thing", thing: o.thing as string, ...wide } : null;
    case "chart": {
      const chart = cleanChart(o.chart);
      if (!chart) return null;
      return { kind: "chart", list: id(o.list), source: o.source === "dingen" ? "dingen" : "logboek", chart, ...wide };
    }
    default:
      return null;
  }
}

/** De blokken van een bord; null = vanzelf. Dubbele blokken vallen weg. */
export function cleanBlocks(raw: unknown): Block[] | null {
  if (raw === null || raw === undefined || !Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: Block[] = [];
  for (const r of raw.slice(0, MAX_BLOCKS)) {
    const b = cleanBlock(r);
    if (!b) continue;
    const key = blockKey(b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

export type QuickBlock = Extract<Block, { kind: "quick" }>;

/** De blokken zoals het overzicht ze tekent: Snel loggen na elkaar staat samen (een rij knoppen), de rest los. */
export function segmentBlocks(blocks: Block[]): (Block | QuickBlock[])[] {
  const out: (Block | QuickBlock[])[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (b.kind !== "quick") out.push(b);
    else if (Array.isArray(last)) last.push(b);
    else out.push([b]);
  }
  return out;
}

/** Een sleutel per blok (om dubbels te weren en in React). */
export function blockKey(b: Block): string {
  switch (b.kind) {
    case "list":
      return `list:${b.list}:${b.show}:${b.view ?? ""}`;
    case "quick":
      return `quick:${b.list}:${b.type ?? ""}`;
    case "thing":
      return `thing:${b.thing}`;
    case "chart":
      return `chart:${b.list ?? ""}:${JSON.stringify(b.chart)}`;
    default:
      return b.kind;
  }
}

/** Vanzelf: wat je deze maand uitgaf, wat te doen staat, wat bijna op is, en je eerste lijsten. */
export function defaultBlocks(lists: { id: string; archived: 0 | 1 }[], has: { money: boolean; stock: boolean }): Block[] {
  const out: Block[] = [];
  if (has.money) out.push({ kind: "money" });
  out.push({ kind: "todo" });
  if (has.stock) out.push({ kind: "stock" });
  if (has.money) out.push({ kind: "balance" });
  // Zonder lijsten als blok: die staan in de zijbalk en onder Menu (een lijstblok kies je zelf).
  if (!lists.some((x) => !x.archived)) return [];
  return out;
}

// ---------- borden ----------

export type Board = { id: string; name: string; blocks: Block[] | null };
export type BoardInfo = { id: string; name: string };
export const MAX_BOARDS = 8;
export const MAIN_BOARD = "main";

/** De borden zoals bewaard (people.overview, `{ v: 2, boards }`); oude borden (van projecten) beginnen vanzelf. */
export function cleanBoards(raw: unknown): Board[] {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fresh = o.v === 2;
  const boards: Board[] = [];
  const seen = new Set<string>();
  for (const b of Array.isArray(o.boards) ? o.boards.slice(0, MAX_BOARDS) : []) {
    if (!b || typeof b !== "object") continue;
    const r = b as Record<string, unknown>;
    const boardId = id(r.id);
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 30) : "";
    if (!boardId || !name || seen.has(boardId)) continue;
    seen.add(boardId);
    boards.push({ id: boardId, name, blocks: fresh ? cleanBlocks(r.blocks) : null });
  }
  if (!boards.length) boards.push({ id: MAIN_BOARD, name: "Overzicht", blocks: null });
  return boards;
}

/** Hernoemen, schikken, toevoegen (zonder id) en weghalen; er blijft er altijd één. */
export function renameBoards(current: Board[], wanted: unknown, newId: () => string): Board[] {
  if (!Array.isArray(wanted)) return current;
  const byId = new Map(current.map((b) => [b.id, b]));
  const out: Board[] = [];
  for (const w of wanted.slice(0, MAX_BOARDS)) {
    if (!w || typeof w !== "object") continue;
    const r = w as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 30) : "";
    if (!name) continue;
    const had = typeof r.id === "string" ? byId.get(r.id) : undefined;
    out.push(had ? { ...had, name } : { id: newId(), name, blocks: [] });
  }
  return out.length ? out : current.slice(0, 1);
}
