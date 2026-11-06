// De verbanden (zie shared/links.ts) als metrokaart (kolommen = tags, stations = lijsten, sporen = verbanden tussen
// lijsten, de weergaven als een regel tekst bij elk station) en als schema van één lijst (gsm). De schikking komt uit
// `layoutLinks`; hier wordt ze enkel getekend. De rest (lijst, paneel, zoeken, selectie) staat in LinkParts/LinkList.

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  betweenLists,
  layoutLinks,
  linkKey,
  viewOf,
  viewsOf,
  VIEWS,
  type Link as LinkDef,
  type LinkKind,
  type LinkProblem,
  type LinksResponse,
  type ViewKey,
} from "../../shared/links";
import type { ListNode } from "../../shared/model";
import { formatDay } from "../format";
import { listIcon, listTone } from "../lists";
import type { IconName } from "./Icon";

/** Het icoon van een weergave (in de lijst, het paneel en de treffers). */
export const VIEW_ICONS: Record<ViewKey, IconName> = {
  geld: "wallet",
  balans: "transfer",
  voorraad: "package",
  eten: "food",
  tedoen: "check",
  agenda: "calendar",
  timers: "clock",
  herinneringen: "alert",
  meldingen: "info",
  herhalen: "repeat",
  productinfo: "scan",
  kasticket: "receipt",
  overzicht: "project",
};

export type MapColumn = {
  key: string;
  name: string;
  tone: string | null;
  lists: ListNode[];
};
/** Wat oplicht op de kaart (zoeken, je selectie): punten en sporen (`linkKey`). */
export type Lit = { nodes: Set<string>; links: Set<string> };

// Maten van de kaart (px, op ware grootte).
const SLOT = 132;
const PAD = 14;
const GAP = 12;
const FIRST = 112;
const FIRST_ALONE = 64;
const ROW = 112;
const LANE = 7;
/** Zoveel tekens passen er in de regel met weergaven onder een station. */
const VIEW_CHARS = 21;
/** Kleiner dan dit schaalt de kaart niet: dan schuift ze binnen haar vlak. */
const MIN_SCALE = 0.72;
const HOVER_WIDTH = 240;

export const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
export const plural = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;

/** Wat er bij een lijst staat: hoeveel dingen (of gebeurtenissen, voor een lijst zonder dingen). */
export function listMeta(list: Pick<ListNode, "id" | "one">, counts: LinksResponse["counts"]): string {
  const c = counts[list.id];
  if (!c) return "";
  return list.one ? plural(c.things, "ding", "dingen") : plural(c.events, "gebeurtenis", "gebeurtenissen");
}

/** "laatst gisteren", of niets als er nog niets gebeurd is. */
export const lastText = (last: string | null | undefined) => (last ? `laatst ${formatDay(last)}` : "");

/** De weergaven als één korte regel: zoveel namen als er passen, dan "+3". */
export function viewsLine(views: ViewKey[], max = VIEW_CHARS): string {
  const labels = views.map((v) => VIEWS[v].label);
  let text = "";
  for (let i = 0; i < labels.length; i++) {
    const next = text ? `${text} · ${labels[i]}` : labels[i];
    const rest = labels.length - i - 1;
    if (next.length + (rest ? ` · +${rest}`.length : 0) > max) return text ? `${text} · +${labels.length - i}` : `${cut(labels[i], max - 4)} · +${rest}`;
    text = next;
  }
  return text;
}

/** Een stukje lijn in de kleur en het patroon van een soort verband (filters, rijen). */
export function LinkSwatch({ kind }: { kind: LinkKind }) {
  return (
    <svg width="18" height="6" aria-hidden="true" className="lm-swatch">
      <path d="M 1.5 3 L 16.5 3" className={`lm-line lm-${kind}`} />
    </svg>
  );
}

type End = { id: string; name: string; icon: IconName; tone: string | null };

/** Hoe een lijst of weergave heet en eruitziet in een rij. */
export function endOf(id: string, byId: Map<string, ListNode>): End | null {
  const view = viewOf(id);
  if (view) return { id, name: VIEWS[view].label, icon: VIEW_ICONS[view], tone: null };
  const list = byId.get(id);
  return list ? { id, name: list.name, icon: listIcon(list), tone: listTone(list) } : null;
}

