import type { CSSProperties } from "react";
import { formatDuration, type FieldDef, type FieldType } from "../../shared/fields";
import { totalLabel, type Period, type TotalDef, type TotalResult } from "../../shared/totals";
import type { ItemTypeView } from "../../shared/types";
import { useApi } from "../api";
import { formatCents, formatTotal, today } from "../format";
import { CardHead } from "./Controls";
import { useCountUp } from "./Motion";

const NOW: Record<Period, string> = { all: "Alles samen", day: "Vandaag", week: "Deze week", month: "Deze maand", year: "Dit jaar" };
const BEFORE: Record<Period, string> = { all: "", day: "De laatste dagen", week: "De laatste weken", month: "De laatste maanden", year: "De laatste jaren" };
const weekday = new Intl.DateTimeFormat("nl-BE", { weekday: "short", timeZone: "UTC" });
const monthName = new Intl.DateTimeFormat("nl-BE", { month: "short", timeZone: "UTC" });

/** Hoe een periode onder haar staafje heet: "ma", "26/10", "okt", "2026". */
function periodName(period: Period, key: string): string {
  if (period === "day") return weekday.format(new Date(`${key}T00:00:00Z`)).replace(".", "");
  if (period === "week") return key.slice(8, 10).replace(/^0/, "") + "/" + key.slice(5, 7).replace(/^0/, "");
  if (period === "month") return monthName.format(new Date(`${key}-01T00:00:00Z`)).replace(".", "");
  return key;
}

function show(value: number, result: FieldType, unit?: string): string {
  if (result === "money") return formatCents(value);
  if (result === "duration") return formatDuration(Math.round(value));
  return unit ? `${formatTotal(value)} ${unit}` : formatTotal(value);
}

/** Totalen die een eigen kaart krijgen (een saldo dat verrekent, staat in Wie moet wie). */
export const shownTotals = (type: ItemTypeView) => type.totals.filter((t) => !t.settle);

/**
 * De totalen van de lijst die openstaat (Kcal per dag, Uitgaven per maand). De API rekent ze uit zoals jij de items
 * ziet: in dit project, eventueel met de subprojecten en lijsten uit andere projecten. Elk totaal is een sectie in de
 * zijkolom; op gsm staan ze boven de lijst.
 */
