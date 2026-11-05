// Een grafiek en een tekst als blok op je overzicht (zie shared/overview.ts en shared/charts.ts). Het blok haalt zijn
// uitkomsten op met jouw rechten (GET /projects/:id/chart); kan de grafiek niet (meer) met wat je ziet, dan blijft ze
// weg. `ChartBuilder`: de grafiek zelf samenstellen, met een voorbeeld dat meteen meekijkt.

import { useState } from "react";
import {
  byChoice,
  CHART_AGGS,
  CHART_FORMS,
  CHART_STEPS,
  isDateField,
  isGroupField,
  isNumberField,
  overTime,
  type BoardPeriod,
  type ChartData,
  type ChartDef,
  type ChartForm,
  type ChartStep,
} from "../../shared/charts";
import type { FieldDef } from "../../shared/fields";
import type { Block } from "../../shared/overview";
import type { ItemTypeView, OverviewType } from "../../shared/types";
import type { SavedView } from "../../shared/views";
import { useApi } from "../api";
import { centsToInput, parseEuro } from "../format";
import { ChartView } from "./Chart";
import { CardHead, Switch } from "./Controls";
import { Icon } from "./Icon";

const chartPath = (project: string, list: string, def: ChartDef, period?: BoardPeriod | null) =>
  `/projects/${project}/chart?list=${list}&def=${encodeURIComponent(JSON.stringify(def))}${period ? `&periode=${period}` : ""}`;

/** De naam van een grafiek zonder eigen titel: de lijst, en wat ze telt (Uitgaven · Bedrag). */
export function chartTitle(def: ChartDef, list: { plural: string } | undefined, fields: FieldDef[] = []): string {
  const field = def.field ? fields.find((f) => f.key === def.field)?.label : undefined;
  return [list?.plural ?? "Grafiek", def.agg === "count" ? "Aantal" : field && (def.agg === "sum" ? field : `${CHART_AGGS[def.agg]} ${field.toLowerCase()}`)].filter(Boolean).join(" · ");
}

/** Een grafiekblok: titel, de periode als gegeven, tabel of grafiek. Tijdens het herladen blijft de vorige staan. */
export function ChartBlock({ block, type, period }: { block: Extract<Block, { kind: "chart" }>; type?: OverviewType; period?: BoardPeriod | null }) {
  const { data, error, loading } = useApi<ChartData>(chartPath(block.project, block.list, block.chart, period));
  const [table, setTable] = useState(false);
  if (error || (!data && !loading)) return null;
  return (
    <section className="card dash-card chart-card" aria-busy={loading || undefined}>
      <CardHead
        title={block.title ?? chartTitle(block.chart, type)}
        description={data?.window}
        action={
          data && (
            <button type="button" className="btn btn-ghost btn-icon btn-sm chart-toggle" aria-pressed={table} aria-label={table ? "Als grafiek" : "Als tabel"} title={table ? "Als grafiek" : "Als tabel"} onClick={() => setTable(!table)}>
              <Icon name="table" size={15} />
            </button>
          )
        }
      />
      <div className={`card-body${loading && data ? " is-stale" : ""}`}>{data ? <ChartView data={data} table={table} /> : <div className="chart-placeholder" />}</div>
    </section>
  );
}

