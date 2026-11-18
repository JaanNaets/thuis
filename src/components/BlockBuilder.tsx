// De bouwer van het overzicht (zie STIJLBOEK.md → Overzicht en shared/blocks.ts). Een weergave stel je samen in stappen:
// de lijsten (en wat: de items, het logboek, …), de voorwaarden (aantikbare stukken: "waar soort is Gegeten"), de
// kolommen met wat ermee gebeurt (som, gemiddelde, van–tot, een formule; groeperen en sorteren, ViewColumns) en tonen
// als, met de regels op wat je ziet; rechts (op gsm erboven) kijkt een voorbeeld live mee. Een actie kies je als lijst, soort, wat een tik doet en wat vooraf ingevuld is. Elke keuze is een gewone
// keuzelijst van het toestel onder een stukje tekst (zoals een filterpil), zodat het op gsm en met het toetsenbord werkt.

import { useEffect, useState, type ReactNode } from "react";
import {
  ACTION_DOES,
  canPlan,
  counts,
  DEFAULT_LIMIT,
  overTime,
  perChoice,
  RESULT_OPS,
  ROW_EFFECTS,
  SHOW_ORDER,
  SHOWS,
  sourceDate,
  SOURCES,
  viewName,
  type ActionBlock,
  type ActionDoes,
  type ResultOp,
  type RowEffect,
  type Rule,
  type RuleTone,
  type Show,
  type SourceKind,
  type Tally,
  type ViewBlock,
  type ViewResponse,
} from "../../shared/blocks";
import { actionForm } from "../../shared/blocks";
import type { ListColumns } from "../../shared/cells";
import { CHART_STEPS, isGroupField, type ChartStep } from "../../shared/charts";
import type { FieldDef, FieldValue } from "../../shared/fields";
import type { Targets } from "../../shared/targets";
import { COUNTED, kindOfKey, NAME, OPS, OPS_FOR, PERIOD_UNITS, PERIODS, WEEKDAYS, type Condition, type Op, type Period, type PeriodKind, type PeriodUnit } from "../../shared/views";
import { useApi } from "../api";
import { useSession } from "../session";
import { ActionTile } from "./ActionBlock";
import { CardHead, Switch } from "./Controls";
import { FormPicker } from "./FormPicker";
import { Icon, type IconName } from "./Icon";
import { ViewBody, viewUrl } from "./ViewBlock";
import { ViewColumns } from "./ViewColumns";
import { colFields, type ViewCol } from "../../shared/viewcols";

// ---------- stukjes van de zin ----------

type Option<T extends string> = { value: T; label: string };

