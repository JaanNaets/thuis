import { useState } from "react";
import {
  AGGS,
  CALC_KINDS,
  COMPARE_OPS,
  isLinkCalc,
  LOOKUP_TYPES,
  MATH_OPS,
  NUMERIC,
  SINCE_UNITS,
  typeOf,
  type Agg,
  type CalcDef,
  type CalcKind,
  type CalcList,
  type Operand,
  type SinceUnit,
} from "../../shared/calc";
import { INTERVAL_UNITS, type FieldDef, type FieldType, type IntervalUnit } from "../../shared/fields";
import { Segmented } from "./Controls";
import { Tip } from "./Tip";

/** Een berekening terwijl je ze samenstelt: wat nog niet gekozen is, ontbreekt (de API kijkt alles na). */
type Draft = {
  kind?: CalcKind;
  op?: string;
  a?: Operand;
  b?: Operand;
  field?: string;
  unit?: SinceUnit;
  add?: { field: string } | { n: number; unit: IntervalUnit };
  via?: string;
  from?: "links" | "backlinks";
  list?: string;
  agg?: Agg;
};

const MATH_LABELS = { "+": "+ plus", "-": "− min", "*": "× maal", "/": "÷ gedeeld door" } as const satisfies Record<keyof typeof MATH_OPS, string>;
const COMPARE_LABELS = { "<": "<", "<=": "≤", ">": ">", ">=": "≥", "=": "=", "!=": "≠" } as const satisfies Record<keyof typeof COMPARE_OPS, string>;

/** Waarmee een nieuwe berekening van die soort begint. */
function start(kind: CalcKind, fields: FieldDef[]): Draft {
  switch (kind) {
    case "math":
      return { kind, op: "*", a: { field: "" }, b: { field: "" } };
    case "compare":
      return { kind, op: "<=", a: { field: "" }, b: { field: "" } };
    case "days_until":
      return { kind, field: "" };
    case "since":
      return { kind, field: "", unit: "year" };
    case "date_add":
      return { kind, field: "", add: { n: 1, unit: "year" } };
    case "lookup":
      return { kind, via: "", field: "" };
    case "rollup":
      // Heeft deze lijst zelf een verwijzing, dan via die; anders wat hiernaar verwijst.
      return { kind, from: fields.some((f) => f.type === "item" || f.type === "items") ? "links" : "backlinks", via: "", agg: "count" };
  }
}

/**
 * Wat een berekening uitrekent: eerst de soort (met uitleg), dan per soort de velden. `fields`: alle velden van deze
 * lijst (een berekening met haar uitkomst, zie `previewCalcs`); `lists`: de andere lijsten; `error`: wat nog niet klopt.
 */
