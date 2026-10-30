import type { CSSProperties } from "react";
import { formatDuration, type FieldDef, type FieldType } from "../../shared/fields";
import { computeTotal, totalLabel, type Period, type TotalDef } from "../../shared/totals";
import type { ItemList, ItemTypeView } from "../../shared/types";
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

/**
 * De totalen van de lijst die openstaat (Kcal per dag, Uitgaven per maand), uit de items van dit project zoals jij
 * ze ziet. Elk totaal is een sectie in de zijkolom; op gsm staan ze boven de lijst.
 */
export function TotalsCards({ projectId, type, className }: { projectId: string; type: ItemTypeView; className?: string }) {
  const { data } = useApi<ItemList>(`/projects/${projectId}/items?type=${type.id}`);
  if (!data) return null;
  const names = new Map(data.people.map((p) => [p.id, p.name]));
  return (
    <>
      {type.totals.map((t) => (
        <TotalCard key={t.id} total={t} fields={type.fields} items={data.items} name={(key) => names.get(key) ?? key} className={className} />
      ))}
    </>
  );
}

function TotalCard({
  total: t,
  fields,
  items,
  name,
  className,
}: {
  total: TotalDef;
  fields: FieldDef[];
  items: ItemList["items"];
  name: (key: string) => string;
  className?: string;
}) {
  const r = computeTotal(t, fields, items, today());
  const unit = t.agg === "count" ? undefined : fields.find((f) => f.key === t.field)?.unit;
  // Optellen bij het verschijnen; een gewoon getal op een decimaal.
  const scale = r.result === "number" ? 10 : 1;
  const counted = useCountUp(Math.round((r.current ?? 0) * scale)) / scale;
  const current = r.current ?? 0;
  const goal = t.goal;
  // Per persoon toont de naam; per keuze de keuze zelf.
  const byType = fields.find((f) => f.key === t.by)?.type;
  const groupName = (key: string) => (byType === "person" || byType === "people" || byType === "share" ? name(key) : key);

  let goalText = "";
  let state = "";
  if (goal !== undefined) {
    const rest = goal - current;
    if (t.goal_kind === "min") {
      state = rest <= 0 ? "done" : "";
      goalText = rest <= 0 ? `Doel van ${show(goal, r.result, unit)} gehaald` : `Nog ${show(rest, r.result, unit)} tot ${show(goal, r.result, unit)}`;
    } else {
      state = rest < 0 ? "over" : "";
      goalText = rest < 0 ? `${show(-rest, r.result, unit)} boven ${show(goal, r.result, unit)}` : `Nog ${show(rest, r.result, unit)} tot ${show(goal, r.result, unit)}`;
    }
  }
  const history = t.period === "all" ? [] : r.periods;
  const top = Math.max(goal ?? 0, ...history.map((p) => p.value ?? 0));

  return (
    <section className={className ? `card total-card ${className}` : "card total-card"}>
      <CardHead title={totalLabel(t, fields)} description={NOW[t.period]} />
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
        {history.length > 1 && top > 0 && (
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
                <span>{groupName(g.key)}</span>
                <span className="total-group-value">{show(g.value, r.result, unit)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
