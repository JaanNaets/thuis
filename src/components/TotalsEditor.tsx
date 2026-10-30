import { AGGS, type Agg, NUMERIC, typeOf } from "../../shared/calc";
import { formatDuration, parseDuration, type FieldDef } from "../../shared/fields";
import type { Person } from "../../shared/types";
import {
  cleanTotals,
  GOAL_KINDS,
  GROUP_TYPES,
  MAX_SOURCES,
  MAX_TOTALS,
  renameTotals,
  SETTLE_TYPES,
  sourceMisfit,
  totalLabel,
  type Period,
  type TotalDef,
} from "../../shared/totals";
import { centsToInput, parseEuro } from "../format";
import { Segmented, Switch } from "./Controls";
import { Icon } from "./Icon";

/** Een lijst uit een ander project (voor "ook uit"). */
export type OtherList = { id: string; plural: string; project_name: string; fields: FieldDef[] };

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
  scope: "project" | "tree";
  sources: string[];
  against: string;
  settle: boolean;
  /** Enkel van jou: een persoonveld (bv. Wie); leeg = iedereen. */
  mine: string;
  /** Een eigen doel per persoon (id → tekst), bij "enkel van jou". */
  goalsText: Record<string, string>;
  small: boolean;
  line: boolean;
};

const SCOPE_OPTIONS = [
  { value: "project" as const, label: "Dit project" },
  { value: "tree" as const, label: "Met subprojecten" },
];

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
    scope: t.scope ?? "project",
    sources: t.sources ?? [],
    against: t.against ?? "",
    settle: Boolean(t.settle),
    mine: t.mine ?? "",
    goalsText: Object.fromEntries(
      Object.entries(t.goals ?? {}).map(([id, g]) => [id, goalText(g, fields.find((f) => f.key === (t.agg === "count" ? undefined : t.field)))]),
    ),
    small: t.size === "small",
    line: t.chart === "line",
  }));
}

