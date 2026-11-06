// Grafieken (zie shared/charts.ts en STIJLBOEK.md → Grafieken): Staafjes, Lijn, Getal, Per keuze en Verdeling, getekend
// uit wat de API uitrekende (nooit de items zelf). Rustig: dunne staafjes (hoogstens 24px, 4px rond aan de top), een lijn
// van 2px, haarfijne rasterlijnen, één reeks in grijs met de periode van nu in het zwart; meer reeksen elk hun vaste
// kleur (--chart-1 … 8, in vaste volgorde), met een legende. Elke periode of keuze heeft een tooltip (ook met het
// toetsenbord), en elke grafiek kan als tabel.

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { CHART_AGGS, type ChartData, type ChartUnit } from "../../shared/charts";
import { formatDuration } from "../../shared/fields";
import { formatCents, formatTotal } from "../format";

const PLOT_H = 168;
const AXIS_H = 22;
const LEFT = 46;
const RIGHT = 8;
const TOP = 14;

/** Een waarde zoals ze er staat (€ 12,30 · 1.050 kcal · 1 u 30 min · 12). */
export function formatChartValue(unit: ChartUnit, v: number | null): string {
  if (v === null) return "—";
  switch (unit.kind) {
    case "money":
      return formatCents(Math.round(v));
    case "duration":
      return formatDuration(Math.round(v));
    case "score":
      return formatTotal(Math.round(v * 10) / 10);
    case "number":
      return `${formatTotal(v)}${unit.unit ? ` ${unit.unit}` : ""}`;
    case "count":
      return formatTotal(v);
  }
}

/** Kort op een as (€ 1.200, 12k, 3 u). */
function formatTick(unit: ChartUnit, v: number): string {
  const compact = (n: number) => (Math.abs(n) >= 10000 ? `${formatTotal(Math.round(n / 1000))}k` : formatTotal(n));
  if (unit.kind === "money") return `€ ${compact(Math.round(v / 100))}`;
  if (unit.kind === "duration") return v >= 120 ? `${formatTotal(Math.round(v / 6) / 10)} u` : `${Math.round(v)} min`;
  return compact(v);
}

/** Mooie ronde stappen voor de as (0, 500, 1.000 …). */
function niceMax(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + step / 2; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return { top, ticks };
}

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const seriesColor = (slot: number | null) => (slot === null ? "var(--chart-other)" : `var(--chart-${slot + 1})`);