export function CalcEditor({
  field,
  fields,
  lists,
  selfId,
  error,
  onChange,
}: {
  field: FieldDef;
  fields: FieldDef[];
  lists: CalcList[];
  selfId: string;
  error?: string;
  onChange: (calc: CalcDef) => void;
}) {
  const calc = (field.calc ?? {}) as Draft;
  const set = (patch: Draft) => onChange({ ...calc, ...patch } as CalcDef);
  const others = fields.filter((f) => f.key !== field.key);
  const ofType = (types: FieldType[], among = others) => among.filter((f) => types.includes(typeOf(f)!));
  const listFor = (refType: string | undefined): CalcList | undefined =>
    refType === selfId || refType === "self" ? { id: selfId, name: "", plural: "deze lijst", fields } : lists.find((l) => l.id === refType);

  return (
    <div className="calc-editor">
      <label className="field">
        <span className="label">Wat rekent de app uit</span>
        <select value={calc.kind ?? ""} onChange={(e) => onChange(start(e.target.value as CalcKind, others) as CalcDef)}>
          <option value="" disabled>
            Kies…
          </option>
          {Object.entries(CALC_KINDS).map(([k, c]) => (
            <option key={k} value={k}>
              {c.label}
            </option>
          ))}
        </select>
        {calc.kind && <span className="hint">{CALC_KINDS[calc.kind].hint}</span>}
      </label>

      {(calc.kind === "math" || calc.kind === "compare") && (
        <div className="field">
          <span className="label">
            {calc.kind === "math" ? "Som" : "Vergelijking"}
            <Tip text="Kies een veld (een getal, bedrag, score, jaar of duur, of een andere berekening) of typ een getal. Een getal bij een bedrag telt in euro; bij een duur in minuten." />
          </span>
          <div className="calc-formula">
            <OperandPicker label="Eerste veld" value={calc.a} fields={ofType(NUMERIC)} onChange={(a) => set({ a })} />
            <select aria-label={calc.kind === "math" ? "Bewerking" : "Vergelijking"} value={calc.op} onChange={(e) => set({ op: e.target.value })}>
              {Object.entries(calc.kind === "math" ? MATH_LABELS : COMPARE_LABELS).map(([op, label]) => (
                <option key={op} value={op}>
                  {calc.kind === "math" ? label : `${label} ${COMPARE_OPS[op as keyof typeof COMPARE_OPS]}`}
                </option>
              ))}
            </select>
            <OperandPicker label="Tweede veld" value={calc.b} fields={ofType(NUMERIC)} onChange={(b) => set({ b })} />
          </div>
        </div>
      )}

      {calc.kind === "days_until" && <FieldPicker label="Tot welke datum" value={calc.field} fields={ofType(["date"])} onChange={(f) => set({ field: f })} />}

      {calc.kind === "since" && (
        <div className="field-row">
          <FieldPicker
            label="Sinds"
            value={calc.field}
            fields={ofType(["date", "year"])}
            onChange={(f) => set({ field: f, ...(typeOf(others.find((x) => x.key === f)) === "year" ? { unit: "year" } : {}) })}
          />
          <label className="field">
            <span className="label">In</span>
            <select value={calc.unit} onChange={(e) => set({ unit: e.target.value as SinceUnit })}>
              {Object.entries(SINCE_UNITS)
                .filter(([u]) => u === "year" || typeOf(others.find((x) => x.key === calc.field)) !== "year")
                .map(([u, label]) => (
                  <option key={u} value={u}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}

      {calc.kind === "date_add" && <DateAdd calc={calc} dates={ofType(["date"])} intervals={others.filter((f) => f.type === "interval")} set={set} />}

      {calc.kind === "lookup" && (
        <div className="field-row">
          <FieldPicker
            label="Via"
            value={calc.via}
            fields={others.filter((f) => f.type === "item")}
            empty="Geen Verwijzing"
            onChange={(v) => set({ via: v, field: "" })}
          />
          <FieldPicker
            label="Welk veld"
            value={calc.field}
            fields={remoteFields(listFor(others.find((f) => f.key === calc.via)?.ref_type), LOOKUP_TYPES, field.key)}
            onChange={(f) => set({ field: f })}
          />
        </div>
      )}

      {calc.kind === "rollup" && <Rollup calc={calc} others={others} lists={lists} selfId={selfId} listFor={listFor} self={field.key} set={set} />}

      {error && (
        <p className="hint error" role="status">
          {error.startsWith(`${field.label}: `) ? error.slice(field.label.length + 2) : error}
        </p>
      )}
    </div>
  );
}

/** De velden van een andere lijst die je kan opzoeken of samenvatten (geen opzoeking op een opzoeking). */
function remoteFields(list: CalcList | undefined, types: FieldType[], self: string): FieldDef[] {
  return (list?.fields ?? []).filter((f) => f.key !== self && !isLinkCalc(f) && types.includes(typeOf(f)!));
}

function FieldPicker({
  label,
  value,
  fields,
  onChange,
  empty = "Geen passend veld",
}: {
  label: string;
  value: string | undefined;
  fields: FieldDef[];
  onChange: (key: string) => void;
  empty?: string;
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-invalid={!value}>
        <option value="">{fields.length ? "Kies een veld" : empty}</option>
        {value && !fields.some((f) => f.key === value) && <option value={value}>Bestaat niet meer</option>}
        {fields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label || "Naamloos veld"}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Een veld of een getal (bv. Totaal × 1,21). */
function OperandPicker({ label, value, fields, onChange }: { label: string; value: Operand | undefined; fields: FieldDef[]; onChange: (o: Operand) => void }) {
  const isValue = Boolean(value && "value" in value);
  const [text, setText] = useState(value && "value" in value ? String(value.value).replace(".", ",") : "");
  const parsed = Number(text.replace(",", ".").trim());
  return (
    <span className="calc-operand">
      <select
        aria-label={label}
        value={value && "value" in value ? "#" : (value?.field ?? "")}
        aria-invalid={!value || ("field" in value && !value.field)}
        onChange={(e) => (e.target.value === "#" ? onChange({ value: Number.isFinite(parsed) ? parsed : 0 }) : onChange({ field: e.target.value }))}
      >
        <option value="">Kies een veld</option>
        {value && "field" in value && value.field && !fields.some((f) => f.key === value.field) && <option value={value.field}>Bestaat niet meer</option>}
        {fields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label || "Naamloos veld"}
          </option>
        ))}
        <option value="#">Een getal…</option>
      </select>
      {isValue && (
        <input
          inputMode="decimal"
          aria-label={`${label}: getal`}
          placeholder="bv. 1,21"
          value={text}
          aria-invalid={!text.trim() || !Number.isFinite(parsed)}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value.replace(",", ".").trim());
            if (e.target.value.trim() && Number.isFinite(n)) onChange({ value: n });
          }}
        />
      )}
    </span>
  );
}

