// Je overzicht: een of meer borden (Overzicht, Keuken) met blokken die je zelf kiest. Elk blok bewaart enkel ids;
// wat erin staat, haalt de app op met de gewone routes (dus met jouw rechten): een blok over iets dat je niet (meer)
// ziet, blijft gewoon leeg of weg. `null` = vanzelf (`defaultBlocks`).

import { cleanActionBlock, cleanViewBlock, upgradeBlock, type ActionBlock, type ViewBlock } from "./blocks.ts";

/**
 * Een blok: een weergave (wat je ziet), een actie (een knop die logt) of één ding met zijn voorraad. De vaste blokken
 * van vroeger (Uitgaven, Te doen, Bijna op, Wie moet wie, Eten, Loopt nu, een lijst, een grafiek, Snel loggen) worden
 * bij het nakijken de gelijkwaardige weergave of actie (`upgradeBlock`).
 */
export type Block = (ViewBlock | ActionBlock | { kind: "thing"; thing: string }) & { wide?: boolean };

export type BlockKind = Block["kind"];

export const BLOCK_KINDS = {
  view: "Weergave",
  action: "Actie",
  thing: "Eén ding",
} as const satisfies Record<BlockKind, string>;

/** Zoveel items toont een blok met dingen of een logboek. */
export const BLOCK_ITEMS = 5;
export const MAX_BLOCKS = 40;

const ID = /^[A-Za-z0-9-]{1,64}$/;
const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);

/** Eén blok nagekeken (een oud blok omgezet), of null. */
export function cleanBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const wide = o.wide === true ? { wide: true } : {};
  const block = o.kind === "view" ? cleanViewBlock(o) : o.kind === "action" ? cleanActionBlock(o) : o.kind === "thing" ? (id(o.thing) ? { kind: "thing" as const, thing: o.thing as string } : null) : upgradeBlock(o);
  return block ? { ...block, ...wide } : null;
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

export type QuickBlock = Extract<Block, { kind: "action" }>;

/** De blokken zoals het overzicht ze tekent: acties na elkaar staan samen (een rij knoppen), de rest los. */
export function segmentBlocks(blocks: Block[]): (Block | QuickBlock[])[] {
  const out: (Block | QuickBlock[])[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (b.kind !== "action") out.push(b);
    else if (Array.isArray(last)) last.push(b);
    else out.push([b]);
  }
  return out;
}

/** Een sleutel per blok (om dubbels te weren en in React). */
export function blockKey(b: Block): string {
  if (b.kind === "thing") return `thing:${b.thing}`;
  const { wide: _wide, ...rest } = b;
  return `${b.kind}:${JSON.stringify(rest)}`;
}

/** Vanzelf: wat je deze maand uitgaf, wat te doen staat, wat bijna op is en wie wie moet (als weergaven). */
export function defaultBlocks(lists: { id: string; archived: 0 | 1 }[], has: { money: boolean; stock: boolean }): Block[] {
  // Zonder lijsten als blok: die staan in de zijbalk en onder Menu (een lijstblok kies je zelf).
  if (!lists.some((x) => !x.archived)) return [];
  const kinds = [has.money && "money", "todo", has.stock && "stock", has.money && "balance"].filter((k): k is string => Boolean(k));
  return kinds.map((kind) => upgradeBlock({ kind })).filter((b): b is ViewBlock => b !== null && b.kind === "view");
}

// ---------- borden ----------

/** Een bord staat met zijn naam en icoon in het menu (het eerste is je beginscherm). */
export type Board = { id: string; name: string; icon: string; blocks: Block[] | null };
export type BoardInfo = { id: string; name: string; icon: string };
export const BOARD_ICON = "project";
const ICON = /^[a-z]{2,20}$/;
const iconOf = (v: unknown) => (typeof v === "string" && ICON.test(v) ? v : BOARD_ICON);
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
    boards.push({ id: boardId, name, icon: iconOf(r.icon), blocks: fresh ? cleanBlocks(r.blocks) : null });
  }
  if (!boards.length) boards.push({ id: MAIN_BOARD, name: "Overzicht", icon: BOARD_ICON, blocks: null });
  return boards;
}

/** Hernoemen, een icoon kiezen, schikken, toevoegen (zonder id) en weghalen; er blijft er altijd één. */
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
    const icon = r.icon === undefined && had ? had.icon : iconOf(r.icon);
    out.push(had ? { ...had, name, icon } : { id: newId(), name, icon, blocks: [] });
  }
  return out.length ? out : current.slice(0, 1);
}
