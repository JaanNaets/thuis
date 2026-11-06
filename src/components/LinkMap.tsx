// De verbanden (zie shared/links.ts): als metrokaart (kolommen = tags, stations = lijsten, sporen = verbanden tussen
// lijsten, de weergaven als kleine iconen bij elk station), als lijst, en wat één gekozen lijst of weergave binnenkrijgt
// en doorgeeft. De schikking komt uit `layoutLinks`; hier wordt ze enkel getekend.

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { AGENDA_NOTE, betweenLists, layoutLinks, viewOf, viewsOf, VIEWS, type Link as LinkDef, type LinkKind, type LinkProblem, type LinksResponse, type ViewKey } from "../../shared/links";
import { ROLES, type ListNode } from "../../shared/model";
import { listIcon, listTone } from "../lists";
import { Link } from "../router";
import { CardHead } from "./Controls";
import { Icon, type IconName } from "./Icon";

/** Het icoon van een weergave (op de kaart en in de lijst). */
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

export type MapColumn = { key: string; name: string; tone: string | null; lists: ListNode[] };

// Maten van de kaart (px, op ware grootte).
const SLOT = 132;
const PAD = 14;
const GAP = 12;
const FIRST = 112;
const ROW = 112;
const LANE = 7;
const ICON = 12;
const ICON_STEP = 16;
/** Kleiner dan dit schaalt de kaart niet: dan schuift ze binnen haar vlak. */
const MIN_SCALE = 0.72;

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const plural = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;

/** Wat er bij een lijst staat: hoeveel dingen (of gebeurtenissen, voor een lijst zonder dingen). */
export function listMeta(list: ListNode, counts: LinksResponse["counts"]): string {
  const c = counts[list.id];
  if (!c) return "";
  return list.one ? plural(c.things, "ding", "dingen") : plural(c.events, "gebeurtenis", "gebeurtenissen");
}

