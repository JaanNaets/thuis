import { AGGS, type Agg, NUMERIC, typeOf } from "../../shared/calc";
import { formatDuration, parseDuration, type FieldDef } from "../../shared/fields";
import { cleanTotals, GOAL_KINDS, GROUP_TYPES, MAX_TOTALS, renameTotals, totalLabel, type Period, type TotalDef } from "../../shared/totals";
import { centsToInput, parseEuro } from "../format";
import { Segmented } from "./Controls";
import { Icon } from "./Icon";

/** Een totaal terwijl je het instelt: sleutels van de velden in het formulier, het doel als tekst. */
export type TotalDraft = {
  id: string;
  label: string;
  agg: Agg;
  field: string;
  period: Period;
  date: string;
  by: string;
  goalText: string;
  goal_kind: "max" | "min";
};

const PERIOD_OPTIONS = [
  { value: "all" as const, label: "Alles" },
  { value: "day" as const, label: "Dag" },
  { value: "week" as const, label: "Week" },
  { value: "month" as const, label: "Maand" },
  { value: "year" as const, label: "Jaar" },
];

const countable = (f: FieldDef) => NUMERIC.includes(typeOf(f)!);

/** Een doel tonen zoals je het typt: een bedrag in euro, een duur als "1 u 30 min". */
function goalText(goal: number | undefined, def: FieldDef | undefined): string {
  if (goal === undefined) return "";
  const kind = typeOf(def);
  if (kind === "money") return centsToInput(goal);
  if (kind === "duration") return formatDuration(goal);
  return String(goal).replace(".", ",");
}

function parseGoal(text: string, def: FieldDef | undefined): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const kind = typeOf(def);
  if (kind === "money") return parseEuro(t) ?? undefined;
  if (kind === "duration") return parseDuration(t);
  return Number(t.replace(/\s/g, "").replace(",", "."));
}

export function totalsDraft(totals: TotalDef[], fields: FieldDef[]): TotalDraft[] {
  return totals.map((t) => ({
    id: t.id,
    label: t.label ?? "",
    agg: t.agg,
    field: t.field ?? "",
    period: t.period,
    date: t.date ?? "",
    by: t.by ?? "",
    goalText: goalText(t.goal, fields.find((f) => f.key === (t.agg === "count" ? undefined : t.field))),
    goal_kind: t.goal_kind ?? "max",
  }));
}

/**
 * Van wat er staat naar totalen voor de API. `fields`: de velden in het formulier met de uitkomst van hun
 * berekeningen (`previewCalcs`); `keyOf`: de sleutel die een veld na het bewaren heeft.
 */