/** Datum plus een Herhaling-veld of een vaste tijd. */
function DateAdd({ calc, dates, intervals, set }: { calc: Draft; dates: FieldDef[]; intervals: FieldDef[]; set: (patch: Draft) => void }) {
  const add = calc.add ?? { n: 1, unit: "year" as const };
  const [n, setN] = useState("n" in add ? String(add.n) : "1");
  return (
    <>
      <FieldPicker label="Datum" value={calc.field} fields={dates} onChange={(f) => set({ field: f })} />
      <label className="field">
        <span className="label">Plus</span>
        <select
          value={"field" in add ? add.field : "#"}
          onChange={(e) => set({ add: e.target.value === "#" ? { n: 1, unit: "year" } : { field: e.target.value } })}
        >
          {intervals.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label || "Naamloos veld"}
            </option>
          ))}
          <option value="#">Een vaste tijd</option>
        </select>
      </label>
      {"n" in add && (
        <div className="interval-input">
          <input
            inputMode="numeric"
            aria-label="Hoeveel"
            value={n}
            aria-invalid={String(add.n) !== n.trim()}
            onChange={(e) => {
              setN(e.target.value);
              const v = Number(e.target.value.trim());
              if (Number.isInteger(v) && v >= 1 && v <= 1000) set({ add: { ...add, n: v } });
            }}
          />
          <select aria-label="Eenheid" value={add.unit} onChange={(e) => set({ add: { ...add, unit: e.target.value as IntervalUnit } })}>
            {Object.entries(INTERVAL_UNITS).map(([u, w]) => (
              <option key={u} value={u}>
                {add.n === 1 ? w.one : w.many}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

/** Samenvatten: over de items in een verwijzing van dit item, of over de items die naar dit item verwijzen. */
function Rollup({
  calc,
  others,
  lists,
  selfId,
  listFor,
  self,
  set,
}: {
  calc: Draft;
  others: FieldDef[];
  lists: CalcList[];
  selfId: string;
  listFor: (refType: string | undefined) => CalcList | undefined;
  self: string;
  set: (patch: Draft) => void;
}) {
  // Wat naar deze lijst verwijst: per lijst de velden met een verwijzing hierheen.
  const pointing = [...lists, listFor(selfId)!].flatMap((l) =>
    l.fields
      .filter((f) => (f.type === "item" || f.type === "items") && (f.ref_type === selfId || f.ref_type === "self") && f.key !== self)
      .map((f) => ({ list: l, field: f })),
  );
  const target = calc.from === "links" ? listFor(others.find((f) => f.key === calc.via)?.ref_type) : listFor(calc.list);
  const numeric = calc.agg === "min" || calc.agg === "max" ? [...NUMERIC, "date" as const] : NUMERIC;
  return (
    <>
      <div className="field">
        <span className="label">
          Welke items
          <Tip text="In een veld hier: de items in een Verwijzing(en)-veld van dit item (bv. de ingrediënten van een recept). Wijzen hiernaar: items uit een andere lijst met een Verwijzing naar dit item (bv. de uitgaven bij een verkoper)." />
        </span>
        <Segmented
          label="Welke items"
          value={calc.from ?? "links"}
          options={[
            { value: "links", label: "In een veld hier" },
            { value: "backlinks", label: "Wijzen hiernaar" },
          ]}
          onChange={(from) => set({ from, via: "", list: undefined, field: undefined })}
        />
      </div>
      {calc.from === "links" ? (
        <FieldPicker
          label="Via"
          value={calc.via}
          fields={others.filter((f) => f.type === "item" || f.type === "items")}
          empty="Geen Verwijzing"
          onChange={(v) => set({ via: v, field: undefined })}
        />
      ) : (
        <label className="field">
          <span className="label">Uit</span>
          <select
            value={calc.list && calc.via ? `${calc.list}|${calc.via}` : ""}
            aria-invalid={!calc.via}
            onChange={(e) => {
              const [list, via] = e.target.value.split("|");
              set({ list, via, field: undefined });
            }}
          >
            <option value="">{pointing.length ? "Kies een lijst" : "Nog geen lijst verwijst hiernaar"}</option>
            {pointing.map(({ list, field }) => (
              <option key={`${list.id}|${field.key}`} value={`${list.id}|${field.key}`}>
                {list.id === selfId ? "Deze lijst" : list.plural} · {field.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="field-row">
        <label className="field">
          <span className="label">Wat wil je weten</span>
          <select value={calc.agg} onChange={(e) => set({ agg: e.target.value as Agg })}>
            {Object.entries(AGGS).map(([a, label]) => (
              <option key={a} value={a}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {calc.agg !== "count" && (
          <FieldPicker label="Van" value={calc.field} fields={remoteFields(target, numeric, self)} onChange={(f) => set({ field: f })} />
        )}
      </div>
    </>
  );
}