/** Verbanden per ander eind (een lijst of weergave), in de volgorde waarin ze voorkomen. */
export function byOther(links: LinkDef[], id: string): [string, LinkDef[]][] {
  const out = new Map<string, LinkDef[]>();
  for (const l of links) {
    const other = l.from === id ? l.to : l.from;
    out.set(other, [...(out.get(other) ?? []), l]);
  }
  return [...out];
}

/** Hoeveel gebeurtenissen een reeks verbanden samen telt. */
export const total = (ls: LinkDef[]) => ls.reduce((a, l) => a + (l.count ?? 0), 0);

/** De breedte van het vlak waar de kaart in staat (om ze passend te schalen). */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * De metrokaart. Elke lijst waar een verband in toekomt, krijgt een eigen rij; een lijn loopt verticaal bij de lijst
 * waar ze vertrekt en dan horizontaal naar haar doel, op een eigen baan per soort. Een verband dat voor iemand niet
 * werkt, is rood gestreept. Onder elke lijst de weergaven waar ze in voorkomt (als `views` aanstaat). Een gekozen lijst,
 * of anders wat `lit` aanwijst (zoeken, je selectie), licht op; de rest wordt dof. Met de muis boven een station: een
 * kaartje met wat erin toekomt en waar het naartoe gaat.
 */
