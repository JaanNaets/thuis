import type { CSSProperties, KeyboardEvent } from "react";
import { viewNode, VIEWS, type Link, type LinkKind, type ViewKey } from "../../shared/links";
import type { ListNode } from "../../shared/model";
import { listIcon, listTone } from "../lists";
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

export type MapColumn = { key: string; name: string; lists: ListNode[] };

const COL = 196; // breedte van een kolom
const PILL = 148; // breedte van een punt (de rest is ruimte voor de lijnen)
const ROW = 40;
const HEAD = 30;
const PAD = 8;
const H = 30; // hoogte van een punt

/** Hoeveel tekens van een naam passen in een punt (13px Geist). */
const fit = (name: string, room = 15) => (name.length > room ? `${name.slice(0, room - 1).trimEnd()}…` : name);

/**
 * De kaart van je verbanden (zie STIJLBOEK.md → Verbanden): een kolom per tag, rechts de weergaven. Elke lijst en
 * weergave is een wit vlakje; een verband is een lijn van de rechterkant van `from` naar de linkerkant van `to`, met een
 * pijltje, in de kleur en het patroon van zijn soort. Kies je een punt, dan blijven enkel zijn lijnen staan.
 */
export function LinkMap({
  columns,
  views,
  links,
  selected,
  onSelect,
}: {
  columns: MapColumn[];
  views: ViewKey[];
  links: Link[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const all: { key: string; name: string; nodes: { id: string; name: string; icon: IconName; tone: string | null }[] }[] = [
    ...columns.map((c) => ({ key: c.key, name: c.name, nodes: c.lists.map((l) => ({ id: l.id, name: l.name, icon: listIcon(l), tone: listTone(l) })) })),
    ...(views.length ? [{ key: "views", name: "Weergaven", nodes: views.map((v) => ({ id: viewNode(v), name: VIEWS[v].label, icon: VIEW_ICONS[v], tone: null })) }] : []),
  ];
  const pos = new Map<string, { x: number; y: number; col: number }>();
  all.forEach((c, ci) => c.nodes.forEach((n, ri) => pos.set(n.id, { x: PAD + ci * COL, y: HEAD + ri * ROW, col: ci })));
  const width = PAD * 2 + Math.max(1, all.length) * COL - (COL - PILL);
  const height = HEAD + Math.max(1, ...all.map((c) => c.nodes.length)) * ROW + PAD;

  const touches = (l: Link, id: string) => l.from === id || l.to === id;
  const near = new Set(selected ? links.filter((l) => touches(l, selected)).flatMap((l) => [l.from, l.to]) : []);
  const linked = new Set(links.flatMap((l) => [l.from, l.to]));

  /**
   * De lijn van een verband: altijd van de rechterkant van het punt links naar de linkerkant van het punt rechts (zo
   * kruist ze de kaart nooit achteruit); het pijltje staat aan de kant van `to`. In dezelfde kolom een boog langs rechts.
   */
  const path = (l: Link): { d: string; back: boolean } | null => {
    const a = pos.get(l.from);
    const b = pos.get(l.to);
    if (!a || !b) return null;
    if (a.col === b.col) {
      const y1 = a.y + H / 2;
      const y2 = b.y + H / 2;
      const x = a.x + PILL;
      const bend = 22 + Math.min(40, Math.abs(y2 - y1) / 6);
      return { d: `M ${x} ${y1} C ${x + bend} ${y1}, ${x + bend} ${y2}, ${x + 4} ${y2}`, back: false };
    }
    const back = a.col > b.col;
    const [left, right] = back ? [b, a] : [a, b];
    const y1 = left.y + H / 2;
    const y2 = right.y + H / 2;
    const x1 = left.x + PILL + (back ? 4 : 0);
    const x2 = right.x - (back ? 0 : 4);
    const dx = Math.max(30, Math.abs(x2 - x1) / 2);
    return { d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, back };
  };

  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(selected === id ? null : id);
    }
  };

  return (
    <div className="linkmap">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Kaart van je verbanden">
        <defs>
          {(["ref", "log", "view"] as LinkKind[]).map((k) => (
            <marker key={k} id={`lm-arrow-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 8 4 L 0 8 z" className={`lm-head lm-${k}`} />
            </marker>
          ))}
        </defs>
        {all.map((c, ci) => (
          <text key={c.key} x={PAD + ci * COL + 2} y={16} className="lm-column">
            {fit(c.name.toUpperCase(), 20)}
          </text>
        ))}
        <g className="lm-links">
          {links.map((l) => {
            const line = path(l);
            if (!line) return null;
            const on = !selected || touches(l, selected);
            const arrow = `url(#lm-arrow-${l.kind})`;
            return (
              <path
                key={`${l.kind}${l.from}${l.to}`}
                d={line.d}
                className={`lm-line lm-${l.kind}`}
                data-on={on}
                // Zonder keuze zijn de lijnen naar de weergaven stil, zodat de lijsten onder elkaar opvallen.
                data-quiet={!selected && l.kind === "view"}
                markerEnd={line.back ? undefined : arrow}
                markerStart={line.back ? arrow : undefined}
              />
            );
          })}
        </g>
        {all.flatMap((c) =>
          c.nodes.map((n) => {
            const p = pos.get(n.id)!;
            const dim = selected ? !near.has(n.id) : !linked.has(n.id);
            const count = links.filter((l) => touches(l, n.id)).length;
            return (
              <g
                key={n.id}
                className={`lm-node${n.tone ? ` tone-${n.tone}` : " lm-viewnode"}`}
                transform={`translate(${p.x} ${p.y})`}
                data-dim={dim}
                data-selected={selected === n.id}
                role="button"
                tabIndex={0}
                aria-pressed={selected === n.id}
                aria-label={`${n.name}: ${count === 1 ? "1 verband" : `${count} verbanden`}`}
                onClick={() => onSelect(selected === n.id ? null : n.id)}
                onKeyDown={(e) => onKey(e, n.id)}
                style={{ "--pill": `${PILL}px` } as CSSProperties}
              >
                <title>{n.name}</title>
                <rect width={PILL} height={H} rx={9} className="lm-pill" />
                <g transform="translate(9 7)" className="lm-icon">
                  <Icon name={n.icon} size={16} />
                </g>
                <text x={32} y={H / 2 + 4.5} className="lm-name">
                  {fit(n.name)}
                </text>
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}

/** De legende: per soort verband een stukje lijn in zijn kleur en patroon. */
export function LinkLegend({ kinds }: { kinds: { kind: LinkKind; label: string }[] }) {
  return (
    <ul className="lm-legend">
      {kinds.map((k) => (
        <li key={k.kind}>
          <svg width="28" height="8" aria-hidden="true">
            <path d="M 1 4 L 27 4" className={`lm-line lm-${k.kind}`} data-on="true" />
          </svg>
          {k.label}
        </li>
      ))}
    </ul>
  );
}