export function buildTotals(
  drafts: TotalDraft[],
  fields: FieldDef[],
  keyOf: (draftKey: string) => string | undefined,
): { totals: TotalDef[] } | { error: string } {
  const raw: Record<string, unknown>[] = [];
  for (const [i, d] of drafts.entries()) {
    const def = d.agg === "count" ? undefined : fields.find((f) => f.key === d.field);
    const goal = parseGoal(d.goalText, def);
    if (goal !== undefined && !Number.isFinite(goal)) return { error: `${d.label.trim() || `Totaal ${i + 1}`}: het doel is geen getal.` };
    raw.push({
      id: d.id,
      label: d.label,
      agg: d.agg,
      field: d.agg === "count" ? undefined : d.field,
      period: d.period,
      date: d.period === "all" ? undefined : d.date,
      by: d.by || undefined,
      goal,
      goal_kind: d.goal_kind,
    });
  }
  try {
    return { totals: renameTotals(cleanTotals(raw, fields), keyOf) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * Totalen van een lijst: wat de app op het project samenvat (de kcal per dag, wat je per maand uitgaf), eventueel
 * apart per persoon of keuze en met een doel. `fields`: de velden in het formulier, met hun uitkomsten.
 */
export function TotalsEditor({ value, onChange, fields }: { value: TotalDraft[]; onChange: (v: TotalDraft[]) => void; fields: FieldDef[] }) {
  const numbers = fields.filter(countable);
  const dates = fields.filter((f) => typeOf(f) === "date");
  const groups = fields.filter((f) => GROUP_TYPES.includes(f.type));
  const update = (i: number, patch: Partial<TotalDraft>) => onChange(value.map((t, k) => (k === i ? { ...t, ...patch } : t)));

  const add = () => {
    const taken = new Set(value.map((t) => t.id));
    let id = "";
    do id = Math.random().toString(36).slice(2, 8);
    while (!/^[a-z0-9]+$/.test(id) || taken.has(id));
    onChange([
      ...value,
      {
        id,
        label: "",
        agg: numbers.length ? "sum" : "count",
        field: numbers[numbers.length - 1]?.key ?? "",
        period: dates.length ? "day" : "all",
        date: dates[0]?.key ?? "",
        by: "",
        goalText: "",
        goal_kind: "max",
      },
    ]);
  };

  return (
    <section className="card form-section">
      <div className="field">
        <span className="label">Totalen</span>
        <span className="hint">
          Bovenaan het project: bv. de kcal per dag met een doel, of wat je per maand uitgaf, eventueel per persoon. Telt enkel wat
          iemand mag zien.
        </span>
      </div>
      {value.length > 0 && (
        <ul className="fields-editor">
          {value.map((t, i) => {
            const def = fields.find((f) => f.key === t.field);
            const auto = totalLabel(
              { id: t.id, agg: t.agg, field: t.agg === "count" ? undefined : t.field, period: t.period, date: t.date },
              fields.map((f) => ({ ...f, label: f.label.trim() || "Naamloos veld" })),
            );
            return (
              <li key={t.id} className="fields-editor-row">
                <div className="fields-editor-main totals-editor-main">
                  <input
                    value={t.label}
                    maxLength={40}
                    placeholder={auto || "Naam van het totaal"}
                    aria-label="Naam van het totaal"
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    aria-label={`${t.label || auto || "Totaal"} weghalen`}
                    onClick={() => onChange(value.filter((_, k) => k !== i))}
                  >
                    <Icon name="close" size={15} />
                  </button>
                </div>
                <div className="totals-editor-more">
                  <div className="attr-fields">
                    <label className="field">
                      <span className="label">Wat</span>
                      <select value={t.agg} onChange={(e) => update(i, { agg: e.target.value as Agg })}>
                        {Object.entries(AGGS).map(([agg, label]) => (
                          <option key={agg} value={agg}>
                            {agg === "count" ? "Hoeveel items" : label.replace(/ \(.*\)$/, "")}
                          </option>
                        ))}
                      </select>
                    </label>
                    {t.agg !== "count" && (
                      <label className="field">
                        <span className="label">Van</span>
                        <select value={t.field} onChange={(e) => update(i, { field: e.target.value })}>
                          <option value="">{numbers.length ? "Kies een getal" : "Geen getal of bedrag"}</option>
                          {numbers.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label || "Nieuw veld"}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <div className="field">
                    <span className="label">Periode</span>
                    <Segmented label="Periode" value={t.period} onChange={(period) => update(i, { period })} options={PERIOD_OPTIONS} />
                  </div>
                  <div className="attr-fields">
                    {t.period !== "all" && (
                      <label className="field">
                        <span className="label">Volgens</span>
                        <select value={t.date} onChange={(e) => update(i, { date: e.target.value })}>
                          <option value="">{dates.length ? "Kies een datum" : "Geen datumveld"}</option>
                          {dates.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label || "Nieuw veld"}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="field">
                      <span className="label">
                        Apart per <span className="optional">· optioneel</span>
                      </span>
                      <select value={t.by} onChange={(e) => update(i, { by: e.target.value })}>
                        <option value="">Niet apart</option>
                        {groups.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label || "Nieuw veld"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="field">
                      <span className="label">
                        Doel <span className="optional">· optioneel</span>
                      </span>
                      <span className="goal-input">
                        <select
                          value={t.goal_kind}
                          aria-label="Soort doel"
                          onChange={(e) => update(i, { goal_kind: e.target.value as TotalDraft["goal_kind"] })}
                        >
                          {Object.entries(GOAL_KINDS).map(([kind, label]) => (
                            <option key={kind} value={kind}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <input
                          value={t.goalText}
                          inputMode={typeOf(def) === "duration" ? "text" : "decimal"}
                          placeholder={typeOf(def) === "money" ? "bv. 400" : typeOf(def) === "duration" ? "bv. 1u30" : "bv. 1800"}
                          aria-label="Doel"
                          onChange={(e) => update(i, { goalText: e.target.value })}
                        />
                      </span>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {value.length < MAX_TOTALS && (
        <button type="button" className="btn btn-outline btn-sm" style={{ justifySelf: "start" }} onClick={add}>
          <Icon name="plus" size={15} /> Totaal toevoegen
        </button>
      )}
    </section>
  );
}