/** De legende (vanaf twee reeksen): een staafje of streepje in de kleur, de naam in gewone tekst. */
function Legend({ series, line }: { series: ChartData["series"]; line: boolean }) {
  if (series.length < 2) return null;
  return (
    <ul className="chart-legend">
      {series.map((s) => (
        <li key={s.key}>
          <span className={line ? "chart-key is-line" : "chart-key"} style={{ background: seriesColor(s.slot) }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Eén tooltip voor alle reeksen in een periode: de waarde vooraan (vet), de reeks erachter. */
function Tip({ x, width, title, rows, unit }: { x: number; width: number; title: string; rows: { label: string; slot: number | null; value: number | null }[]; unit: ChartUnit }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(140);
  useLayoutEffect(() => setW(ref.current?.offsetWidth ?? 140), [title, rows.length]);
  const left = Math.max(0, Math.min(width - w, x - w / 2));
  return (
    <div ref={ref} className="chart-tip" style={{ left }} role="status">
      <p className="chart-tip-title">{title}</p>
      {rows.map((r, i) => (
        <p key={i} className="chart-tip-row">
          {rows.length > 1 && <span className="chart-key is-line" style={{ background: seriesColor(r.slot) }} />}
          <strong>{formatChartValue(unit, r.value)}</strong>
          {rows.length > 1 && <span>{r.label}</span>}
        </p>
      ))}
    </div>
  );
}

/** Staafjes en Lijn: de periodes op de as. */
function TimeChart({ data, area: filled = false }: { data: ChartData; area?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const line = data.form === "line";
  const n = data.buckets.length;
  const plotW = Math.max(0, width - LEFT - RIGHT);
  const band = n ? plotW / n : 0;
  const single = data.series.length === 1;
  // Opgestapeld (staafjes): positief naar boven, negatief naar onder.
  const sums = data.buckets.map((_, b) => {
    let pos = 0;
    let neg = 0;
    for (const s of data.series) {
      const v = s.values[b] ?? 0;
      if (line) {
        pos = Math.max(pos, v);
        neg = Math.min(neg, v);
      } else if (v >= 0) pos += v;
      else neg += v;
    }
    return { pos, neg };
  });
  const maxV = Math.max(0, ...sums.map((s) => s.pos), data.goal ?? 0);
  const minV = Math.min(0, ...sums.map((s) => s.neg));
  const { top, ticks } = niceMax(Math.max(maxV, -minV));
  const lo = minV < 0 ? -top : 0;
  const y = (v: number) => TOP + ((top - v) / (top - lo)) * PLOT_H;
  const x = (b: number) => LEFT + band * b + band / 2;
  const barW = Math.max(3, Math.min(24, band * 0.62));
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 46))));
  // Eén reeks: de periode van nu zwart, de vorige grijs; in een vaste periode (verslag) alle zwart.
  const color = (slot: number | null, b: number) => (single ? (data.current === null || b === data.current ? "var(--primary)" : "var(--chart-muted)") : seriesColor(slot));

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    setActive((a) => Math.max(0, Math.min(n - 1, (a ?? n - 1) + (e.key === "ArrowRight" ? 1 : -1))));
  };

  const bars: ReactNode[] = [];
  if (!line)
    data.buckets.forEach((_, b) => {
      let up = 0;
      let down = 0;
      const stack = data.series.map((s) => ({ s, v: s.values[b] ?? 0 })).filter((r) => r.v !== 0);
      stack.forEach(({ s, v }, i) => {
        const from = v >= 0 ? up : down;
        const to = from + v;
        if (v >= 0) up = to;
        else down = to;
        const last = v >= 0 ? !stack.slice(i + 1).some((r) => r.v > 0) : !stack.slice(i + 1).some((r) => r.v < 0);
        const y1 = y(Math.max(from, to));
        const y2 = y(Math.min(from, to));
        // 2px witte ruimte tussen gestapelde stukken; enkel het buitenste stuk krijgt een ronde top.
        const gap = i > 0 && ((v >= 0 && from > 0) || (v < 0 && from < 0)) ? 2 : 0;
        const h = Math.max(1, y2 - y1 - gap);
        const top = v >= 0 ? y1 : y1 + gap;
        const r = last ? Math.min(4, h, barW / 2) : 0;
        const xl = x(b) - barW / 2;
        const d =
          v >= 0
            ? `M${xl},${top + h} V${top + r} Q${xl},${top} ${xl + r},${top} H${xl + barW - r} Q${xl + barW},${top} ${xl + barW},${top + r} V${top + h} Z`
            : `M${xl},${top} V${top + h - r} Q${xl},${top + h} ${xl + r},${top + h} H${xl + barW - r} Q${xl + barW},${top + h} ${xl + barW},${top + h - r} V${top} Z`;
        bars.push(<path key={`${b}-${s.key}`} d={d} fill={color(s.slot, b)} className={active === b ? "is-active" : undefined} />);
      });
    });

  const lines = line
    ? data.series.map((s) => {
        // Een lijn met gaten waar niets is (bij een som of gemiddelde zonder items).
        const parts: string[] = [];
        let cur = "";
        s.values.forEach((v, b) => {
          if (v === null) {
            if (cur) parts.push(cur);
            cur = "";
          } else cur += `${cur ? "L" : "M"}${x(b)},${y(v)}`;
        });
        if (cur) parts.push(cur);
        const stroke = single ? "var(--primary)" : seriesColor(s.slot);
        const lastIdx = s.values.reduce<number>((acc, v, b) => (v !== null ? b : acc), -1);
        const area = (single || filled) && parts.length === 1 && lastIdx > 0 ? `${parts[0]} L${x(lastIdx)},${y(0)} L${x(s.values.findIndex((v) => v !== null))},${y(0)} Z` : null;
        return (
          <g key={s.key}>
            {area && <path d={area} fill={filled ? stroke : "var(--primary)"} opacity={filled ? (single ? 0.16 : 0.12) : 0.06} />}
            {parts.map((d, i) => (
              <path key={i} d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {lastIdx >= 0 && <circle cx={x(lastIdx)} cy={y(s.values[lastIdx]!)} r={4} fill={stroke} stroke="var(--background)" strokeWidth={2} />}
            {active !== null && s.values[active] !== null && <circle cx={x(active)} cy={y(s.values[active]!)} r={4} fill={stroke} stroke="var(--background)" strokeWidth={2} />}
          </g>
        );
      })
    : null;

  // Eén waarde bij de periode van nu (of de laatste): niet bij elke staaf een getal.
  const labelAt = data.current ?? n - 1;
  const labelValue = single ? data.series[0].values[labelAt] : null;

  return (
    <div className="chart" ref={ref}>
      <Legend series={data.series} line={line} />
      {width > 0 && (
        <svg
          width={width}
          height={TOP + PLOT_H + AXIS_H}
          role="img"
          aria-label={`${CHART_AGGS[data.agg]}, ${data.window}`}
          tabIndex={0}
          onKeyDown={onKey}
          onFocus={() => setActive((a) => a ?? data.current ?? n - 1)}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={LEFT} x2={width - RIGHT} y1={y(t)} y2={y(t)} className={t === 0 ? "chart-base" : "chart-grid"} />
              <text x={LEFT - 6} y={y(t)} dy="0.32em" textAnchor="end" className="chart-tick">
                {formatTick(data.unit, t)}
              </text>
            </g>
          ))}
          {lo < 0 && <line x1={LEFT} x2={width - RIGHT} y1={y(lo)} y2={y(lo)} className="chart-grid" />}
          {data.goal !== undefined && (
            <g>
              <line x1={LEFT} x2={width - RIGHT} y1={y(data.goal)} y2={y(data.goal)} className="chart-goal" />
              <text x={width - RIGHT} y={y(data.goal) - 5} textAnchor="end" className="chart-tick">
                Doel {formatChartValue(data.unit, data.goal)}
              </text>
            </g>
          )}
          {active !== null && line && <line x1={x(active)} x2={x(active)} y1={TOP} y2={TOP + PLOT_H} className="chart-cross" />}
          {bars}
          {lines}
          {labelValue !== null && labelValue !== undefined && !line && (
            <text x={x(labelAt)} y={y(Math.max(0, labelValue)) - 6} textAnchor="middle" className="chart-label">
              {formatChartValue(data.unit, labelValue)}
            </text>
          )}
          {data.buckets.map((bk, b) =>
            b % every === (n - 1) % every ? (
              <text key={bk.key} x={x(b)} y={TOP + PLOT_H + 15} textAnchor="middle" className="chart-tick">
                {bk.label}
              </text>
            ) : null,
          )}
          {/* Het raakvlak per periode: zo breed als de periode, groter dan het staafje. */}
          {data.buckets.map((bk, b) => (
            <rect key={bk.key} x={LEFT + band * b} y={TOP} width={band} height={PLOT_H} fill="transparent" onPointerEnter={() => setActive(b)} onPointerDown={() => setActive(b)} />
          ))}
        </svg>
      )}
      {active !== null && (
        <Tip
          x={x(active)}
          width={width}
          title={data.buckets[active].long}
          unit={data.unit}
          rows={data.series.map((s) => ({ label: s.label, slot: s.slot, value: s.values[active] }))}
        />
      )}
    </div>
  );
}

/** Per keuze: een staafje per keuze, de grootste eerst, de waarde aan het eind. */
function RankedChart({ data }: { data: ChartData }) {
  const values = data.series[0]?.values ?? [];
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  return (
    <ul className="chart-ranked">
      {data.buckets.map((b, i) => (
        <li key={b.key} tabIndex={0} aria-label={`${b.label}: ${formatChartValue(data.unit, values[i])}`}>
          <span className="chart-ranked-label">{b.label}</span>
          <span className="chart-ranked-track">
            <span className="chart-ranked-bar" style={{ "--w": `${max ? Math.max(1, ((values[i] ?? 0) / max) * 100) : 0}%` } as CSSProperties} />
          </span>
          <span className="chart-ranked-value">{formatChartValue(data.unit, values[i])}</span>
        </li>
      ))}
    </ul>
  );
}

/** Verdeling: één geheel in stukken (hoogstens zes), het aandeel erin als het past, de namen in de legende. */
function PartsChart({ data }: { data: ChartData }) {
  const values = (data.series[0]?.values ?? []).map((v) => Math.max(0, v ?? 0));
  const sum = values.reduce((a, b) => a + b, 0);
  const [active, setActive] = useState<number | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  if (!sum) return null;
  return (
    <div className="chart" ref={ref}>
      <div className="chart-parts" onPointerLeave={() => setActive(null)}>
        {data.buckets.map((b, i) => {
          const share = values[i] / sum;
          if (!values[i]) return null;
          const pct = `${Math.round(share * 100)}%`;
          const fits = share * width > pct.length * 8 + 14;
          return (
            <span
              key={b.key}
              className="chart-part"
              tabIndex={0}
              aria-label={`${b.label}: ${formatChartValue(data.unit, values[i])}, ${pct}`}
              style={{ flexGrow: values[i], background: seriesColor(b.slot ?? null) }}
              data-ink={b.slot === 3 ? "dark" : "light"}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              {fits && pct}
            </span>
          );
        })}
      </div>
      <ul className="chart-legend">
        {data.buckets.map((b, i) =>
          values[i] ? (
            <li key={b.key}>
              <span className="chart-key" style={{ background: seriesColor(b.slot ?? null) }} />
              {b.label}
            </li>
          ) : null,
        )}
      </ul>
      {active !== null && (
        <Tip
          x={(values.slice(0, active).reduce((a, b) => a + b, 0) / sum) * width + ((values[active] / sum) * width) / 2}
          width={width}
          title={data.buckets[active].label}
          unit={data.unit}
          rows={[{ label: data.buckets[active].label, slot: data.buckets[active].slot ?? null, value: values[active] }]}
        />
      )}
    </div>
  );
}

/** Getal: de uitkomst groot, tegenover de periode ervoor, met een kleine lijn per periode en een doelbalk. */
function NumberChart({ data }: { data: ChartData }) {
  const value = data.total;
  const delta = value !== null && data.previous !== null && data.previous !== 0 ? (value - data.previous) / Math.abs(data.previous) : null;
  const spark = data.series[0]?.values ?? [];
  const max = Math.max(0, ...spark.map((v) => v ?? 0));
  const pts = spark.map((v, i) => (v === null ? null : [spark.length > 1 ? (i / (spark.length - 1)) * 100 : 50, 28 - (max ? (v / max) * 24 : 0)] as const));
  const path = pts.reduce((acc, p) => (p ? `${acc}${acc ? "L" : "M"}${p[0]},${p[1]}` : acc), "");
  const goal = data.goal;
  return (
    <div className="chart-number">
      <p className="chart-number-value">
        {formatChartValue(data.unit, value)}
        {goal !== undefined && goal > 0 && <span className="chart-number-goal"> / {formatChartValue(data.unit, goal)}</span>}
      </p>
      {delta !== null && (
        <p className="chart-number-delta">
          {delta >= 0 ? "+" : "−"}
          {formatTotal(Math.abs(Math.round(delta * 100)))}% tegenover de periode ervoor
        </p>
      )}
      {goal !== undefined && goal > 0 && value !== null && (
        <div className="chart-meter" role="meter" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={value} aria-label={`Doel ${formatChartValue(data.unit, goal)}`}>
          <span style={{ "--w": `${Math.min(100, (value / goal) * 100)}%` } as CSSProperties} data-over={value > goal || undefined} />
        </div>
      )}
      {path && spark.length > 2 && (
        <svg className="chart-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
          <path d={path} fill="none" stroke="var(--chart-muted)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

/** De grafiek als tabel (elke waarde, zonder kleur of tooltip). */
export function ChartTable({ data }: { data: ChartData }) {
  if (data.form === "number")
    return (
      <table className="chart-table">
        <tbody>
          <tr>
            <th scope="row">{data.window}</th>
            <td>{formatChartValue(data.unit, data.total)}</td>
          </tr>
          {data.previous !== null && (
            <tr>
              <th scope="row">De periode ervoor</th>
              <td>{formatChartValue(data.unit, data.previous)}</td>
            </tr>
          )}
        </tbody>
      </table>
    );
  return (
    <div className="chart-table-wrap">
      <table className="chart-table">
        <thead>
          <tr>
            <th scope="col" />
            {data.series.map((s) => (
              <th key={s.key} scope="col">
                {data.series.length > 1 ? s.label : CHART_AGGS[data.agg]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.buckets.map((b, i) => (
            <tr key={b.key}>
              <th scope="row">{b.long}</th>
              {data.series.map((s) => (
                <td key={s.key}>{formatChartValue(data.unit, s.values[i])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Een grafiek, in de vorm die ze kreeg. Leeg (niets in deze periode): een rustige zin. */
export function ChartView({ data, table = false, area = false }: { data: ChartData; table?: boolean; area?: boolean }) {
  const empty =
    data.form === "number"
      ? data.total === null
      : data.series.every((s) => s.values.every((v) => v === null || v === 0)) || !data.buckets.length;
  if (table) return <ChartTable data={data} />;
  if (empty && data.form !== "number") return <p className="chart-empty">Niets in deze periode</p>;
  switch (data.form) {
    case "number":
      return <NumberChart data={data} />;
    case "ranked":
      return <RankedChart data={data} />;
    case "parts":
      return <PartsChart data={data} />;
    default:
      return <TimeChart data={data} area={area} />;
  }
}