/** Van een ontwerp naar een totaal (met de sleutels in het formulier), zonder het na te kijken. */
function rawTotal(d: TotalDraft, goal?: number, goals?: Record<string, number>): Record<string, unknown> {
  const sum = d.agg === "sum" && Boolean(d.by);
  return {
    id: d.id,
    label: d.label,
    agg: d.agg,
    field: d.agg === "count" ? undefined : d.field,
    period: d.period,
    date: d.period === "all" ? undefined : d.date,
    by: d.by || undefined,
    against: sum ? d.against || undefined : undefined,
    settle: sum && Boolean(d.against) && d.settle,
    scope: d.scope,
    sources: d.sources,
    goal,
    goal_kind: d.goal_kind,
    mine: d.mine || undefined,
    goals: d.mine ? goals : undefined,
    size: d.small ? "small" : undefined,
    chart: d.line && d.period !== "all" ? "line" : undefined,
  };
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
    const name = d.label.trim() || `Totaal ${i + 1}`;
    const goal = parseGoal(d.goalText, def);
    if (goal !== undefined && !Number.isFinite(goal)) return { error: `${name}: het doel is geen getal.` };
    const goals: Record<string, number> = {};
    for (const [id, text] of Object.entries(d.goalsText)) {
      const g = parseGoal(text, def);
      if (g === undefined) continue;
      if (!Number.isFinite(g)) return { error: `${name}: een doel per persoon is geen getal.` };
      goals[id] = g;
    }
    raw.push(rawTotal(d, goal, goals));
  }
  try {
    return { totals: renameTotals(cleanTotals(raw, fields), keyOf) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * Totalen van een lijst: wat de app op het project samenvat (de kcal per dag, wat je per maand uitgaf), eventueel
 * apart per persoon of keuze, met een doel, met de subprojecten of ook uit lijsten in andere projecten. Een saldo
 * (betaald door tegenover de verdeling) kan verrekenen: dat is Wie moet wie. `fields`: de velden in het formulier,
 * met hun uitkomsten; `others`: de andere lijsten die je mag zien.
 */
export function TotalsEditor({
  value,
  onChange,
  fields,
  others,
  people,
}: {
  value: TotalDraft[];
  onChange: (v: TotalDraft[]) => void;
  fields: FieldDef[];
  others: OtherList[];
  /** Wie in het project zit (voor een doel per persoon). */
  people: Person[];
}) {
  const persons = fields.filter((f) => f.type === "person");
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
        scope: "project",
        sources: [],
        against: "",
        settle: false,
        mine: "",
        goalsText: {},
        small: false,
        line: false,
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
            const draft = rawTotal(t) as TotalDef;
            const auto = totalLabel(
              { ...draft, label: undefined },
              fields.map((f) => ({ ...f, label: f.label.trim() || "Naamloos veld" })),
            );
            // Lijsten met dezelfde velden (op sleutel) die mee kunnen tellen.
            const fitting = others.filter((l) => t.sources.includes(l.id) || !sourceMisfit(draft, fields, l.fields));
            const canNet = t.agg === "sum" && Boolean(t.by);
            const settleable =
              canNet &&
              Boolean(t.against) &&
              def?.type === "money" &&
              SETTLE_TYPES.includes(fields.find((f) => f.key === t.by)?.type ?? "text") &&
              SETTLE_TYPES.includes(fields.find((f) => f.key === t.against)?.type ?? "text");
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
                  {!t.settle && (
                    <div className="field">
                      <span className="label">Periode</span>
                      <Segmented label="Periode" value={t.period} onChange={(period) => update(i, { period })} options={PERIOD_OPTIONS} />
                    </div>
                  )}
                  {!t.settle && (
                    <div className="field">
                      <span className="label">Waar</span>
                      <Segmented label="Waar" value={t.scope} onChange={(scope) => update(i, { scope })} options={SCOPE_OPTIONS} />
                    </div>
                  )}
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
                    {canNet && (
                      <label className="field">
                        <span className="label">
                          Tegenover <span className="optional">· optioneel</span>
                        </span>
                        <select value={t.against} onChange={(e) => update(i, { against: e.target.value, settle: e.target.value ? t.settle : false })}>
                          <option value="">Niets</option>
                          {groups
                            .filter((f) => f.key !== t.by)
                            .map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.label || "Nieuw veld"}
                              </option>
                            ))}
                        </select>
                        <span className="hint">Een saldo: per persoon wat bij Apart per staat, min wat hier staat (betaald door − verdeling).</span>
                      </label>
                    )}
                    {!t.settle && (
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
                    )}
                    {!t.settle && persons.length > 0 && (
                      <label className="field">
                        <span className="label">Van wie</span>
                        <select value={t.mine} onChange={(e) => update(i, { mine: e.target.value })}>
                          <option value="">Iedereen samen</option>
                          {persons.map((f) => (
                            <option key={f.key} value={f.key}>
                              Enkel van jou (volgens {f.label || "dit veld"})
                            </option>
                          ))}
                        </select>
                        <span className="hint">Enkel van jou: elk ziet zijn eigen totaal, met zijn eigen doel.</span>
                      </label>
                    )}
                  </div>
                  {!t.settle && t.mine && people.length > 0 && (
                    <div className="field">
                      <span className="label">
                        Doel per persoon <span className="optional">· leeg = het doel hierboven</span>
                      </span>
                      <div className="goal-people">
                        {people.map((p) => (
                          <label key={p.id} className="goal-person">
                            <span>{p.name}</span>
                            <input
                              value={t.goalsText[p.id] ?? ""}
                              inputMode={typeOf(def) === "duration" ? "text" : "decimal"}
                              placeholder={t.goalText || "—"}
                              aria-label={`Doel van ${p.name}`}
                              onChange={(e) => update(i, { goalsText: { ...t.goalsText, [p.id]: e.target.value } })}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {!t.settle && <Switch checked={t.small} onChange={(small) => update(i, { small })} label="Klein, naast andere" hint="Bv. eiwit, koolhydraten en vet onder de kcal." />}
                  {!t.settle && t.period !== "all" && (
                    <Switch checked={t.line} onChange={(line) => update(i, { line })} label="Als lijn" hint="De vorige periodes als lijn in plaats van staafjes (bv. je gewicht)." />
                  )}
                  {settleable && (
                    <Switch
                      checked={t.settle}
                      onChange={(on) => update(i, { settle: on, ...(on ? { period: "all" as const, scope: "tree" as const, goalText: "" } : {}) })}
                      label="Verrekenen: Wie moet wie"
                      hint="Op het project: zo weinig mogelijk overschrijvingen, met de subprojecten en de andere lijsten die verrekenen."
                    />
                  )}
                  {fitting.length > 0 && (
                    <div className="field">
                      <span className="label">
                        Ook uit <span className="optional">· lijsten met dezelfde velden</span>
                      </span>
                      <div className="tag-picker">
                        {fitting.map((l) => {
                          const on = t.sources.includes(l.id);
                          return (
                            <button
                              key={l.id}
                              type="button"
                              className="tag"
                              aria-pressed={on}
                              disabled={!on && t.sources.length >= MAX_SOURCES}
                              onClick={() => update(i, { sources: on ? t.sources.filter((x) => x !== l.id) : [...t.sources, l.id] })}
                            >
                              {on && <Icon name="check" size={13} />} {l.plural} · {l.project_name}
                            </button>
                          );
                        })}
                      </div>
                      <span className="hint">Telt ook hun items mee, voor wie die mag zien.</span>
                    </div>
                  )}
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