/** Een stukje lijn in de kleur en het patroon van een soort verband (filters, rijen). */
export function LinkSwatch({ kind }: { kind: LinkKind }) {
  return (
    <svg width="18" height="6" aria-hidden="true" className="lm-swatch">
      <path d="M 1.5 3 L 16.5 3" className={`lm-line lm-${kind}`} />
    </svg>
  );
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

/**
 * De metrokaart. Elke lijst waar een verband in toekomt, krijgt een eigen rij; een lijn loopt verticaal bij de lijst
 * waar ze vertrekt en dan horizontaal naar haar doel, op een eigen baan per soort. Een verband dat voor iemand niet
 * werkt, is rood gestreept. Onder elke lijst de weergaven waar ze in voorkomt (als `views` aanstaat).
 */
export function LinkMapView({
  columns,
  links: active,
  views,
  counts,
  problems,
  selected,
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
  onSelect: (id: string | null) => void;
}) {
  const [ref, available] = useWidth();
  const columnIds = columns.map((c) => c.key);
  const nodes = columns.flatMap((c) => c.lists.map((l) => ({ id: l.id, column: c.key, list: l })));
  const between = betweenLists(active);
  const layout = layoutLinks(columnIds, nodes, between);
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
  const rowY = layout.rows.map((_, i) => FIRST + layout.rows.slice(0, i).reduce((a, r) => a + ROW + (r.kinds.length - 1) * LANE, 0));
  const lastRow = layout.rows.length - 1;
  const height = (rowY[lastRow] ?? FIRST) + Math.max(0, (layout.rows[lastRow]?.kinds.length ?? 1) - 1) * LANE + 80;
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
            key={`${l.kind}-${l.from}-${l.to}`}
            d={path(l)}
            className={`lm-line lm-track lm-${l.kind}${broken.has(`${l.from}|${l.to}`) ? " lm-problem" : ""}${isLit(l) ? "" : " lm-dim"}`}
          />
        ))}

        {shown.map((n) => {
          const { x, y, row } = at(n.id);
          const lanes = layout.rows[row].kinds.length;
          const hub = links.some((l) => l.to === n.id);
          const s = hub ? 22 : 16;
          const kinds = kindsAt(n.id);
          const ring = kinds.size === 1 ? `lm-station lm-${[...kinds][0]}` : "lm-station lm-mixed";
          const bottom = y + s / 2 + (lanes - 1) * LANE;
          const rows = links.filter((l) => l.from === n.id).map((l) => layout.places.get(l.to)!.row);
          const down = rows.some((r) => r > row);
          const up = rows.some((r) => r < row);
          const meta = cut(listMeta(n.list, counts), 18);
          const icons = views ? viewsOf(active, n.id) : [];
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
          const ty = place === "right" || place === "left" ? y + 4 : place === "above" ? y - s / 2 - 24 - (icons.length ? 18 : 0) : bottom + 18;
          const anchor = place === "right" ? "start" : place === "left" ? "end" : "middle";
          // De weergaven: een rij kleine iconen onder de naam.
          const shownIcons = icons.slice(0, Math.max(1, Math.floor((SLOT - 8) / ICON_STEP)));
          const iconsWidth = shownIcons.length * ICON_STEP - (ICON_STEP - ICON);
          const ix = anchor === "start" ? tx : anchor === "end" ? tx - iconsWidth : tx - iconsWidth / 2;
          const iy = ty + 22;
          const on = selected === n.id;
          return (
            <g
              key={n.id}
              className={`lm-node tone-${listTone(n.list)}${lit && !lit.has(n.id) ? " lm-dim" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={`${n.list.name}${meta ? `, ${meta}` : ""}${icons.length ? `, in ${icons.map((v) => VIEWS[v].label).join(", ")}` : ""}`}
              onClick={() => onSelect(on ? null : n.id)}
              onKeyDown={(e) => key(e, n.id)}
            >
              <rect className={`lm-halo${on ? " on" : ""}`} x={x - s / 2 - 8} y={y - s / 2 - 8} width={s + 16} height={s + 16 + (lanes - 1) * LANE} rx={(s + 16) / 2} />
              <rect className={ring} x={x - s / 2} y={y - s / 2} width={s} height={s + (lanes - 1) * LANE} rx={s / 2} strokeWidth={hub ? 5 : 3} />
              <text x={tx} y={ty} textAnchor={anchor} className="lm-name">
                {cut(n.list.name, 16)}
                <title>{n.list.name}</title>
              </text>
              <text x={tx} y={ty + 15} textAnchor={anchor} className="lm-meta">
                {meta}
              </text>
              {shownIcons.map((v, i) => (
                <g key={v} transform={`translate(${ix + i * ICON_STEP} ${iy})`} className="lm-view-icon">
                  <title>{VIEWS[v].label}</title>
                  <Icon name={VIEW_ICONS[v]} size={ICON} />
                </g>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Wat een verband doet, in een zin per veld, soort of rol. */
const linkText = (l: LinkDef) => l.texts.join(" · ");

type End = { id: string; name: string; icon: IconName; tone: string | null };

/** Eén rij per ander eind (een lijst of weergave), met al de verbanden ertussen. */
function EndRow({ end, links, onSelect }: { end: End; links: LinkDef[]; onSelect: (id: string) => void }) {
  const count = links.reduce((a, l) => (l.count === null ? a : a + l.count), 0);
  return (
    <li>
      <button type="button" className="row" onClick={() => onSelect(end.id)}>
        <span className="cell-main">
          <span className={`row-media${end.tone ? ` tone-${end.tone}` : ""}`}>
            <Icon name={end.icon} size={16} />
          </span>
          <span className="row-main">
            <span className="row-title lm-row-title">
              {end.name}
              <span className="lm-swatches">
                {[...new Set(links.map((l) => l.kind))].map((k) => (
                  <LinkSwatch key={k} kind={k} />
                ))}
              </span>
            </span>
            <span className="row-meta">
              <span>{links.map(linkText).join(" · ")}</span>
            </span>
          </span>
        </span>
        {count > 0 && <span className="row-end num">{count}×</span>}
        <Icon name="next" size={16} className="row-chevron" />
      </button>
    </li>
  );
}

/** Verbanden per ander eind. */
function byOther(links: LinkDef[], id: string): [string, LinkDef[]][] {
  const out = new Map<string, LinkDef[]>();
  for (const l of links) {
    const other = l.from === id ? l.to : l.from;
    out.set(other, [...(out.get(other) ?? []), l]);
  }
  return [...out];
}

/** Hoe een lijst of weergave heet en eruitziet in een rij. */
export function endOf(id: string, byId: Map<string, ListNode>): End | null {
  const view = viewOf(id);
  if (view) return { id, name: VIEWS[view].label, icon: VIEW_ICONS[view], tone: null };
  const list = byId.get(id);
  return list ? { id, name: list.name, icon: listIcon(list), tone: listTone(list) } : null;
}

/**
 * Eén gekozen lijst of weergave: wat erin toekomt en waar ze naartoe gaat (per ander eind één rij), de weergaven, wat
 * ze met haar eigen dingen doet en wie erbij is.
 */
export function LinkDetail({ id, data, links, byId, onSelect }: { id: string; data: LinksResponse; links: LinkDef[]; byId: Map<string, ListNode>; onSelect: (id: string) => void }) {
  const view = viewOf(id);
  const list = byId.get(id);
  const mine = links.filter((l) => l.from === id || l.to === id);
  const isView = (l: LinkDef) => viewOf(l.from === id ? l.to : l.from) !== null;
  const incoming = byOther(
    mine.filter((l) => l.to === id && !isView(l)),
    id,
  );
  const outgoing = byOther(
    mine.filter((l) => l.from === id && !isView(l)),
    id,
  );
  const views = byOther(mine.filter(isView), id);
  const own = list ? (data.own[id] ?? []) : [];
  const people = list ? (data.people[id] ?? []) : [];
  const to = view ? VIEWS[view].to : list ? `/lijsten/${list.id}` : null;

  const rows = (entries: [string, LinkDef[]][]) =>
    entries.flatMap(([other, ls]) => {
      const end = endOf(other, byId);
      return end ? [<EndRow key={other} end={end} links={ls} onSelect={onSelect} />] : [];
    });
  const head = (label: string, n: number) => (
    <li className="group-row">
      {label} <span className="group-count">{n}</span>
    </li>
  );
  const textRow = (icon: IconName, text: string, tone: string | null, title?: string) => (
    <li>
      <div className="row">
        <span className="cell-main">
          <span className={`row-media${tone ? ` tone-${tone}` : ""}`}>
            <Icon name={icon} size={16} />
          </span>
          <span className="row-main">
            {title && <span className="row-title">{title}</span>}
            <span className="row-meta">
              <span>{text}</span>
            </span>
          </span>
        </span>
      </div>
    </li>
  );

  return (
    <section className="card lm-detail">
      <CardHead
        title={view ? VIEWS[view].label : (list?.name ?? "")}
        description={list ? listMeta(list, data.counts) : undefined}
        action={
          to ? (
            <Link to={to} className="btn btn-outline btn-sm">
              Openen
            </Link>
          ) : undefined
        }
      />
      <ul className="rows">
        {incoming.length > 0 && head("Komt van", incoming.length)}
        {rows(incoming)}
        {outgoing.length > 0 && head("Gaat naar", outgoing.length)}
        {rows(outgoing)}
        {views.length > 0 && head("Weergaven", views.length)}
        {rows(views)}
        {view === "agenda" && textRow("calendar", AGENDA_NOTE, null, "Al je lijsten")}
        {own.length > 0 && head("In de lijst zelf", own.length)}
        {own.length > 0 && textRow("repeat", own.join(" · "), list ? listTone(list) : null)}
        {people.length > 0 && head("Wie", people.length)}
        {people.length > 0 &&
          textRow(
            "users",
            people.map((p) => `${p.name}, ${ROLES[p.role].label.toLowerCase()}${p.via ? ` via ${p.via}` : ""}`).join(" · "),
            null,
          )}
        {!mine.length && !own.length && view !== "agenda" && (
          <li>
            <div className="row">
              <span className="cell-main">
                <span className="row-title muted">Nog geen verbanden</span>
              </span>
            </div>
          </li>
        )}
      </ul>
    </section>
  );
}

/** Dezelfde verbanden als lijst: per tag de lijsten met hoeveel verbanden elk heeft, dan de weergaven. Op gsm de gewone weergave. */
export function LinkList({
  columns,
  links,
  counts,
  onSelect,
}: {
  columns: MapColumn[];
  links: LinkDef[];
  counts: LinksResponse["counts"];
  onSelect: (id: string) => void;
}) {
  const degree = new Map<string, number>();
  for (const l of links) for (const x of [l.from, l.to]) degree.set(x, (degree.get(x) ?? 0) + 1);
  const groups = columns.map((c) => ({ ...c, lists: c.lists.filter((l) => degree.has(l.id)) })).filter((g) => g.lists.length);
  const views = (Object.keys(VIEWS) as ViewKey[]).filter((v) => degree.has(`view:${v}`));
  const verbanden = (n: number) => plural(n, "verband", "verbanden");
  return (
    <section className="card">
      <ul className="rows">
        {groups.map((g) => [
          <li key={g.key} className="group-row">
            <span className={`dot${g.tone ? ` tone-${g.tone}` : ""}`} /> {g.name} <span className="group-count">{g.lists.length}</span>
          </li>,
          ...g.lists.map((l) => (
            <li key={l.id}>
              <button type="button" className="row" onClick={() => onSelect(l.id)}>
                <span className="cell-main">
                  <span className={`row-media tone-${listTone(l)}`}>
                    <Icon name={listIcon(l)} size={16} />
                  </span>
                  <span className="row-main">
                    <span className="row-title">{l.name}</span>
                    <span className="row-meta">
                      <span>{verbanden(degree.get(l.id)!)}</span>
                      <span>{listMeta(l, counts)}</span>
                    </span>
                  </span>
                </span>
                <Icon name="next" size={16} className="row-chevron" />
              </button>
            </li>
          )),
        ])}
        {views.length > 0 && (
          <li className="group-row">
            Weergaven <span className="group-count">{views.length}</span>
          </li>
        )}
        {views.map((v) => (
          <li key={v}>
            <button type="button" className="row" onClick={() => onSelect(`view:${v}`)}>
              <span className="cell-main">
                <span className="row-media">
                  <Icon name={VIEW_ICONS[v]} size={16} />
                </span>
                <span className="row-main">
                  <span className="row-title">{VIEWS[v].label}</span>
                  <span className="row-meta">
                    <span>{verbanden(degree.get(`view:${v}`)!)}</span>
                  </span>
                </span>
              </span>
              <Icon name="next" size={16} className="row-chevron" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Verbanden die voor iemand niet werken: wie in een lijst kan bewerken maar een lijst niet ziet waar die van afhangt,
 * met een link naar de mensen van de lijst die je beheert.
 */
export function LinkProblems({ problems, byId }: { problems: LinkProblem[]; byId: Map<string, ListNode> }) {
  if (!problems.length) return null;
  const name = (id: string) => byId.get(id)?.name ?? "";
  const fix = (p: LinkProblem) => `/lijsten/${byId.get(p.to)?.role === "beheerder" ? p.to : p.list}/instellingen?tab=mensen`;
  return (
    <section className="card lm-problems">
      <CardHead title="Werkt niet voor iedereen" />
      <ul className="rows">
        {problems.map((p) => (
          <li key={`${p.list}|${p.to}|${p.person}`}>
            <Link to={fix(p)} className="row">
              <span className="cell-main">
                <span className="row-media lm-problem-icon">
                  <Icon name="alert" size={16} />
                </span>
                <span className="row-main">
                  <span className="row-title">
                    {p.name} ziet {name(p.to)} niet
                  </span>
                  <span className="row-meta">
                    <span>
                      {name(p.list)} → {name(p.to)}
                    </span>
                    <span>kan in {name(p.list)} bewerken</span>
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