/** Een tekstblok: een titel en wat tekst (bv. bovenaan een verslag). */
export function TextBlock({ block }: { block: Extract<Block, { kind: "text" }> }) {
  return (
    <section className="card dash-card text-card">
      {block.title && <CardHead title={block.title} />}
      {block.text && (
        <div className="card-body">
          {block.text.split(/\n{2,}/).map((p, i) => (
            <p key={i} className="text-card-p">
              {p}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

/** Een nieuwe grafiek: wat het eerst kan (een getal als er een is), helemaal aan te passen. */
export function newChart(fields: FieldDef[]): ChartDef {
  const value = fields.find(isNumberField);
  const date = fields.find(isDateField);
  return { form: "bars", agg: value ? "sum" : "count", ...(value ? { field: value.key } : {}), date: date?.key ?? "created", step: "week", count: 12 };
}

/**
 * De grafiek samenstellen: als wat, wat ze telt, volgens welke datum, per welke periode en hoeveel, apart per een
 * keuze, een weergave als filter, met subprojecten, een doel en een titel. Eronder een voorbeeld dat meekijkt.
 */
export function ChartBuilder({
  project,
  type,
  value,
  onChange,
  title,
  onTitle,
}: {
  project: string;
  type: ItemTypeView;
  value: ChartDef;
  onChange: (d: ChartDef) => void;
  title: string;
  onTitle: (t: string) => void;
}) {
  const fields = type.fields.filter((f) => type.field_access[f.key] !== "none");
  const numbers = fields.filter(isNumberField);
  const dates = fields.filter(isDateField);
  const groups = fields.filter(isGroupField);
  const { data: views } = useApi<SavedView[]>(`/projects/${project}/views?type=${type.id}`);
  const { data: preview, error } = useApi<ChartData>(chartPath(project, type.id, value));
  const set = (patch: Partial<ChartDef>) => onChange({ ...value, ...patch });
  const goalField = numbers.find((f) => f.key === value.field);
  const money = value.agg !== "count" && (goalField?.type === "money" || (goalField?.type === "calc" && goalField.result === "money"));
  const [goalText, setGoalText] = useState(value.goal === undefined ? "" : money ? centsToInput(value.goal) : String(value.goal).replace(".", ","));

  const form = value.form;
  return (
    <div className="form chart-builder">
      <label className="field">
        <span className="label">Als</span>
        <select
          value={form}
          onChange={(e) => {
            const next = e.target.value as ChartForm;
            set({
              form: next,
              ...(byChoice(next) && !value.by ? { by: groups[0]?.key ?? "tags" } : {}),
              ...(next === "number" ? { by: undefined, count: value.count || 1 } : {}),
              ...(overTime(next) && value.count === 1 ? { count: 12 } : {}),
            });
          }}
        >
          {Object.entries(CHART_FORMS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <div className="field-row">
        <label className="field">
          <span className="label">Wat</span>
          <select value={value.agg} onChange={(e) => set(e.target.value === "count" ? { agg: "count", field: undefined } : { agg: e.target.value as ChartDef["agg"], field: value.field ?? numbers[0]?.key })}>
            {Object.entries(CHART_AGGS)
              .filter(([k]) => k === "count" || numbers.length)
              .map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        {value.agg !== "count" && (
          <label className="field">
            <span className="label">Van</span>
            <select value={value.field ?? ""} onChange={(e) => set({ field: e.target.value })}>
              {numbers.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {byChoice(form) && (
        <label className="field">
          <span className="label">Per</span>
          <select value={value.by ?? ""} onChange={(e) => set({ by: e.target.value })}>
            {groups.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
            <option value="tags">Tags</option>
          </select>
        </label>
      )}

      <div className="field-row">
        <label className="field">
          <span className="label">Volgens</span>
          <select value={value.date} onChange={(e) => set({ date: e.target.value })}>
            {dates.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
            <option value="created">Toegevoegd op</option>
          </select>
        </label>
        <label className="field">
          <span className="label">{overTime(form) ? "Per" : "Periode"}</span>
          <select value={value.step} onChange={(e) => set({ step: e.target.value as ChartStep })}>
            {Object.entries(CHART_STEPS).map(([k, s]) => (
              <option key={k} value={k}>
                {overTime(form) ? s.per : `In ${s.many}`}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Laatste</span>
          <input
            inputMode="numeric"
            value={value.count ? String(value.count) : ""}
            placeholder="Alles"
            aria-label={`Hoeveel ${CHART_STEPS[value.step].many}`}
            onChange={(e) => {
              const n = Math.max(0, Math.min(366, Number(e.target.value.replace(/\D/g, "")) || 0));
              set({ count: overTime(form) && n === 1 ? 2 : n });
            }}
          />
        </label>
      </div>

      {overTime(form) && (
        <label className="field">
          <span className="label">Apart per</span>
          <select value={value.by ?? ""} onChange={(e) => set({ by: e.target.value || undefined })}>
            <option value="">Niets</option>
            {groups.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
            <option value="tags">Tags</option>
          </select>
        </label>
      )}

      {(views?.length ?? 0) > 0 && (
        <label className="field">
          <span className="label">Weergave</span>
          <select value={value.view ?? ""} onChange={(e) => set({ view: e.target.value || undefined })}>
            <option value="">Alles</option>
            {views!.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {(overTime(form) || form === "number") && (
        <label className="field">
          <span className="label">Doel</span>
          <input
            inputMode="decimal"
            value={goalText}
            placeholder={money ? "€ 0,00" : "Geen"}
            onChange={(e) => {
              setGoalText(e.target.value);
              const t = e.target.value.trim();
              const n = !t ? undefined : money ? (parseEuro(t) ?? undefined) : Number(t.replace(",", "."));
              set({ goal: n === undefined || Number.isNaN(n) ? undefined : n });
            }}
          />
        </label>
      )}

      <Switch checked={Boolean(value.sub)} onChange={(on) => set({ sub: on || undefined })} label="Met subprojecten" />

      <label className="field">
        <span className="label">Titel</span>
        <input value={title} maxLength={60} placeholder={chartTitle(value, type, fields)} onChange={(e) => onTitle(e.target.value)} />
      </label>

      <div className="chart-preview" aria-live="polite">
        {preview ? <ChartView data={preview} /> : error ? <p className="chart-empty">{error}</p> : <div className="chart-placeholder" />}
      </div>
    </div>
  );
}

/** Een tekstblok samenstellen. */
export function TextBuilder({ title, text, onChange }: { title: string; text: string; onChange: (t: { title: string; text: string }) => void }) {
  return (
    <div className="form">
      <label className="field">
        <span className="label">Titel</span>
        <input value={title} maxLength={80} placeholder="bv. Skireis 2027" onChange={(e) => onChange({ title: e.target.value, text })} />
      </label>
      <label className="field">
        <span className="label">Tekst</span>
        <textarea value={text} maxLength={2000} rows={4} onChange={(e) => onChange({ title, text: e.target.value })} />
      </label>
    </div>
  );
}