export function LinkMapView({
  columns,
  links: active,
  views,
  counts,
  problems,
  selected,
  lit,
  onSelect,
}: {
  columns: MapColumn[];
  /** De verbanden die aanstaan (de filters). */
  links: LinkDef[];
  /** De weergaven tonen bij elke lijst. */
  views: boolean;
  counts: LinksResponse["counts"];
  problems: LinkProblem[];
  selected: string | null;
  lit: Lit | null;
  onSelect: (id: string | null) => void;
}) {
  const [ref, available] = useWidth();
  const [hover, setHover] = useState<string | null>(null);
  const columnIds = columns.map((c) => c.key);
  const nodes = columns.flatMap((c) => c.lists.map((l) => ({ id: l.id, column: c.key, list: l })));
  const named = new Map(nodes.map((n) => [n.id, n.list]));
  const between = betweenLists(active);
  // Elke lijst staat op de kaart: zonder spoor op de eerste vrije rij van haar kolom (met haar weergaven, of leeg).
  const layout = layoutLinks(
    columnIds,
    nodes,
    between,
    nodes.map((n) => n.id),
  );
  const shown = nodes.filter((n) => layout.places.has(n.id));
  const links = between.filter((l) => layout.places.has(l.from) && layout.places.has(l.to));
  const broken = new Set(problems.map((p) => `${p.list}|${p.to}`));

  // Kolommen naast elkaar (enkel die met punten), rijen onder elkaar (een rij met meer banen is wat hoger).
  const used = columnIds.filter((_, i) => shown.some((n) => layout.places.get(n.id)!.col === i));
  const widths = layout.slots.map((s) => s * SLOT + 2 * PAD);
  const colX: number[] = [];
  let width = -GAP;
  for (const cid of used) {
    const i = columnIds.indexOf(cid);
    colX[i] = width + GAP;
    width += widths[i] + GAP;
  }
  width = Math.max(width, 1);
  const lanesOf = (row: number) => Math.max(1, layout.rows[row]?.kinds.length ?? 1);
  // Bovenaan ruimte voor een naam boven een station, enkel als de eerste rij een spoor heeft.
  const first = layout.rows[0]?.hub ? FIRST : FIRST_ALONE;
  const rowY = layout.rows.map((_, i) => first + layout.rows.slice(0, i).reduce((a, _r, j) => a + ROW + (lanesOf(j) - 1) * LANE, 0));
  const lastRow = layout.rows.length - 1;
  const height = (rowY[lastRow] ?? first) + (lanesOf(lastRow) - 1) * LANE + 80;
  const scale = available ? Math.max(MIN_SCALE, Math.min(1, available / width)) : 1;

  const at = (id: string) => {
    const p = layout.places.get(id)!;
    return {
      x: colX[p.col] + PAD + p.slot * SLOT + SLOT / 2,
      y: rowY[p.row],
      row: p.row,
    };
  };
  const laneOf = (l: LinkDef) => {
    const row = layout.places.get(l.to)!.row;
    return rowY[row] + Math.max(0, layout.rows[row].kinds.indexOf(l.kind)) * LANE;
  };
  // Wat oplicht: de gekozen lijst en haar buren, of anders wat zoeken of je selectie aanwijst.
  const litNodes = selected ? new Set([selected, ...links.filter((l) => l.from === selected || l.to === selected).flatMap((l) => [l.from, l.to])]) : (lit?.nodes ?? null);
  const isLit = (l: LinkDef) => (selected ? l.from === selected || l.to === selected : lit ? lit.links.has(linkKey(l)) : true);

  const path = (l: LinkDef) => {
    const a = at(l.from);
    const b = at(l.to);
    const y = laneOf(l);
    if (a.row === b.row) return `M ${a.x} ${y} H ${b.x}`;
    const dir = Math.sign(b.x - a.x) || 1;
    const r = Math.min(12, Math.abs(y - a.y), Math.abs(b.x - a.x));
    const turn = y > a.y ? y - r : y + r;
    return `M ${a.x} ${a.y} V ${turn} Q ${a.x} ${y} ${a.x + dir * r} ${y} H ${b.x}`;
  };

  const kindsAt = (id: string) => new Set(links.filter((l) => l.from === id || l.to === id).map((l) => l.kind));
  const key = (e: KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(selected === id ? null : id);
    }
  };

  return (
    <div className="linkmap" ref={ref}>
      <div className="lm-canvas" style={{ width: width * scale, height: height * scale }}>
        <svg
          width={width * scale}
          height={height * scale}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label="Kaart van je verbanden"
          onClick={(e) => e.target === e.currentTarget && onSelect(null)}
        >
          {used.map((cid) => {
            const i = columnIds.indexOf(cid);
            const column = columns[i];
            return (
              <g key={cid} className={`lm-column${column.tone ? ` tone-${column.tone}` : ""}`}>
                <rect x={colX[i]} y={0} width={widths[i]} height={height} rx={14} />
                <circle cx={colX[i] + 18} cy={24} r={4} className="lm-column-dot" />
                <text x={colX[i] + 28} y={28} className="lm-column-name">
                  {cut(column.name.toUpperCase(), Math.floor((widths[i] - 34) / 8))}
                </text>
              </g>
            );
          })}

          {links.map((l) => (
            <path
              key={linkKey(l)}
              d={path(l)}
              className={`lm-line lm-track lm-${l.kind}${broken.has(`${l.from}|${l.to}`) ? " lm-problem" : ""}${isLit(l) ? "" : " lm-dim"}`}
            />
          ))}

          {shown.map((n) => {
            const { x, y, row } = at(n.id);
            const lanes = lanesOf(row);
            const hub = links.some((l) => l.to === n.id);
            const s = hub ? 22 : 16;
            const kinds = kindsAt(n.id);
            const ring =
              kinds.size === 1
                ? `lm-station lm-${[...kinds][0]}`
                : kinds.size > 1
                  ? "lm-station lm-mixed"
                  : active.some((l) => l.from === n.id || l.to === n.id)
                    ? "lm-station lm-alone"
                    : "lm-station lm-empty";
            const bottom = y + s / 2 + (lanes - 1) * LANE;
            const rows = links.filter((l) => l.from === n.id).map((l) => layout.places.get(l.to)!.row);
            const down = rows.some((r) => r > row);
            const up = rows.some((r) => r < row);
            const meta = cut(listMeta(n.list, counts), 18);
            const ofList = views ? viewsOf(active, n.id) : [];
            // De naam staat onder het punt, boven als er een lijn naar beneden vertrekt, en opzij als er lijnen naar
            // boven én beneden gaan (aan de kant waar geen lijn op deze rij loopt).
            const sideways = (dir: 1 | -1) =>
              links.some(
                (l) =>
                  // Wat hier toekomt, rijdt op deze rij; wat vertrekt, enkel als het doel op dezelfde rij staat.
                  (l.to === n.id && Math.sign(at(l.from).x - x) === dir) || (l.from === n.id && at(l.to).row === row && Math.sign(at(l.to).x - x) === dir),
              );
            const place = down && up ? (!sideways(1) ? "right" : !sideways(-1) ? "left" : "below") : down ? "above" : "below";
            const tx = place === "right" ? x + s / 2 + 8 : place === "left" ? x - s / 2 - 8 : x;
            const ty = place === "right" || place === "left" ? y + 4 : place === "above" ? y - s / 2 - 24 - (ofList.length ? 18 : 0) : bottom + 18;
            const anchor = place === "right" ? "start" : place === "left" ? "end" : "middle";
            const line = viewsLine(ofList);
            const on = selected === n.id;
            const hit = !selected && lit?.nodes.has(n.id);
            return (
              <g
                key={n.id}
                className={`lm-node tone-${listTone(n.list)}${litNodes && !litNodes.has(n.id) ? " lm-dim" : ""}`}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                aria-label={`${n.list.name}${meta ? `, ${meta}` : ""}${ofList.length ? `, in ${ofList.map((v) => VIEWS[v].label).join(", ")}` : ""}`}
                onClick={() => onSelect(on ? null : n.id)}
                onKeyDown={(e) => key(e, n.id)}
                onPointerEnter={(e) => e.pointerType === "mouse" && setHover(n.id)}
                onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
              >
                <rect
                  className={`lm-halo${on ? " on" : hit ? " hit" : ""}`}
                  x={x - s / 2 - 8}
                  y={y - s / 2 - 8}
                  width={s + 16}
                  height={s + 16 + (lanes - 1) * LANE}
                  rx={(s + 16) / 2}
                />
                <rect className={ring} x={x - s / 2} y={y - s / 2} width={s} height={s + (lanes - 1) * LANE} rx={s / 2} strokeWidth={hub ? 5 : 3} />
                <text x={tx} y={ty} textAnchor={anchor} className="lm-name">
                  {cut(n.list.name, 16)}
                </text>
                <text x={tx} y={ty + 15} textAnchor={anchor} className="lm-meta">
                  {meta}
                </text>
                {line && (
                  <text x={tx} y={ty + 31} textAnchor={anchor} className="lm-views">
                    <tspan className="lm-views-dot">●</tspan> {line}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {hover && hover !== selected && layout.places.has(hover) && (
          <HoverCard id={hover} links={active} named={named} counts={counts} x={at(hover).x * scale} y={at(hover).y * scale} width={width * scale} />
        )}
      </div>
    </div>
  );
}

/** Het kaartje bij een station onder de muis: wat erin toekomt, waar het naartoe gaat, de weergaven. */
function HoverCard({
  id,
  links,
  named,
  counts,
  x,
  y,
  width,
}: {
  id: string;
  links: LinkDef[];
  named: Map<string, ListNode>;
  counts: LinksResponse["counts"];
  x: number;
  y: number;
  width: number;
}) {
  const list = named.get(id);
  if (!list) return null;
  const between = betweenLists(links).filter((l) => (l.from === id && named.has(l.to)) || (l.to === id && named.has(l.from)));
  const ins = byOther(
    between.filter((l) => l.to === id),
    id,
  );
  const outs = byOther(
    between.filter((l) => l.from === id),
    id,
  );
  const views = viewsOf(links, id);
  const meta = [listMeta(list, counts), lastText(counts[id]?.last)].filter(Boolean).join(" · ");
  const left = x + 28 + HOVER_WIDTH > width ? Math.max(0, x - 28 - HOVER_WIDTH) : x + 28;
  const row = (arrow: string, [other, ls]: [string, LinkDef[]]) => (
    <span key={`${arrow}${other}`} className="lm-hover-row">
      <LinkSwatch kind={ls[0].kind} />
      <span className="lm-hover-name">
        {arrow} {named.get(other)?.name}
      </span>
      {total(ls) > 0 && <span className="num">{total(ls)}×</span>}
    </span>
  );
  return (
    <div className="lm-hover" style={{ left, top: Math.max(0, y - 24), width: HOVER_WIDTH }} aria-hidden="true">
      <strong>{list.name}</strong>
      {meta && <span className="lm-hover-meta">{meta}</span>}
      {(ins.length > 0 || outs.length > 0) && (
        <span className="lm-hover-rows">
          {ins.slice(0, 3).map((e) => row("←", e))}
          {outs.slice(0, 3).map((e) => row("→", e))}
        </span>
      )}
      {views.length > 0 && <span className="lm-hover-meta">{views.map((v) => VIEWS[v].label).join(" · ")}</span>}
    </div>
  );
}

// ---------- het schema van één lijst (gsm) ----------

const W = 340; // breedte (het schema schaalt mee tot de breedte van de kaart)
const SIDE_X = 42;
const PER_SIDE = 4;
const STEP = 58;
const TOP = 34;
const STOPS = 6;

/** Een lijn die horizontaal vertrekt, in het midden haakt en horizontaal aankomt (met afgeronde bochten). */
function elbow(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(y1 - y2) < 1) return `M ${x1} ${y1} H ${x2}`;
  const mx = (x1 + x2) / 2;
  const dx = Math.sign(x2 - x1) || 1;
  const dy = Math.sign(y2 - y1);
  const r = Math.min(10, Math.abs(y2 - y1) / 2, Math.abs(mx - x1));
  return `M ${x1} ${y1} H ${mx - dx * r} Q ${mx} ${y1} ${mx} ${y1 + dy * r} V ${y2 - dy * r} Q ${mx} ${y2} ${mx + dx * r} ${y2} H ${x2}`;
}

/**
 * Het schema van één lijst of weergave (op gsm, waar de kaart te klein is): links waar iets vandaan komt, rechts waar
 * het naartoe gaat, in het midden de lijst zelf, met op elke lijn hoe vaak; de weergaven als haltes op een groene
 * stippellijn eronder. Rood gestreept als het voor iemand niet werkt. Een tik op een station kiest die lijst. Meer dan
 * vier aan een kant: de drie met het meeste, en hoeveel er nog zijn.
 */
export function LinkSchema({
  id,
  incoming,
  outgoing,
  views,
  problems,
  byId,
  onSelect,
}: {
  id: string;
  incoming: [string, LinkDef[]][];
  outgoing: [string, LinkDef[]][];
  views: ViewKey[];
  problems: LinkProblem[];
  byId: Map<string, ListNode>;
  onSelect: (id: string) => void;
}) {
  const side = (entries: [string, LinkDef[]][]) => {
    const sorted = [...entries].sort((a, b) => total(b[1]) - total(a[1]));
    return sorted.length > PER_SIDE
      ? {
          shown: sorted.slice(0, PER_SIDE - 1),
          more: sorted.length - (PER_SIDE - 1),
        }
      : { shown: sorted, more: 0 };
  };
  const left = side(incoming);
  const right = side(outgoing);
  const broken = new Set(problems.map((p) => `${p.list}|${p.to}`));
  const brokenEnd = new Set(problems.flatMap((p) => (p.list === id ? [p.to] : p.to === id ? [p.list] : [])));
  const rowsOf = (s: typeof left) => s.shown.length + (s.more ? 1 : 0);
  const rows = Math.max(1, rowsOf(left), rowsOf(right));
  const cx = W / 2;
  const cy = TOP + ((rows - 1) * STEP) / 2;
  const yOf = (i: number, n: number) => cy + (i - (n - 1) / 2) * STEP;
  const kinds = [...new Set([...incoming, ...outgoing].flatMap(([, ls]) => ls.map((l) => l.kind)))].sort((a, b) => (a === b ? 0 : a === "ref" ? -1 : 1));
  const lane = (k: LinkKind) => (Math.max(0, kinds.indexOf(k)) - (kinds.length - 1) / 2) * LANE;
  const half = 11 + ((kinds.length || 1) - 1) * (LANE / 2);
  const lowest = TOP + (rows - 1) * STEP + 34;
  const shownViews = views.length > STOPS ? views.slice(0, STOPS - 1) : views;
  const moreViews = views.length - shownViews.length;
  const stops = shownViews.length + (moreViews ? 1 : 0);
  const bus = lowest + 22;
  const height = stops ? bus + 46 : lowest + 6;
  const stopX = (i: number) => 16 + ((W - 32) * (i + 0.5)) / stops;
  // Een naam aan de rand schuift naar binnen in plaats van eraf te vallen.
  const stopLabel = (i: number, text: string) => {
    const x = stopX(i);
    const w = text.length * 6.2;
    return x - w / 2 < 2 ? { x: x - 6, anchor: "start" as const } : x + w / 2 > W - 2 ? { x: x + 6, anchor: "end" as const } : { x, anchor: "middle" as const };
  };
  const centerEnd = endOf(id, byId);

  const lines = (entries: typeof left, fromSide: boolean) =>
    entries.shown.flatMap(([other, ls], i) => {
      const y = yOf(i, rowsOf(entries));
      const x = fromSide ? SIDE_X : W - SIDE_X;
      return ls.map((l) => {
        const o = lane(l.kind);
        const d = fromSide ? elbow(x + 8, y + o, cx - 11, cy + o) : elbow(cx + 11, cy + o, x - 8, y + o);
        return <path key={`${other}${l.kind}`} d={d} className={`lm-line lm-track lm-${l.kind}${broken.has(`${l.from}|${l.to}`) ? " lm-problem" : ""}`} />;
      });
    });
  const counts = (entries: typeof left, fromSide: boolean) =>
    entries.shown.map(([other, ls], i) => {
      const n = total(ls);
      if (!n) return null;
      const y = yOf(i, rowsOf(entries)) + lane(ls[0].kind);
      const x = fromSide ? (SIDE_X + (SIDE_X + cx) / 2) / 2 + 4 : (W - SIDE_X + (W - SIDE_X + cx) / 2) / 2 - 4;
      const label = `${n}×`;
      const w = label.length * 7 + 10;
      return (
        <g key={`n${other}`} className="lm-count">
          <rect x={x - w / 2} y={y - 9} width={w} height={18} rx={9} />
          <text x={x} y={y + 4} textAnchor="middle">
            {label}
          </text>
        </g>
      );
    });
  const station = (other: string, ls: LinkDef[], x: number, y: number) => {
    const end = endOf(other, byId);
    if (!end) return null;
    const n = total(ls);
    const ring = brokenEnd.has(other) ? "lm-station lm-problem-ring" : new Set(ls.map((l) => l.kind)).size === 1 ? `lm-station lm-${ls[0].kind}` : "lm-station lm-mixed";
    return (
      <g
        key={other}
        className={`lm-node${end.tone ? ` tone-${end.tone}` : ""}`}
        role="button"
        tabIndex={0}
        aria-label={`${end.name}${n ? `, ${n}×` : ""}`}
        onClick={() => onSelect(other)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(other))}
      >
        <rect className="lm-hit" x={x - 40} y={y - 14} width={80} height={48} />
        <rect className={ring} x={x - 8} y={y - 8} width={16} height={16} rx={8} strokeWidth={3} />
        <text x={x} y={y + 26} textAnchor="middle" className="lm-name">
          {cut(end.name, 11)}
        </text>
      </g>
    );
  };
  const more = (x: number, y: number, n: number) => (
    <text key={`meer${x}`} x={x} y={y + 4} textAnchor="middle" className="lm-meta">
      +{n}
    </text>
  );

  return (
    <div className="lm-schema">
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="group" aria-label={`Schema van ${centerEnd?.name ?? ""}`}>
        {stops > 0 && (
          <>
            <path d={`M ${cx} ${cy + half} V ${bus}`} className="lm-line lm-view" />
            {stops > 1 && <path d={`M ${stopX(0)} ${bus} H ${stopX(stops - 1)}`} className="lm-line lm-view" />}
          </>
        )}
        {lines(left, true)}
        {lines(right, false)}
        {counts(left, true)}
        {counts(right, false)}
        {left.shown.map(([other, ls], i) => station(other, ls, SIDE_X, yOf(i, rowsOf(left))))}
        {left.more > 0 && more(SIDE_X, yOf(rowsOf(left) - 1, rowsOf(left)), left.more)}
        {right.shown.map(([other, ls], i) => station(other, ls, W - SIDE_X, yOf(i, rowsOf(right))))}
        {right.more > 0 && more(W - SIDE_X, yOf(rowsOf(right) - 1, rowsOf(right)), right.more)}

        <g className={`lm-node lm-center${centerEnd?.tone ? ` tone-${centerEnd.tone}` : ""}`}>
          <rect className="lm-halo on" x={cx - 19} y={cy - half - 8} width={38} height={2 * half + 16} rx={19} />
          <rect
            className={`lm-station ${kinds.length === 1 ? `lm-${kinds[0]}` : "lm-mixed"}`}
            x={cx - 11}
            y={cy - half}
            width={22}
            height={2 * half}
            rx={11}
            strokeWidth={5}
          />
          <text x={cx} y={cy - half - 14} textAnchor="middle" className="lm-name">
            {cut(centerEnd?.name ?? "", 18)}
          </text>
        </g>

        {shownViews.map((v, i) => (
          <g key={v} className="lm-stop">
            <circle cx={stopX(i)} cy={bus} r={5} />
            <text x={stopLabel(i, cut(VIEWS[v].label, 13)).x} y={bus + (i % 2 ? 36 : 22)} textAnchor={stopLabel(i, cut(VIEWS[v].label, 13)).anchor} className="lm-meta">
              {cut(VIEWS[v].label, 13)}
            </text>
          </g>
        ))}
        {moreViews > 0 && (
          <text x={stopX(stops - 1)} y={bus + 4} textAnchor="middle" className="lm-meta">
            +{moreViews}
          </text>
        )}
      </svg>
    </div>
  );
}
