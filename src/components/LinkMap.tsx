// De verbanden van een project (zie shared/links.ts): als kaart (kolommen = projecten, punten = lijsten, lijnen =
// verbanden), als lijst, en wat één gekozen lijst binnenkrijgt en doorgeeft. De schikking komt uit `layoutLinks`;
// hier wordt ze enkel getekend.

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  AGENDA_NODE,
  BALANCE_NODE,
  LINK_KINDS,
  layoutLinks,
  OUTSIDE,
  type Link as LinkDef,
  type LinkKind,
  type LinkMap,
  type LinkNode,
  type LinkProblem,
} from "../../shared/links";
import { CardHead } from "./Controls";
import { Icon } from "./Icon";
import { Link } from "../router";

// Maten van de kaart (px, op ware grootte).
const SLOT = 128;
const PAD = 14;
const GAP = 12;
const FIRST = 92;
const ROW = 100;
const LANE = 7;
/** Kleiner dan dit schaalt de kaart niet: dan schuift ze binnen haar vlak. */
const MIN_SCALE = 0.72;

export const kindClass = (kind: LinkKind) => {
  const tone = LINK_KINDS[kind].tone;
  return tone ? `tone-${tone}` : kind === "tab" ? "lm-tab" : "lm-grey";
};

/** Waar een punt naartoe leidt: de lijst in haar project, Wie moet wie op het project, of de agenda. */
export function nodeHref(node: LinkNode): string {
  if (node.id === AGENDA_NODE) return "/agenda";
  if (node.id === BALANCE_NODE || !node.list_id) return `/projecten/${node.project_id}`;
  return `/projecten/${node.project_id}?lijst=${node.list_id}`;
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const countText = (n: number) => (n === 1 ? "1 item" : `${n} items`);

export function nodeMeta(node: LinkNode): string {
  if (node.column === OUTSIDE) return node.project_name;
  // Op de kaart van al je projecten: het subproject waar de lijst staat (niet nog eens de kolom zelf).
  if (node.count === null && node.project_id === node.column) return "";
  if (node.count !== null) return countText(node.count);
  return node.project_name;
}

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

export function LinkMapView({
  map,
  current,
  links: active,
  selected,
  onSelect,
  onColumn,
}: {
  map: LinkMap;
  /** Het project van deze kaart (de andere kolommen openen hun eigen kaart). */
  current: string;
  /** De verbanden die aanstaan (de filters). */
  links: LinkDef[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Een subproject openen (zijn eigen kaart). */
  onColumn: (projectId: string) => void;
}) {
  const [ref, available] = useWidth();
  const columnIds = [...map.columns.map((c) => c.id), OUTSIDE];
  const layout = layoutLinks(columnIds, map.nodes, active);
  const nodes = map.nodes.filter((n) => layout.places.has(n.id));
  const links = active.filter((l) => layout.places.has(l.from) && layout.places.has(l.to));
  /** Verbanden die voor iemand niet werken (rood gestreept). */
  const broken = new Set(map.problems.map((p) => `${p.from}|${p.to}`));

  // Kolommen naast elkaar (enkel die met punten), rijen onder elkaar (een rij met meer banen is wat hoger).
  const used = columnIds.filter((_, i) => nodes.some((n) => layout.places.get(n.id)!.col === i));
  const widths = layout.slots.map((s) => s * SLOT + 2 * PAD);
  const colX: number[] = [];
  let width = -GAP;
  for (const cid of used) {
    const i = columnIds.indexOf(cid);
    colX[i] = width + GAP;
    width += widths[i] + GAP;
  }
  width = Math.max(width, 1);
  const rowY = layout.rows.map((_, i) => FIRST + layout.rows.slice(0, i).reduce((a, r) => a + ROW + (r.kinds.length - 1) * LANE, 0));
  const lastRow = layout.rows.length - 1;
  const height = (rowY[lastRow] ?? FIRST) + Math.max(0, (layout.rows[lastRow]?.kinds.length ?? 1) - 1) * LANE + 64;
  const scale = available ? Math.max(MIN_SCALE, Math.min(1, available / width)) : 1;

  const at = (id: string) => {
    const p = layout.places.get(id)!;
    return { x: colX[p.col] + PAD + p.slot * SLOT + SLOT / 2, y: rowY[p.row], row: p.row };
  };
  const laneOf = (l: LinkDef) => {
    const row = layout.places.get(l.to)!.row;
    return rowY[row] + Math.max(0, layout.rows[row].kinds.indexOf(l.kind)) * LANE;
  };
  const lit = selected ? new Set([selected, ...links.filter((l) => l.from === selected || l.to === selected).flatMap((l) => [l.from, l.to])]) : null;
  const isLit = (l: LinkDef) => !selected || l.from === selected || l.to === selected;

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
      <svg
        width={width * scale}
        height={height * scale}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label="Kaart van de verbanden"
        onClick={(e) => e.target === e.currentTarget && onSelect(null)}
      >
        {used.map((cid) => {
          const i = columnIds.indexOf(cid);
          const column = map.columns.find((c) => c.id === cid);
          const own = cid === OUTSIDE ? null : column;
          const label = cid === OUTSIDE ? "Elders" : cut(column?.name ?? "", Math.floor(widths[i] / 8));
          const open = own && cid !== current;
          return (
            <g key={cid} className={own ? `lm-column tone-${own.color ?? "sky"}` : "lm-column lm-outside"}>
              <rect x={colX[i]} y={0} width={widths[i]} height={height} rx={20} />
              {open ? (
                <text
                  x={colX[i] + widths[i] / 2}
                  y={28}
                  className="lm-column-name lm-column-link"
                  role="link"
                  tabIndex={0}
                  onClick={() => onColumn(cid)}
                  onKeyDown={(e) => e.key === "Enter" && onColumn(cid)}
                >
                  {label}
                  <title>Kaart van {column?.name}</title>
                </text>
              ) : (
                <text x={colX[i] + widths[i] / 2} y={28} className="lm-column-name">
                  {label}
                </text>
              )}
            </g>
          );
        })}

        {links.map((l) => (
          <path
            key={`${l.kind}-${l.from}-${l.to}`}
            d={path(l)}
            className={`lm-line ${kindClass(l.kind)} ${l.kind === "adjust" && broken.has(`${l.from}|${l.to}`) ? "lm-problem" : ""} ${isLit(l) ? "" : "lm-dim"}`}
          />
        ))}

        {nodes.map((n) => {
          const { x, y, row } = at(n.id);
          const lanes = layout.rows[row].kinds.length;
          const hub = links.some((l) => l.to === n.id);
          const s = hub ? 22 : 16;
          const kinds = kindsAt(n.id);
          const ring = kinds.size === 1 ? `lm-station ${kindClass([...kinds][0])}` : "lm-station lm-mixed";
          const bottom = y + s / 2 + (lanes - 1) * LANE;
          const rows = links.filter((l) => l.from === n.id).map((l) => layout.places.get(l.to)!.row);
          const down = rows.some((r) => r > row);
          const up = rows.some((r) => r < row);
          const meta = cut(nodeMeta(n), 18);
          // De naam staat onder het punt, boven als er een lijn naar beneden vertrekt, en opzij als er lijnen naar
          // boven én beneden gaan (aan de kant waar geen lijn op deze rij loopt).
          const sideways = (dir: 1 | -1) =>
            links.some(
              (l) =>
                // Wat hier toekomt, rijdt op deze rij; wat vertrekt, enkel als het doel op dezelfde rij staat.
                (l.to === n.id && Math.sign(at(l.from).x - x) === dir) ||
                (l.from === n.id && at(l.to).row === row && Math.sign(at(l.to).x - x) === dir),
            );
          const place = down && up ? (!sideways(1) ? "right" : !sideways(-1) ? "left" : "below") : down ? "above" : "below";
          const tx = place === "right" ? x + s / 2 + 8 : place === "left" ? x - s / 2 - 8 : x;
          const ty = place === "right" || place === "left" ? y + 4 : place === "above" ? y - s / 2 - 24 : bottom + 18;
          const anchor = place === "right" ? "start" : place === "left" ? "end" : "middle";
          const on = selected === n.id;
          return (
            <g
              key={n.id}
              className={`lm-node ${lit && !lit.has(n.id) ? "lm-dim" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={`${n.name}, ${nodeMeta(n)}`}
              onClick={() => onSelect(on ? null : n.id)}
              onKeyDown={(e) => key(e, n.id)}
            >
              <rect className={`lm-halo ${on ? "on" : ""}`} x={x - s / 2 - 8} y={y - s / 2 - 8} width={s + 16} height={s + 16 + (lanes - 1) * LANE} rx={(s + 16) / 2} />
              <rect className={ring} x={x - s / 2} y={y - s / 2} width={s} height={s + (lanes - 1) * LANE} rx={s / 2} strokeWidth={hub ? 5 : 3} />
              <text x={tx} y={ty} textAnchor={anchor} className="lm-name">
                {cut(n.name, 16)}
                <title>{n.name}</title>
              </text>
              <text x={tx} y={ty + 15} textAnchor={anchor} className="lm-meta">
                {meta}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Wat een verband doet, in een zin per veld of totaal. */
const linkText = (l: LinkDef) => l.texts.join(" · ");

/** Eén gekozen lijst: wat erop inwerkt en waar ze op inwerkt, met een rij per andere lijst (al haar verbanden erin). */
export function LinkDetail({ map, node, links, onSelect }: { map: LinkMap; node: LinkNode; links: LinkDef[]; onSelect: (id: string) => void }) {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const group = (list: LinkDef[], end: "from" | "to") => {
    const out = new Map<string, LinkDef[]>();
    for (const l of list) out.set(l[end], [...(out.get(l[end]) ?? []), l]);
    return [...out].flatMap(([id, ls]) => (byId.has(id) ? [{ other: byId.get(id)!, links: ls }] : []));
  };
  const incoming = group(
    links.filter((l) => l.to === node.id),
    "from",
  );
  const outgoing = group(
    links.filter((l) => l.from === node.id),
    "to",
  );
  const row = ({ other, links: ls }: { other: LinkNode; links: LinkDef[] }) => (
    <li key={other.id}>
      <button type="button" className="row" onClick={() => onSelect(other.id)}>
        <span className="cell-main">
          <span className="lm-swatches" aria-hidden="true">
            {ls.map((l) => (
              <span key={l.kind} className={`lm-swatch ${kindClass(l.kind)}`} />
            ))}
          </span>
          <span className="row-main">
            <span className="row-title">{other.name}</span>
            <span className="row-meta">
              <span>{ls.map(linkText).join(" · ")}</span>
              {other.project_name !== node.project_name && <span>{other.project_name}</span>}
            </span>
          </span>
        </span>
        <Icon name="next" size={16} className="row-chevron" />
      </button>
    </li>
  );
  const open = node.id === AGENDA_NODE ? "Agenda openen" : node.id === BALANCE_NODE ? "Project openen" : "Lijst openen";
  return (
    <section className="card lm-detail">
      <CardHead
        title={node.name}
        description={[node.project_name, node.count !== null ? countText(node.count) : null].filter(Boolean).join(" · ")}
        action={
          <Link to={nodeHref(node)} className="btn btn-outline btn-sm">
            {open}
          </Link>
        }
      />
      <ul className="rows">
        {incoming.length > 0 && (
          <li className="group-row">
            Komt van <span className="group-count">{incoming.length}</span>
          </li>
        )}
        {incoming.map(row)}
        {outgoing.length > 0 && (
          <li className="group-row">
            Gaat naar <span className="group-count">{outgoing.length}</span>
          </li>
        )}
        {outgoing.map(row)}
      </ul>
    </section>
  );
}

/** Dezelfde verbanden als lijst: per project de lijsten, met hoeveel verbanden elk heeft. Op gsm de gewone weergave. */
export function LinkList({ map, links, onSelect }: { map: LinkMap; links: LinkDef[]; onSelect: (id: string) => void }) {
  const degree = new Map<string, number>();
  for (const l of links) for (const x of [l.from, l.to]) degree.set(x, (degree.get(x) ?? 0) + 1);
  const groups = [...map.columns.map((c) => ({ id: c.id, name: c.name, tone: c.color ?? "sky" })), { id: OUTSIDE, name: "Elders", tone: null }]
    .map((g) => ({ ...g, nodes: map.nodes.filter((n) => n.column === g.id && degree.has(n.id)) }))
    .filter((g) => g.nodes.length);
  return (
    <section className="card">
      <ul className="rows">
        {groups.map((g) => [
          <li key={g.id} className="group-row">
            <span className={`dot ${g.tone ? `tone-${g.tone}` : ""}`} /> {g.name} <span className="group-count">{g.nodes.length}</span>
          </li>,
          ...g.nodes.map((n) => (
            <li key={n.id}>
              <button type="button" className="row" onClick={() => onSelect(n.id)}>
                <span className="cell-main">
                  <span className="row-main">
                    <span className="row-title">{n.name}</span>
                    <span className="row-meta">
                      <span>{degree.get(n.id) === 1 ? "1 verband" : `${degree.get(n.id)} verbanden`}</span>
                      <span>{nodeMeta(n)}</span>
                    </span>
                  </span>
                </span>
                <Icon name="next" size={16} className="row-chevron" />
              </button>
            </li>
          )),
        ])}
      </ul>
    </section>
  );
}

/**
 * Verbanden die voor iemand niet werken (zie `adjustProblems`): per persoon wat er mis is, met een link naar waar je het
 * oplost (de rol in dat project, of de mensen als hij er niet in zit).
 */
export function LinkProblems({ map }: { map: LinkMap }) {
  if (!map.problems.length) return null;
  const listName = (id: string) => map.nodes.find((n) => n.list_id === id)?.name ?? "";
  const fix = (p: LinkProblem) => (p.role ? `/projecten/${p.role.project_id}/rollen/${p.role.id}` : `/projecten/${p.project.id}/instellingen?tab=mensen`);
  return (
    <section className="card lm-problems">
      <CardHead title="Werkt niet voor iedereen" />
      <ul className="rows">
        {map.problems.map((p) => (
          <li key={`${p.from}|${p.to}|${p.person}`}>
            <Link to={fix(p)} className="row">
              <span className="cell-main">
                <span className="row-media lm-problem-icon">
                  <Icon name="alert" size={16} />
                </span>
                <span className="row-main">
                  <span className="row-title">
                    {p.role ? `${p.person} mag ${p.field} van ${listName(p.to)} niet wijzigen` : `${p.person} zit niet in ${p.project.name}`}
                  </span>
                  <span className="row-meta">
                    <span>
                      {listName(p.from)} → {listName(p.to)}
                    </span>
                    <span>{p.role ? `${p.role.name} in ${p.project.name}` : `${p.field} van ${listName(p.to)}`}</span>
                  </span>
                </span>
              </span>
              <Icon name="next" size={16} className="row-chevron" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