export function TotalsCards({ projectId, type, className }: { projectId: string; type: ItemTypeView; className?: string }) {
  const { data } = useApi<Shown[]>(`/projects/${projectId}/totals?type=${type.id}&today=${today()}`);
  if (!data) return null;
  const totals = data.map((d) => ({ ...d, total: shownTotals(type).find((x) => x.id === d.id) })).filter((d): d is Shown & { total: TotalDef } => Boolean(d.total));
  const small = totals.filter((d) => d.total.size === "small");
  return (
    <>
      {totals
        .filter((d) => d.total.size !== "small")
        .map((d) => (
          <TotalCard key={d.id} total={d.total} result={d.result} goal={d.goal} fields={type.fields} className={className} />
        ))}
      {small.length > 0 && (
        <section className={className ? `card ${className}` : "card"}>
          <div className="card-body total-tiles">
            {small.map((d) => (
              <TotalTile key={d.id} total={d.total} result={d.result} goal={d.goal} fields={type.fields} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** Wat de API per totaal geeft: de uitkomst, en het doel van wie kijkt. */
type Shown = { id: string; result: TotalResult; goal?: number };

/** Hoe ver je van je doel staat, in woorden, en of je erover bent (of het gehaald hebt). */
function goalState(t: TotalDef, goal: number, current: number, show: (v: number) => string) {
  const rest = goal - current;
  if (t.goal_kind === "min") return rest <= 0 ? { state: "done", text: `Doel van ${show(goal)} gehaald` } : { state: "", text: `Nog ${show(rest)} tot ${show(goal)}` };
  return rest < 0 ? { state: "over", text: `${show(-rest)} boven ${show(goal)}` } : { state: "", text: `Nog ${show(rest)} tot ${show(goal)}` };
}

/** Een klein totaal naast andere (bv. eiwit, koolhydraten en vet onder de kcal): naam, getal, en een balk naar het doel. */
function TotalTile({ total: t, result: r, goal, fields }: { total: TotalDef; result: TotalResult; goal?: number; fields: FieldDef[] }) {
  const unit = t.agg === "count" ? undefined : fields.find((f) => f.key === t.field)?.unit;
  const current = r.current ?? 0;
  const g = goal !== undefined ? goalState(t, goal, current, (v) => show(v, r.result, unit)) : null;
  return (
    <div className="total-tile" data-state={g?.state}>
      <span className="total-tile-label">{totalLabel(t, fields)}</span>
      <span className="total-tile-value">{r.current === undefined ? "—" : show(current, r.result, unit)}</span>
      {goal !== undefined && (
        <span className="total-bar" role="meter" aria-label={g!.text} aria-valuemin={0} aria-valuemax={goal} aria-valuenow={current} style={{ "--p": goal > 0 ? Math.min(1, current / goal) : 1 } as CSSProperties}>
          <i />
        </span>
      )}
    </div>
  );
}

function TotalCard({
  total: t,
  result: r,
  goal,
  fields,
  className,
}: {
  total: TotalDef;
  result: TotalResult;
  goal?: number;
  fields: FieldDef[];
  className?: string;
}) {
  const unit = t.agg === "count" ? undefined : fields.find((f) => f.key === t.field)?.unit;
  // Optellen bij het verschijnen; een gewoon getal op een decimaal.
  const scale = r.result === "number" ? 10 : 1;
  const counted = useCountUp(Math.round((r.current ?? 0) * scale)) / scale;
  const current = r.current ?? 0;
  // Bij een saldo: + krijgt nog, − moet nog.
  const signed = (v: number) => (!t.against ? show(v, r.result, unit) : v > 0 ? `+ ${show(v, r.result, unit)}` : `− ${show(-v, r.result, unit)}`);
  const where = [NOW[t.period], t.mine && "van jou", t.scope === "tree" && "met subprojecten", t.sources?.length && "ook uit andere projecten"]
    .filter(Boolean)
    .join(" · ");

  const { state, text: goalText } = goal !== undefined ? goalState(t, goal, current, (v) => show(v, r.result, unit)) : { state: "", text: "" };
  const history = t.period === "all" ? [] : r.periods;
  const top = Math.max(goal ?? 0, ...history.map((p) => p.value ?? 0));

  return (
    <section className={className ? `card total-card ${className}` : "card total-card"}>
      <CardHead title={totalLabel(t, fields)} description={where} />
      <div className="card-body total-body">
        <p className="total-value">{r.current === undefined ? "—" : show(counted, r.result, unit)}</p>
        {goal !== undefined && (
          <div className="total-goal" data-state={state}>
            <span
              className="total-bar"
              role="meter"
              aria-label={goalText}
              aria-valuemin={0}
              aria-valuemax={goal}
              aria-valuenow={current}
              style={{ "--p": goal > 0 ? Math.min(1, current / goal) : 1 } as CSSProperties}
            >
              <i />
            </span>
            <span className="hint">{goalText}</span>
          </div>
        )}
        {history.length > 1 && top > 0 && t.chart === "line" && <TotalLine total={t} periods={history} result={r.result} unit={unit} goal={goal} />}
        {history.length > 1 && top > 0 && t.chart !== "line" && (
          <ol
            className="total-history"
            aria-label={BEFORE[t.period]}
            style={(goal ? { "--goal": goal / top } : {}) as CSSProperties}
            data-goal={goal ? "true" : undefined}
          >
            {history.map((p, i) => (
              <li
                key={p.key}
                data-now={i === history.length - 1 || undefined}
                data-over={(goal !== undefined && t.goal_kind !== "min" && (p.value ?? 0) > goal) || undefined}
                aria-label={`${periodName(t.period, p.key)}: ${p.value === undefined ? "niets" : show(p.value, r.result, unit)}`}
                title={p.value === undefined ? undefined : show(p.value, r.result, unit)}
              >
                <span className="total-history-bar" style={{ "--h": (p.value ?? 0) / top, "--k": i } as CSSProperties} />
                <span className="total-history-label" aria-hidden="true">
                  {periodName(t.period, p.key)}
                </span>
              </li>
            ))}
          </ol>
        )}
        {r.groups.length > 0 && (
          <ul className="total-groups">
            {r.groups.slice(0, 6).map((g) => (
              <li key={g.key}>
                <span>{g.label ?? g.key}</span>
                <span className="total-group-value">{signed(g.value)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * De vorige periodes als lijn (bv. je gewicht per week): punten voor de periodes met een waarde, de laatste zwart,
 * het doel als stippellijn. De schaal gaat van net onder de kleinste tot net boven de grootste waarde.
 */
function TotalLine({ total: t, periods, result, unit, goal }: { total: TotalDef; periods: TotalResult["periods"]; result: FieldType; unit?: string; goal?: number }) {
  const known = periods.map((p, i) => ({ ...p, i })).filter((p) => p.value !== undefined) as { key: string; value: number; i: number }[];
  if (known.length < 2) return null;
  const values = [...known.map((p) => p.value), ...(goal !== undefined ? [goal] : [])];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
  const y = (v: number) => 56 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 52;
  const x = (i: number) => (periods.length === 1 ? 50 : (i / (periods.length - 1)) * 100);
  const last = known[known.length - 1];
  return (
    <figure className="total-line" aria-label={`${BEFORE[t.period]}: ${known.map((p) => `${periodName(t.period, p.key)} ${show(p.value, result, unit)}`).join(", ")}`}>
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
        {goal !== undefined && <line className="total-line-goal" x1="0" x2="100" y1={y(goal)} y2={y(goal)} />}
        <polyline points={known.map((p) => `${x(p.i)},${y(p.value)}`).join(" ")} />
      </svg>
      {known.map((p) => (
        <span key={p.key} className="total-line-dot" data-now={p === last || undefined} style={{ left: `${x(p.i)}%`, top: `${(y(p.value) / 60) * 84}px` } as CSSProperties} />
      ))}
      <figcaption className="total-line-labels" aria-hidden="true">
        {periods.map((p, i) => (
          <span key={p.key} data-now={i === periods.length - 1 || undefined}>
            {periodName(t.period, p.key)}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