/** Een stuk van de zin: de keuze als tekst, met de keuzelijst van het toestel eronder. */
function Tok<T extends string>({ label, value, options, onChange, placeholder }: { label: string; value: T | ""; options: Option<T>[]; onChange: (v: T) => void; placeholder?: string }) {
  const current = options.find((o) => o.value === value)?.label;
  return (
    <label className={`tok${current ? "" : " tok-empty"}`}>
      <span className="tok-text">{current ?? placeholder ?? "…"}</span>
      <Icon name="down" size={13} />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {!current && <option value="">{placeholder ?? "Kies…"}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Iets toevoegen aan de zin ("+ en …", "+ lijst"): een stille keuze. */
function TokAdd<T extends string>({ label, text, options, onPick }: { label: string; text: string; options: Option<T>[]; onPick: (v: T) => void }) {
  if (!options.length) return null;
  return (
    <label className="tok tok-add">
      <Icon name="plus" size={13} />
      <span className="tok-text">{text}</span>
      <select aria-label={label} value="" onChange={(e) => e.target.value && onPick(e.target.value as T)}>
        <option value="">{text}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TokInput({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: "text" | "number"; placeholder?: string }) {
  return (
    <input
      className="tok tok-input"
      aria-label={label}
      type="text"
      inputMode={type === "number" ? "decimal" : undefined}
      value={value}
      placeholder={placeholder}
      size={Math.max(3, (value || placeholder || "").length + 1)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function TokRemove({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="tok-x" aria-label={label} onClick={onClick}>
      <Icon name="close" size={13} />
    </button>
  );
}

/** Een chip met een kruisje (een gekozen lijst, een gekozen waarde). */
function TokChip({ text, label, onRemove }: { text: string; label: string; onRemove: () => void }) {
  return (
    <span className="tok tok-chip">
      <span className="tok-text">{text}</span>
      <TokRemove label={label} onClick={onRemove} />
    </span>
  );
}

const num = (s: string) => {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const show = (n: number | undefined) => (n === undefined ? "" : String(n).replace(".", ","));

// ---------- een voorwaarde ----------

type Choices = { people: { id: string; name: string }[]; items: Record<string, string>; me: string };

/** Een standaardwaarde bij een vergelijking. */
function startValue(op: Op): unknown {
  switch (OPS[op].value) {
    case "text":
      return "";
    case "number":
      return 0;
    case "between":
      return [0, 0];
    case "period":
      return { p: "this_week" };
    case "options":
      return [];
    case "week":
      return 1;
    case "weekdays":
      return [1];
    default:
      return undefined;
  }
}

/** De keuzes bij "is een van": de opties van een keuzeveld, personen (jij eerst) of items. */
function optionsFor(def: FieldDef, choices: Choices): Option<string>[] {
  if (def.type === "select" || def.type === "multi") return (def.options ?? []).map((o) => ({ value: o, label: o }));
  if (def.type === "person" || def.type === "people" || def.type === "share") return [{ value: "me", label: "Ik" }, ...choices.people.filter((p) => p.id !== choices.me).map((p) => ({ value: p.id, label: p.name }))];
  return Object.entries(choices.items)
    .map(([id, name]) => ({ value: id, label: name }))
    .sort((a, b) => a.label.localeCompare(b.label, "nl"));
}

function ConditionLine({ cond, fields, choices, prefix, onChange, onRemove }: { cond: Condition; fields: FieldDef[]; choices: Choices; prefix: ReactNode; onChange: (c: Condition) => void; onRemove: () => void }) {
  const def = fields.find((f) => f.key === cond.field);
  const ops = def ? OPS_FOR[kindOfKey(cond.field, def)] : [];
  const shape = OPS[cond.op]?.value ?? "none";
  const money = def?.type === "money";
  const value = cond.value;
  const setValue = (v: unknown) => onChange({ ...cond, value: v });
  let editor: ReactNode = null;
  if (def && shape === "text") editor = <TokInput label="Waarde" value={String(value ?? "")} placeholder="…" onChange={setValue} />;
  if (def && shape === "number")
    editor = <TokInput label="Getal" type="number" value={show(typeof value === "number" ? (money ? value / 100 : value) : undefined)} placeholder="0" onChange={(s) => setValue(money ? Math.round(num(s) * 100) : num(s))} />;
  if (def && shape === "between") {
    const [a, b] = Array.isArray(value) ? (value as number[]) : [0, 0];
    const f = (n: number) => show(money ? n / 100 : n);
    const t = (s: string) => (money ? Math.round(num(s) * 100) : num(s));
    editor = (
      <>
        <TokInput label="Van" type="number" value={f(a)} onChange={(s) => setValue([t(s), b])} />
        en
        <TokInput label="Tot" type="number" value={f(b)} onChange={(s) => setValue([a, t(s)])} />
      </>
    );
  }
  if (def && shape === "period") {
    const p = (value as Period | undefined) ?? { p: "this_week" };
    editor = (
      <>
        <Tok<PeriodKind>
          label="Periode"
          value={p.p}
          options={(Object.keys(PERIODS) as PeriodKind[]).filter((k) => k !== "range" && k !== "on").map((k) => ({ value: k, label: PERIODS[k].replace("…", "n").replace(/^de (laatste|komende) n$/, "de $1 n") }))}
          onChange={(k) => setValue({ p: k, ...(COUNTED.includes(k) ? { n: p.n ?? 7, ...(p.u ? { u: p.u } : {}) } : {}) })}
        />
        {COUNTED.includes(p.p) && (
          <>
            <TokInput label="Hoeveel" type="number" value={show(p.n ?? 7)} onChange={(s) => setValue({ ...p, n: Math.max(1, Math.round(num(s))) })} />
            <Tok<PeriodUnit>
              label="Eenheid"
              value={p.u ?? "day"}
              options={(Object.keys(PERIOD_UNITS) as PeriodUnit[]).map((u) => ({ value: u, label: (p.n ?? 7) === 1 ? PERIOD_UNITS[u].one : PERIOD_UNITS[u].many }))}
              onChange={(u) => setValue({ ...p, u })}
            />
          </>
        )}
      </>
    );
  }
  if (def && shape === "options") {
    const chosen = Array.isArray(value) ? (value as string[]) : [];
    const all = optionsFor(def, choices);
    const name = (v: string) => all.find((o) => o.value === v)?.label ?? (v === "me" ? "Ik" : v);
    editor = (
      <>
        {chosen.map((v) => (
          <TokChip key={v} text={name(v)} label={`${name(v)} weghalen`} onRemove={() => setValue(chosen.filter((x) => x !== v))} />
        ))}
        <TokAdd label="Waarde toevoegen" text={chosen.length ? "of" : "kies"} options={all.filter((o) => !chosen.includes(o.value))} onPick={(v) => setValue([...chosen, v])} />
      </>
    );
  }
  if (def && shape === "week")
    editor = (
      <Tok
        label="Week"
        value={String(value ?? 1)}
        options={[...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `week ${n}` })), { value: "-1", label: "de laatste week" }]}
        onChange={(v) => setValue(Number(v))}
      />
    );
  if (def && shape === "weekdays") {
    const days = Array.isArray(value) ? (value as number[]) : [];
    editor = (
      <>
        {days.map((d) => (
          <TokChip key={d} text={WEEKDAYS[d - 1]} label={`${WEEKDAYS[d - 1]} weghalen`} onRemove={() => setValue(days.filter((x) => x !== d))} />
        ))}
        <TokAdd label="Dag toevoegen" text={days.length ? "of" : "kies"} options={WEEKDAYS.map((w, i) => ({ value: String(i + 1), label: w })).filter((o) => !days.includes(Number(o.value)))} onPick={(v) => setValue([...days, Number(v)])} />
      </>
    );
  }
  return (
    <div className="sentence-line">
      {prefix}
      <Tok
        label="Veld"
        value={cond.field}
        options={fields.map((f) => ({ value: f.key, label: f.label.toLowerCase() }))}
        onChange={(key) => {
          const d = fields.find((f) => f.key === key)!;
          const op = OPS_FOR[kindOfKey(key, d)][0];
          onChange({ field: key, op, value: startValue(op) });
        }}
      />
      {def && (
        <Tok<Op>
          label="Vergelijking"
          value={cond.op}
          options={ops.map((o) => ({ value: o, label: OPS[o].label }))}
          onChange={(op) => onChange({ field: cond.field, op, ...(startValue(op) !== undefined ? { value: OPS[op].value === shape ? value : startValue(op) } : {}) })}
        />
      )}
      {editor}
      <TokRemove label="Voorwaarde weghalen" onClick={onRemove} />
    </div>
  );
}

// ---------- tonen als ----------

const SHOW_ICONS: Record<Show, ReactNode> = {
  lijst: (
    <>
      <rect x="4" y="5" width="32" height="3" rx="1.5" />
      <rect x="4" y="12" width="26" height="3" rx="1.5" />
      <rect x="4" y="19" width="29" height="3" rx="1.5" />
    </>
  ),
  tabel: <path d="M4 4h32v18H4zM4 10h32M4 16h32M16 4v18" fill="none" strokeWidth="2" />,
  agenda: (
    <>
      <path d="M8 4h24a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM5 10h30" fill="none" strokeWidth="2" />
      <rect x="10" y="14" width="5" height="4" rx="1" stroke="none" />
      <rect x="18" y="14" width="5" height="4" rx="1" stroke="none" opacity=".35" />
      <rect x="26" y="14" width="5" height="4" rx="1" stroke="none" opacity=".35" />
    </>
  ),
  getal: (
    <text x="20" y="19" textAnchor="middle" fontSize="15" fontWeight="700" stroke="none">
      12
    </text>
  ),
  voortgang: (
    <>
      <rect x="4" y="11" width="32" height="5" rx="2.5" opacity=".35" />
      <rect x="4" y="11" width="21" height="5" rx="2.5" />
    </>
  ),
  staafjes: (
    <>
      <rect x="5" y="12" width="6" height="12" rx="1.5" />
      <rect x="14" y="6" width="6" height="18" rx="1.5" />
      <rect x="23" y="9" width="6" height="15" rx="1.5" />
      <rect x="32" y="3" width="6" height="21" rx="1.5" />
    </>
  ),
  lijn: <path d="M3 20 12 13l8 4 9-10 8 3" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />,
  gebied: (
    <>
      <path d="M3 20 12 13l8 4 9-10 8 3v14H3z" opacity=".3" stroke="none" />
      <path d="M3 20 12 13l8 4 9-10 8 3" fill="none" strokeWidth="2" strokeLinejoin="round" />
    </>
  ),
  perkeuze: (
    <>
      <rect x="4" y="4" width="30" height="5" rx="2" />
      <rect x="4" y="11" width="21" height="5" rx="2" />
      <rect x="4" y="18" width="12" height="5" rx="2" />
    </>
  ),
  verdeling: (
    <>
      <circle cx="20" cy="13" r="9" fill="none" strokeWidth="6" opacity=".35" />
      <path d="M20 4a9 9 0 0 1 8.6 11.7" fill="none" strokeWidth="6" />
    </>
  ),
  kalender: (
    <g stroke="none">
      {[0, 1, 2, 3, 4].flatMap((c) =>
        [0, 1, 2].map((r) => <rect key={`${c}${r}`} x={4 + c * 7} y={4 + r * 7} width="5" height="5" rx="1" opacity={(c + r) % 3 === 0 ? 1 : 0.35} />),
      )}
    </g>
  ),
};

/** Wat bij een vorm hoort: tellen (met standaard per periode of keuze) of rijen (met een maximum). */
function withShow(draft: ViewBlock, next: Show): ViewBlock {
  const { tally: _t, limit: _l, ...rest } = draft;
  if (!counts(next)) return { ...rest, show: next, ...(next !== "agenda" ? { limit: draft.limit ?? DEFAULT_LIMIT } : {}) };
  const keep = draft.tally;
  const tally: Tally = next === "kalender" ? { agg: keep?.agg ?? "count", ...(keep?.field ? { field: keep.field } : {}), step: "day", n: 35 } : perChoice(next) || next === "getal" || next === "voortgang" ? { agg: keep?.agg ?? "count", ...(keep?.field ? { field: keep.field } : {}), ...(keep?.by ? { by: keep.by } : {}), step: keep && !overTime(draft.show) ? keep.step : "month", n: keep && !overTime(draft.show) ? keep.n : 1 } : { agg: keep?.agg ?? "count", ...(keep?.field ? { field: keep.field } : {}), step: keep?.step && keep.step !== "day" ? keep.step : "week", n: 8 };
  return { ...rest, show: next, tally };
}

/** De periode van een getal of een telling per keuze, in één keuze ("deze maand", "de laatste 30 dagen", "altijd"). */
const SPANS: { value: string; label: string; step: ChartStep; n: number }[] = [
  { value: "day:1", label: "vandaag", step: "day", n: 1 },
  { value: "week:1", label: "deze week", step: "week", n: 1 },
  { value: "month:1", label: "deze maand", step: "month", n: 1 },
  { value: "year:1", label: "dit jaar", step: "year", n: 1 },
  { value: "day:7", label: "de laatste 7 dagen", step: "day", n: 7 },
  { value: "day:30", label: "de laatste 30 dagen", step: "day", n: 30 },
  { value: "month:12", label: "de laatste 12 maanden", step: "month", n: 12 },
  { value: "month:0", label: "altijd", step: "month", n: 0 },
];

// ---------- een weergave samenstellen ----------

export const EMPTY_VIEW_BLOCK: ViewBlock = { kind: "view", name: "", source: "logboek", lists: [], where: { match: "all", conditions: [] }, show: "lijst", limit: DEFAULT_LIMIT };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Een weergave van vroeger in de stappen van nu: haar getoonde kolommen (`where.columns`) en wat ze telde (`tally`)
 * als kolommen, en per keuze als groeperen.
 */
function withSteps(block: ViewBlock): ViewBlock {
  if (block.cols?.length) return block;
  const shown: ViewCol[] = (block.where.columns ?? []).map((k) => ({ key: k, field: k, calc: "toon" }));
  const t = block.tally;
  const measure: ViewCol[] = counts(block.show) && t ? [{ key: t.agg === "count" ? "aantal" : (t.field ?? "aantal"), field: t.agg === "count" ? NAME : (t.field ?? NAME), calc: t.agg }] : [];
  const cols = [...shown, ...measure.filter((m) => !shown.some((c) => c.key === m.key))];
  return { ...block, ...(cols.length ? { cols } : {}), ...(!block.group && t?.by && counts(block.show) ? { group: { field: t.by } } : {}) };
}

/** Groeperen in één keuze: een veld ("wagen"), of een datum per dag, week, maand of jaar ("at:month"). */
const groupValue = (g: ViewBlock["group"]) => (g ? (g.step ? `${g.field}:${g.step}` : g.field) : "");

export function ViewBuilder({ initial, saveLabel, onSave, onCancel }: { initial: ViewBlock; saveLabel: string; onSave: (b: ViewBlock) => void; onCancel: () => void }) {
  const { lists, person } = useSession();
  const [draft, setDraft] = useState<ViewBlock>(() => withSteps(initial));
  const settled = useDebounced(draft, 300);
  const { data } = useApi<ViewResponse>(viewUrl(settled));
  const { data: columns } = useApi<ListColumns[]>("/me/columns?alle=1");
  const [fields, setFields] = useState<FieldDef[]>([]);
  useEffect(() => {
    if (data) setFields(data.fields);
  }, [data]);
  const set = (patch: Partial<ViewBlock>) => setDraft((d) => ({ ...d, ...patch }));
  const setWhere = (patch: Partial<ViewBlock["where"]>) => setDraft((d) => ({ ...d, where: { ...d.where, ...patch } }));
  const setTally = (patch: Partial<Tally>) => setDraft((d) => ({ ...d, tally: { ...(d.tally ?? { agg: "count", step: "week", n: 8 }), ...patch } }));
  const choices: Choices = { people: data?.people ?? [], items: data?.items ?? {}, me: person.id };
  const conds = draft.where.conditions;
  // De velden om mee te werken: die van de bron, en de formules van de kolommen (ook om te filteren of te sorteren).
  const colDefs = colFields(draft.cols ?? [], fields).filter((d): d is FieldDef => d !== null && !fields.some((f) => f.key === d.key));
  const usable = [...fields.filter((f) => f.type !== "calc" || f.result), ...colDefs];
  const dates = usable.filter((f) => f.type === "date" || f.type === "date_range");
  const listName = (id: string) => lists.find((l) => l.id === id)?.name;
  const rows = draft.show === "lijst" || draft.show === "tabel";
  const chart = counts(draft.show);
  const t = draft.tally;
  // Groeperen: per keuze; een tabel of lijst ook per datum (dag, week, maand of jaar). Een getal, voortgang of per dag niet.
  const canGroup = rows || perChoice(draft.show) || (overTime(draft.show) && draft.show !== "kalender");
  const groupFields = usable.filter((f) => isGroupField(f) && f.key !== NAME);
  const groupOptions: Option<string>[] = [
    ...(perChoice(draft.show) ? [] : [{ value: "", label: "—" }]),
    ...groupFields.map((f) => ({ value: f.key, label: f.label })),
    ...(rows ? dates.flatMap((f) => (Object.keys(CHART_STEPS) as ChartStep[]).map((s) => ({ value: `${f.key}:${s}`, label: `${f.label} · ${CHART_STEPS[s].per.toLowerCase()}` }))) : []),
  ];
  function setGroup(v: string) {
    const [field, step] = v.split(":");
    const group = field ? { field, ...(step ? { step: step as ChartStep } : {}) } : undefined;
    // Een grafiek: per keuze is haar as, over de tijd apart per keuze.
    setDraft((d) => ({ ...d, group, ...(counts(d.show) && d.tally ? { tally: { ...d.tally, by: group && !group.step ? group.field : undefined } } : {}) }));
  }
  function setSource(source: SourceKind) {
    const keep = source === "items" ? draft.lists.filter((id) => lists.find((l) => l.id === id)?.one) : draft.lists;
    const first = lists.find((l) => l.one)?.id;
    setDraft((d) => ({
      ...d,
      source,
      lists: source === "items" && !keep.length && first ? [first] : keep,
      where: { match: d.where.match, conditions: [] },
      cols: undefined,
      group: undefined,
      ...(d.tally ? { tally: { agg: "count", step: d.tally.step, n: d.tally.n } } : {}),
    }));
  }
  const toggleList = (id: string) =>
    set({ lists: draft.lists.includes(id) ? (draft.source === "items" && draft.lists.length === 1 ? draft.lists : draft.lists.filter((x) => x !== id)) : [...draft.lists, id] });
  const chosen = draft.lists.flatMap((id) => columns?.filter((c) => c.id === id) ?? []).map((c) => ({ id: c.id, name: c.name, fields: c.fields as FieldDef[] }));
  const stepOptions = (Object.keys(CHART_STEPS) as ChartStep[]).map((s) => ({ value: s, label: CHART_STEPS[s].one }));

  return (
    <div className="builder">
      <div className="builder-main">
        <label className="field">
          <span className="label">Naam</span>
          <input value={draft.name} maxLength={40} placeholder={viewName({ ...draft, name: "" }, listName)} onChange={(e) => set({ name: e.target.value })} />
        </label>

        <section className="builder-section" aria-label="Lijsten">
          <h3 className="cap-label">Lijsten</h3>
          <div className="tag-picker">
            {draft.source !== "items" && (
              <button type="button" className="tag" aria-pressed={!draft.lists.length} onClick={() => set({ lists: [] })}>
                <Icon name="check" size={14} className="check" />
                {draft.lists.length > 0 && <span className="dot" />}
                Alle lijsten
              </button>
            )}
            {lists
              .filter((l) => !l.archived && (draft.source !== "items" || l.one))
              .map((l) => {
                const on = draft.lists.includes(l.id);
                return (
                  <button key={l.id} type="button" className="tag" aria-pressed={on} onClick={() => toggleList(l.id)}>
                    <Icon name="check" size={14} className="check" />
                    {!on && <span className="dot" />}
                    {l.name}
                  </button>
                );
              })}
          </div>
          <label className="field">
            <span className="label">Wat</span>
            <select value={draft.source} onChange={(e) => setSource(e.target.value as SourceKind)}>
              {(Object.keys(SOURCES) as SourceKind[]).map((s) => (
                <option key={s} value={s}>
                  {SOURCES[s].charAt(0).toUpperCase() + SOURCES[s].slice(1)}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="builder-section sentence" aria-label="Voorwaarden">
          <h3 className="cap-label">Voorwaarden</h3>
          {conds.map((c, i) => (
            <ConditionLine
              key={i}
              cond={c}
              fields={usable}
              choices={choices}
              prefix={
                i === 0 ? (
                  "waar"
                ) : i === 1 ? (
                  <Tok<"all" | "any">
                    label="En of of"
                    value={draft.where.match}
                    options={[
                      { value: "all", label: "en" },
                      { value: "any", label: "of" },
                    ]}
                    onChange={(m) => setWhere({ match: m })}
                  />
                ) : (
                  <span className="sentence-soft">{draft.where.match === "any" ? "of" : "en"}</span>
                )
              }
              onChange={(next) => setWhere({ conditions: conds.map((x, k) => (k === i ? next : x)) })}
              onRemove={() => setWhere({ conditions: conds.filter((_, k) => k !== i) })}
            />
          ))}
          <div className="sentence-line">
            <TokAdd
              label="Voorwaarde toevoegen"
              text={conds.length ? (draft.where.match === "any" ? "of …" : "en …") : "waar …"}
              options={usable.map((f) => ({ value: f.key, label: f.label.toLowerCase() }))}
              onPick={(key) => {
                const d = usable.find((f) => f.key === key)!;
                const op = OPS_FOR[kindOfKey(key, d)][0];
                setWhere({ conditions: [...conds, { field: key, op, ...(startValue(op) !== undefined ? { value: startValue(op) } : {}) }] });
              }}
            />
          </div>
        </section>

        {draft.show !== "agenda" && (
          <section className="builder-section" aria-label="Kolommen">
            <h3 className="cap-label">Kolommen</h3>
            <ViewColumns cols={draft.cols ?? []} onChange={(cols) => set({ cols: cols.length ? cols : undefined })} fields={fields} lists={draft.source === "items" ? chosen : []} />
            {canGroup && groupOptions.length > (perChoice(draft.show) ? 0 : 1) && (
              <label className="field">
                <span className="label">Groeperen per</span>
                <select value={groupValue(draft.group) || (perChoice(draft.show) ? (t?.by ?? groupOptions[0]?.value ?? "") : "")} onChange={(e) => setGroup(e.target.value)}>
                  {groupOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {rows && (
              <div className="field-row">
                <label className="field">
                  <span className="label">Sorteren op</span>
                  <select value={draft.where.sort?.[0]?.field ?? ""} onChange={(e) => setWhere({ sort: e.target.value ? [{ field: e.target.value, dir: draft.where.sort?.[0]?.dir ?? "asc" }] : undefined })}>
                    <option value="">—</option>
                    {usable
                      .filter((f) => f.type !== "items" && f.type !== "people")
                      .map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.key === NAME ? "Naam" : f.label}
                        </option>
                      ))}
                  </select>
                </label>
                {draft.where.sort?.[0] && (
                  <label className="field">
                    <span className="label">Richting</span>
                    <select value={draft.where.sort[0].dir} onChange={(e) => setWhere({ sort: [{ field: draft.where.sort![0].field, dir: e.target.value as "asc" | "desc" }] })}>
                      <option value="asc">Van laag naar hoog</option>
                      <option value="desc">Van hoog naar laag</option>
                    </select>
                  </label>
                )}
              </div>
            )}
          </section>
        )}

        <section className="builder-section" aria-label="Tonen als">
          <h3 className="cap-label">Tonen als</h3>
          <div className="show-grid">
            {SHOW_ORDER.map((s) => (
              <button key={s} type="button" className="show-tile" aria-pressed={draft.show === s} onClick={() => setDraft((d) => withShow(d, s))}>
                <svg viewBox="0 0 40 26" aria-hidden="true">
                  {SHOW_ICONS[s]}
                </svg>
                {SHOWS[s].label}
              </button>
            ))}
          </div>
          <div className="field-row">
            {draft.source === "items" && (chart || draft.show === "agenda") && dates.length > 0 && (
              <label className="field">
                <span className="label">Volgens</span>
                <select value={sourceDate("items", usable, draft.date)} onChange={(e) => set({ date: e.target.value })}>
                  {dates.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {chart && t && overTime(draft.show) && draft.show !== "kalender" && (
              <label className="field">
                <span className="label">Per</span>
                <select value={t.step} onChange={(e) => setTally({ step: e.target.value as ChartStep })}>
                  {stepOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {chart && t && (
              <label className="field">
                <span className="label">Over</span>
                {overTime(draft.show) ? (
                  <select value={String(t.n)} onChange={(e) => setTally({ n: Number(e.target.value) })}>
                    {(draft.show === "kalender" ? [35, 91, 182, 365] : [4, 6, 8, 12, 24, 52, 0]).map((n) => (
                      <option key={n} value={String(n)}>
                        {n === 0 ? "Altijd" : `De laatste ${n} ${draft.show === "kalender" ? "dagen" : CHART_STEPS[t.step].many}`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={`${t.step}:${t.n}`}
                    onChange={(e) => {
                      const span = SPANS.find((x) => x.value === e.target.value)!;
                      setTally({ step: span.step, n: span.n });
                    }}
                  >
                    {SPANS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label.charAt(0).toUpperCase() + o.label.slice(1)}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            )}
            {chart && draft.show !== "perkeuze" && draft.show !== "verdeling" && draft.show !== "kalender" && (
              <label className="field">
                <span className="label">Doel</span>
                <input inputMode="decimal" value={show(draft.goal)} placeholder={draft.show === "voortgang" ? "…" : "—"} onChange={(e) => set({ goal: e.target.value.trim() ? num(e.target.value) : undefined })} />
              </label>
            )}
            {rows && !draft.group && (
              <label className="field">
                <span className="label">Hoogstens</span>
                <input inputMode="numeric" value={String(draft.limit ?? DEFAULT_LIMIT)} onChange={(e) => set({ limit: Math.max(1, Math.min(50, Math.round(num(e.target.value)) || 1)) })} />
              </label>
            )}
          </div>
          <RulesEditor draft={draft} fields={usable} choices={choices} onChange={(rules) => set({ rules: rules.length ? rules : undefined })} />
        </section>
      </div>

      <div className="builder-preview">
        <h3 className="cap-label">Voorbeeld</h3>
        <section className={`card dash-card view-card${data?.tone ? ` tone-${data.tone}` : ""}`} aria-label="Voorbeeld" aria-busy={!data}>
          <CardHead title={viewName(draft, listName)} description={draft.show !== "agenda" ? (data?.span?.label ?? (counts(draft.show) ? data?.chart?.window : undefined)) : undefined} />
          {data && (data.hidden ? <p className="view-empty">Verborgen: er is niets</p> : <ViewBody block={settled} data={data} preview />)}
        </section>
      </div>

      <div className="builder-actions">
        <button type="button" className="btn btn-outline" onClick={onCancel}>
          Annuleren
        </button>
        <button type="button" className="btn btn-primary" disabled={draft.source === "items" && !draft.lists.length} onClick={() => onSave(draft)}>
          {saveLabel}
        </button>
      </div>
    </div>
  );
}

// ---------- voorwaarden op wat je ziet ----------

const TONE_OPTIONS: Option<RuleTone>[] = [
  { value: "rood", label: "rood" },
  { value: "oranje", label: "oranje" },
  { value: "groen", label: "groen" },
];

function RulesEditor({ draft, fields, choices, onChange }: { draft: ViewBlock; fields: FieldDef[]; choices: Choices; onChange: (rules: Rule[]) => void }) {
  const rules = draft.rules ?? [];
  const rows = draft.show === "lijst" || draft.show === "tabel";
  const result = draft.show === "getal" || draft.show === "voortgang";
  const set = (i: number, r: Rule) => onChange(rules.map((x, k) => (k === i ? r : x)));
  const remove = (i: number) => onChange(rules.filter((_, k) => k !== i));
  const adds: Option<string>[] = [
    ...(rows && fields.length ? [{ value: "rij", label: "Als een rij …" }] : []),
    ...(result ? [{ value: "uitkomst", label: "Als de uitkomst …" }] : []),
    ...(!rules.some((r) => r.when === "leeg") ? [{ value: "leeg", label: "Als er niets is …" }] : []),
  ];
  return (
    <section className="builder-section" aria-label="Regels">
      <h3 className="cap-label">Regels</h3>
      {rules.map((r, i) => {
        if (r.when === "leeg")
          return (
            <div key={i} className="sentence-line rule-line">
              Als er niets is → <span className="sentence-soft">verberg het blok</span>
              <TokRemove label="Regel weghalen" onClick={() => remove(i)} />
            </div>
          );
        if (r.when === "uitkomst")
          return (
            <div key={i} className="sentence-line rule-line">
              Als de uitkomst
              <Tok<ResultOp> label="Vergelijking" value={r.op} options={(Object.keys(RESULT_OPS) as ResultOp[]).map((o) => ({ value: o, label: RESULT_OPS[o] }))} onChange={(op) => set(i, { ...r, op })} />
              <TokInput label="Grens" type="number" value={show(r.value)} onChange={(s) => set(i, { ...r, value: num(s) })} />→
              <Tok<RuleTone> label="Kleur" value={r.then} options={TONE_OPTIONS} onChange={(then) => set(i, { ...r, then })} />
              <TokRemove label="Regel weghalen" onClick={() => remove(i)} />
            </div>
          );
        return (
          <div key={i} className="rule-line rule-row">
            <ConditionLine cond={r.cond} fields={fields} choices={choices} prefix="Als een rij waar" onChange={(cond) => set(i, { ...r, cond })} onRemove={() => remove(i)} />
            <div className="sentence-line">
              →
              <Tok<RowEffect>
                label="Wat dan"
                value={r.then}
                options={(Object.keys(ROW_EFFECTS) as RowEffect[]).map((e) => ({ value: e, label: e === "bovenaan" ? "bovenaan" : e === "verbergen" ? "verbergen" : `${e} kleuren` }))}
                onChange={(then) => set(i, { ...r, then })}
              />
            </div>
          </div>
        );
      })}
      <div className="sentence-line">
        <TokAdd
          label="Regel toevoegen"
          text="Regel"
          options={adds}
          onPick={(v) => {
            if (v === "leeg") onChange([...rules, { when: "leeg", then: "verbergen" }]);
            else if (v === "uitkomst") onChange([...rules, { when: "uitkomst", op: "gt", value: 0, then: "oranje" }]);
            else if (fields.length) {
              const f = fields.find((x) => x.key !== NAME) ?? fields[0];
              const op = OPS_FOR[kindOfKey(f.key, f)][0];
              onChange([...rules, { when: "rij", cond: { field: f.key, op, ...(startValue(op) !== undefined ? { value: startValue(op) } : {}) }, then: "rood" }]);
            }
          }}
        />
      </div>
    </section>
  );
}

// ---------- een actie samenstellen ----------

const DOES_ICONS: Record<ActionDoes, IconName> = { form: "file", save: "check", count: "plus", timer: "clock" };

export function ActionBuilder({ initial, saveLabel, onSave, onCancel }: { initial: ActionBlock; saveLabel: string; onSave: (b: ActionBlock) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<ActionBlock>(initial);
  const { data: targets } = useApi<Targets>("/me/targets");
  const kind = targets ? actionForm(draft, targets.kinds) : undefined;
  const set = (patch: Partial<ActionBlock>) => setDraft((d) => ({ ...d, ...patch }));
  const setValue = (key: string, v: FieldValue | undefined) => {
    const values = { ...draft.values };
    if (v === undefined || v === "") delete values[key];
    else values[key] = v;
    set({ values });
  };
  const fields = (kind?.fields ?? []).filter((f) => ["number", "money", "text", "select", "bool", "duration"].includes(f.type));

  return (
    <div className="builder builder-narrow">
      <div className="builder-main">
        <div className="builder-preview-tile">{kind && <ActionTile block={draft} preview />}</div>

        {targets && (
          <FormPicker
            kinds={targets.kinds}
            listId={draft.list}
            value={kind?.id ?? ""}
            wrap
            onChange={(k) => set({ type: k.id, list: "", values: {}, ...(draft.does === "timer" && !k.parts.duration ? { does: "save" as const } : {}) })}
          />
        )}

        <div className="field">
          <span className="label">Een tik</span>
          <div className="does-grid">
            {(Object.keys(ACTION_DOES) as ActionDoes[]).map((d) => (
              <button key={d} type="button" className="show-tile does-tile" aria-pressed={draft.does === d} disabled={d === "timer" && !kind?.parts.duration} onClick={() => set({ does: d, planned: canPlan(d) ? draft.planned : undefined })}>
                <Icon name={DOES_ICONS[d]} size={16} />
                {ACTION_DOES[d]}
              </button>
            ))}
          </div>
        </div>

        {canPlan(draft.does) && (
          <Switch label="Gepland" checked={draft.planned === true || kind?.planned === true} disabled={kind?.planned === true} onChange={(on) => set({ planned: on ? true : undefined })} />
        )}

        {kind && (
          <div className="field">
            <span className="label">Vooraf ingevuld</span>
            <div className="prefill">
              <label className="prefill-row">
                <span>Omschrijving</span>
                <input value={String(draft.values.name ?? "")} placeholder={kind.name} onChange={(e) => setValue("name", e.target.value)} />
              </label>
              {fields.map((f) => (
                <label key={f.key} className="prefill-row">
                  <span>{f.label}</span>
                  {f.type === "select" ? (
                    <select value={String(draft.values[f.key] ?? "")} onChange={(e) => setValue(f.key, e.target.value || undefined)}>
                      <option value="">—</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : f.type === "bool" ? (
                    <input type="checkbox" checked={draft.values[f.key] === true} onChange={(e) => setValue(f.key, e.target.checked || undefined)} />
                  ) : f.type === "text" ? (
                    <input value={String(draft.values[f.key] ?? "")} onChange={(e) => setValue(f.key, e.target.value)} />
                  ) : (
                    <span className="prefill-number">
                      <input
                        inputMode="decimal"
                        value={draft.values[f.key] === undefined ? "" : show(f.type === "money" ? Number(draft.values[f.key]) / 100 : Number(draft.values[f.key]))}
                        onChange={(e) => setValue(f.key, e.target.value.trim() ? (f.type === "money" ? Math.round(num(e.target.value) * 100) : num(e.target.value)) : undefined)}
                      />
                      {f.unit && <span className="muted">{f.unit}</span>}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        <label className="field">
          <span className="label">Naam op de knop</span>
          <input value={draft.name} maxLength={40} placeholder={kind?.name ?? ""} onChange={(e) => set({ name: e.target.value })} />
        </label>
      </div>

      <div className="builder-actions">
        <button type="button" className="btn btn-outline" onClick={onCancel}>
          Annuleren
        </button>
        <button type="button" className="btn btn-primary" disabled={!draft.list || !kind} onClick={() => onSave({ ...draft, type: kind?.id ?? draft.type })}>
          {saveLabel}
        </button>
      </div>
    </div>
  );
}

/** Blok toevoegen: een weergave (wat je ziet) of een actie (een knop die logt). */
export function AddChoice({ onPick }: { onPick: (kind: "view" | "action") => void }) {
  return (
    <div className="add-choice">
      <button type="button" className="add-choice-row" onClick={() => onPick("view")}>
        <span className="add-choice-icon tone-sky">
          <Icon name="table" size={20} />
        </span>
        <span className="row-title">Weergave</span>
        <Icon name="next" size={16} className="row-chevron" />
      </button>
      <button type="button" className="add-choice-row" onClick={() => onPick("action")}>
        <span className="add-choice-icon is-brand">
          <Icon name="plus" size={20} />
        </span>
        <span className="row-title">Actie</span>
        <Icon name="next" size={16} className="row-chevron" />
      </button>
    </div>
  );
}
