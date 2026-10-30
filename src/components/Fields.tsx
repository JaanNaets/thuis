import { lazy, Suspense, useMemo, useRef, useState } from "react";
import type { Access } from "../../shared/access";
import { computeLocal, describeCalc, isLinkCalc, previewCalcs, renameCalc, type CalcList } from "../../shared/calc";
import {
  cleanValue,
  CODE_FORMATS,
  FIELD_GROUPS,
  FIELD_TYPES,
  FILTERABLE,
  fieldKey,
  formatDuration,
  formatFieldValue,
  INTERVAL_UNITS,
  isCodeFormat,
  normalizeShares,
  parseFieldText,
  type Attributes,
  type ChecklistEntry,
  type CodeFormat,
  type CodeValue,
  type FieldDef,
  type FieldType,
  type FieldValue,
  type Interval,
  type IntervalUnit,
  type Names,
  type Share,
} from "../../shared/fields";
import { isProductCode, PRODUCT_KEYS, productFits, productLabel, type ProductInfo, type ProductKey } from "../../shared/product";
import { splitCents } from "../../shared/totals";
import { parseForeign, toEuroCents, type Rates } from "../../shared/money";
import type { ItemRef, ItemType, LabelScan, Person } from "../../shared/types";
import { api, ApiError, apiUrl, useApi } from "../api";
import { detectInImage, type ScanResult } from "../barcode-detect";
import { isKiosk } from "../device";
import { centsToInput, formatCents, formatDate, parseEuro } from "../format";
import { prepareForReading, prepareUpload } from "../image";
import { Link } from "../router";
import { BarcodeScanner } from "./BarcodeScanner";
import { CalcEditor } from "./CalcEditor";
import { Alert, Avatar, Segmented, Switch } from "./Controls";
import { Icon } from "./Icon";
import { useSortable } from "./Sortable";
import { Tip } from "./Tip";

// De barcodecode is groot (±1 MB); enkel laden wanneer er een code getoond wordt.
const Barcode = lazy(() => import("./Barcode").then((m) => ({ default: m.Barcode })));

// ---------- namen bij id's ----------

/** Namen van personen en items om waarden te tonen. Wat je niet mag zien, heet "verborgen". */
export function namesFrom(people: Person[], refs: ItemRef[]): Names {
  const p = new Map(people.map((x) => [x.id, x.name]));
  const r = new Map(refs.map((x) => [x.id, x.name]));
  return { person: (id) => p.get(id) ?? "Onbekend", item: (id) => r.get(id) ?? "Verborgen" };
}

// ---------- waarden invullen ----------

/** Een verdeling terwijl je ze invult: gelijk, in procent of in bedragen (euro, als tekst). */
export type SharesDraft = { mode: "none" | "equal" | "percent" | "amount"; people: string[]; values: Record<string, string> };

type IntervalDraft = { n: string; unit: IntervalUnit };

/** Wat in een veld staat terwijl je typt. */
type DraftValue = string | [string, string] | number | boolean | null | CodeValue | SharesDraft | string[] | ChecklistEntry[] | IntervalDraft;
export type AttributeDraft = Record<string, DraftValue>;

export function sharesDraft(shares: Share[] | undefined): SharesDraft {
  if (!shares?.length) return { mode: "none", people: [], values: {} };
  const equal = shares.every((o) => Math.abs(o.share - shares[0].share) < 0.02);
  return {
    mode: equal ? "equal" : "percent",
    people: shares.map((o) => o.person_id),
    values: Object.fromEntries(shares.map((o) => [o.person_id, String(Math.round(o.share * 10) / 10).replace(".", ",")])),
  };
}

const parsePercent = (s: string | undefined) => {
  const n = Number((s ?? "").replace(",", ".").replace("%", "").trim());
  return s?.trim() && Number.isFinite(n) ? n : NaN;
};

/** Van wat er staat naar aandelen; undefined = klopt nog niet. Bedragen worden aandelen naar verhouding. */
export function buildShares(draft: SharesDraft): Share[] | undefined {
  if (draft.mode === "none" || draft.people.length === 0) return [];
  if (draft.mode === "equal") return normalizeShares(draft.people.map((id) => ({ person_id: id })));
  if (draft.mode === "amount") {
    const cents = draft.people.map((id) => ({ person_id: id, share: parseEuro(draft.values[id] ?? "") ?? NaN }));
    return cents.some((s) => !(s.share > 0)) ? undefined : normalizeShares(cents);
  }
  const shares = draft.people.map((id) => ({ person_id: id, share: parsePercent(draft.values[id]) }));
  if (shares.some((s) => !(s.share > 0))) return undefined;
  const total = shares.reduce((sum, s) => sum + s.share, 0);
  return Math.abs(total - 100) > 0.05 ? undefined : shares;
}

/** Het eerste bedrag in het formulier (in cent), bv. het bedrag van een uitgave; null als het leeg is. */
function moneyTotal(defs: FieldDef[], value: AttributeDraft): number | null {
  const def = defs.find((d) => d.type === "money");
  const cents = def ? parseEuro(String(value[def.key] ?? "")) : null;
  return cents !== null && Number.isFinite(cents) ? cents : null;
}

export function attributesDraft(defs: FieldDef[], attributes: Attributes): AttributeDraft {
  const draft: AttributeDraft = {};
  for (const def of defs) {
    const v = attributes[def.key];
    switch (def.type) {
      case "year_range": {
        const [from, to] = Array.isArray(v) ? (v as [number | null, number | null]) : [null, null];
        draft[def.key] = [from ? String(from) : "", to ? String(to) : ""];
        break;
      }
      case "score":
        draft[def.key] = typeof v === "number" ? v : null;
        break;
      case "bool":
        draft[def.key] = v === true;
        break;
      case "money":
        draft[def.key] = typeof v === "number" ? centsToInput(v) : "";
        break;
      case "multi":
        draft[def.key] = Array.isArray(v) ? v.join(", ") : "";
        break;
      case "number":
        draft[def.key] = typeof v === "number" ? String(v).replace(".", ",") : "";
        break;
      case "code":
        draft[def.key] = v && typeof v === "object" && "text" in v ? (v as CodeValue) : null;
        break;
      case "share":
        draft[def.key] = sharesDraft(Array.isArray(v) ? (v as Share[]) : undefined);
        break;
      case "date_range": {
        const [from, to] = Array.isArray(v) ? (v as [string | null, string | null]) : [null, null];
        draft[def.key] = [from ?? "", to ?? ""];
        break;
      }
      case "duration":
        draft[def.key] = typeof v === "number" ? formatDuration(v) : "";
        break;
      case "interval":
        draft[def.key] = v && typeof v === "object" && "unit" in v ? { n: String((v as Interval).n), unit: (v as Interval).unit } : { n: "", unit: "month" };
        break;
      case "people":
      case "items":
        draft[def.key] = Array.isArray(v) ? (v as string[]) : [];
        break;
      case "checklist":
        draft[def.key] = Array.isArray(v) ? (v as ChecklistEntry[]) : [];
        break;
      case "calc":
        // Wordt uitgerekend, niet ingevuld.
        break;
      default:
        draft[def.key] = v === undefined || v === null ? "" : String(v);
    }
  }
  return draft;
}

/** Eén waarde lezen; null = leeg, undefined = niet te lezen (het veld kleurt rood). */
function draftValue(def: FieldDef, raw: DraftValue | undefined): FieldValue | null | undefined {
  if (raw === undefined || raw === null || raw === "") return null;
  switch (def.type) {
    case "score":
      return typeof raw === "number" ? raw : null;
    case "bool":
      return raw === true ? true : null;
    case "code":
      return typeof raw === "object" && raw && "text" in raw && raw.text.trim() ? { text: raw.text.trim(), format: raw.format } : null;
    case "share": {
      const shares = buildShares(raw as SharesDraft);
      return shares === undefined ? undefined : shares.length ? shares : null;
    }
    case "person":
    case "item":
      return typeof raw === "string" && raw ? raw : null;
    case "calc":
      return null;
    case "people":
    case "items":
      return Array.isArray(raw) && raw.length ? (raw as string[]) : null;
    case "checklist": {
      const list = (Array.isArray(raw) ? (raw as ChecklistEntry[]) : []).filter((e) => e.text.trim()).map((e) => ({ text: e.text.trim(), done: e.done }));
      return list.length ? list : null;
    }
    case "interval": {
      const v = raw as IntervalDraft;
      if (!v.n?.trim()) return null;
      const n = Number(v.n.trim());
      return Number.isInteger(n) && n >= 1 && n <= 1000 ? { n, unit: v.unit } : undefined;
    }
    case "date_range": {
      const [from, to] = raw as [string, string];
      if (!from && !to) return null;
      return cleanValue(def, [from || null, to || null]) ?? undefined;
    }
    case "year_range": {
      const [from, to] = Array.isArray(raw) ? (raw as [string, string]) : ["", ""];
      if (!from.trim() && !to.trim()) return null;
      const year = (s: string) => (s.trim() ? (parseFieldText({ ...def, type: "year" }, s) as number | undefined) : null);
      const a = year(from);
      const b = year(to);
      if (a === undefined || b === undefined) return undefined;
      return a !== null && b !== null && b < a ? [b, a] : [a, b];
    }
    default:
      return parseFieldText(def, String(raw));
  }
}

/** Van wat in het formulier staat naar waarden; met een foutmelding voor het eerste veld dat niet klopt. */
export function buildAttributes(defs: FieldDef[], draft: AttributeDraft): { data: Attributes } | { error: string } {
  const data: Attributes = {};
  for (const def of defs) {
    const value = draftValue(def, draft[def.key]);
    if (value === undefined) return { error: def.type === "share" ? `${def.label}: samen 100%, en elk een deel.` : `${def.label} is niet geldig.` };
    if (value !== null) data[def.key] = value;
  }
  return { data };
}

/** Velden die kort zijn, staan per twee naast elkaar. */
const WIDE: FieldType[] = ["text", "longtext", "address", "multi", "year_range", "date_range", "bool", "share", "code", "item", "items", "people", "checklist"];
const PLACEHOLDERS: Partial<Record<FieldType, string>> = {
  year: "bv. 2019",
  money: "€ 0,00 of 45 USD",
  number: "0",
  url: "bv. colruyt.be",
  email: "naam@voorbeeld.be",
  phone: "bv. 0470 12 34 56",
  address: "Straat 1, 2000 Antwerpen",
  duration: "bv. 1 u 30 min",
};
const INPUT_MODES: Partial<Record<FieldType, "numeric" | "decimal" | "url" | "email" | "tel">> = {
  year: "numeric",
  number: "decimal",
  money: "decimal",
  url: "url",
  email: "email",
  phone: "tel",
};

/** Wat de berekeningen in het formulier tonen: de waarden die al kloppen, met de uitkomsten erbij. */
function previewData(defs: FieldDef[], draft: AttributeDraft): Attributes {
  const data: Attributes = {};
  for (const def of defs) {
    const v = draftValue(def, draft[def.key]);
    if (v !== null && v !== undefined) data[def.key] = v;
  }
  return computeLocal(defs, data);
}

/**
 * De velden van een lijst in een formulier. `access`: per veld wat je mag (enkel zien = uitgeschakeld).
 * `auto`: velden die de app invulde (etiket), zacht blauw tot je ze aanpast. `people`: wie je kan kiezen.
 */
export function FieldInputs({
  defs,
  value,
  onChange,
  access,
  people,
  meId,
  auto,
  suggestions,
}: {
  defs: FieldDef[];
  value: AttributeDraft;
  onChange: (next: AttributeDraft, key: string) => void;
  access: Record<string, Access>;
  people: Person[];
  meId: string;
  auto?: Set<string>;
  suggestions?: Record<string, string[]>;
}) {
  const set = (key: string, v: DraftValue) => onChange({ ...value, [key]: v }, key);
  const computed = useMemo(() => (defs.some((d) => d.type === "calc") ? previewData(defs, value) : {}), [defs, value]);
  return (
    <div className="attr-fields">
      {defs.map((def) => {
        const raw = value[def.key];
        const disabled = access[def.key] !== "edit";
        const invalid = draftValue(def, raw) === undefined;
        const cls = auto?.has(def.key) ? "auto" : undefined;
        const wide = WIDE.includes(def.type) ? "wide" : "";
        const label = (
          <span className="label">
            {def.label}
            {def.unit && <span className="optional"> · in {def.unit}</span>}
            {disabled && <span className="optional"> · enkel zien</span>}
          </span>
        );
        const hint = def.hint && <span className="hint">{def.hint}</span>;

        switch (def.type) {
          case "calc": {
            // Opzoeken en samenvatten rekent de app pas na het bewaren uit (op de fiche).
            if (!def.result || isLinkCalc(def)) return null;
            const v = computed[def.key];
            return (
              <div key={def.key} className="field">
                <span className="label">
                  {def.label}
                  <Tip text={def.hint || `Rekent de app uit: ${describeCalc(def, defs)}.`} label={`Hoe ${def.label} berekend wordt`} />
                </span>
                <output className="calc-output" aria-live="polite">
                  {v === undefined ? <span className="muted">—</span> : def.result === "score" ? <ScoreStars value={v as number} /> : formatFieldValue(def, v)}
                </output>
              </div>
            );
          }
          case "bool":
            return (
              <div key={def.key} className={`field ${wide}`}>
                <Switch checked={raw === true} onChange={(on) => !disabled && set(def.key, on)} label={def.label} hint={def.hint} />
              </div>
            );
          case "people":
            return (
              <div key={def.key} className={`field ${wide}`}>
                {label}
                <PeoplePicker
                  label={def.label}
                  people={people}
                  meId={meId}
                  value={Array.isArray(raw) ? (raw as string[]) : []}
                  onChange={(v) => set(def.key, v)}
                  disabled={disabled}
                />
                {hint}
              </div>
            );
          case "items":
            return (
              <div key={def.key} className={`field ${wide}`}>
                {label}
                <ItemsSelect def={def} value={Array.isArray(raw) ? (raw as string[]) : []} onChange={(v) => set(def.key, v)} disabled={disabled} />
                {hint}
              </div>
            );
          case "checklist":
            return (
              <div key={def.key} className={`field ${wide}`}>
                {label}
                <ChecklistInput
                  label={def.label}
                  value={Array.isArray(raw) ? (raw as ChecklistEntry[]) : []}
                  onChange={(v) => set(def.key, v)}
                  disabled={disabled}
                />
                {hint}
              </div>
            );
          case "interval": {
            const v = (raw ?? { n: "", unit: "month" }) as IntervalDraft;
            const many = v.n.trim() !== "1";
            return (
              <div key={def.key} className={`field ${wide}`}>
                {label}
                <div className="interval-input">
                  <span className="muted">elke</span>
                  <input
                    inputMode="numeric"
                    className={cls}
                    disabled={disabled}
                    aria-label={`${def.label}: hoeveel`}
                    placeholder="1"
                    value={v.n}
                    aria-invalid={invalid}
                    onChange={(e) => set(def.key, { ...v, n: e.target.value })}
                  />
                  <select
                    className={cls}
                    disabled={disabled}
                    aria-label={`${def.label}: eenheid`}
                    value={v.unit}
                    onChange={(e) => set(def.key, { ...v, unit: e.target.value as IntervalUnit })}
                  >
                    {Object.entries(INTERVAL_UNITS).map(([u, w]) => (
                      <option key={u} value={u}>
                        {many ? w.many : w.one}
                      </option>
                    ))}
                  </select>
                </div>
                {hint}
              </div>
            );
          }
          case "date_range": {
            const [from, to] = Array.isArray(raw) ? (raw as [string, string]) : ["", ""];
            return (
              <div key={def.key} className={`field ${wide}`}>
                {label}
                <div className="field-row">
                  <input
                    type="date"
                    className={cls}
                    disabled={disabled}
                    aria-label={`${def.label} van`}
                    value={from}
                    aria-invalid={invalid}
                    onChange={(e) => set(def.key, [e.target.value, to])}
                  />
                  <input
                    type="date"
                    className={cls}
                    disabled={disabled}
                    aria-label={`${def.label} tot`}
                    value={to}
                    aria-invalid={invalid}
                    onChange={(e) => set(def.key, [from, e.target.value])}
                  />
                </div>
                {hint}
              </div>
            );
          }
          case "score":
            return (
              <div key={def.key} className="field">
                {label}
                <ScoreInput label={def.label} value={typeof raw === "number" ? raw : null} onChange={(v) => set(def.key, v)} disabled={disabled} />
              </div>
            );
          case "share":
            return (
              <div key={def.key} className={`field ${wide}`}>
                {label}
                <SharesField
                  people={people}
                  meId={meId}
                  value={raw as SharesDraft}
                  onChange={(v) => set(def.key, v)}
                  disabled={disabled}
                  total={moneyTotal(defs, value)}
                />
                {hint}
              </div>
            );
          case "code":
            return (
              <div key={def.key} className={`field ${wide}`}>
                {label}
                <CodeInput def={def} value={raw as CodeValue | null} onChange={(v) => set(def.key, v)} disabled={disabled} auto={Boolean(cls)} />
                {hint}
              </div>
            );
          case "person":
            return (
              <label key={def.key} className="field">
                {label}
                <select className={cls} disabled={disabled} value={typeof raw === "string" ? raw : ""} onChange={(e) => set(def.key, e.target.value)}>
                  <option value="">—</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === meId ? `${p.name} (ik)` : p.name}
                    </option>
                  ))}
                </select>
                {hint}
              </label>
            );
          case "item":
            return (
              <div key={def.key} className={`field ${wide}`}>
                {label}
                <ItemSelect def={def} value={typeof raw === "string" ? raw : ""} onChange={(v) => set(def.key, v)} disabled={disabled} />
                {hint}
              </div>
            );
          case "year_range": {
            const [from, to] = Array.isArray(raw) ? (raw as [string, string]) : ["", ""];
            return (
              <div key={def.key} className={`field ${wide}`}>
                {label}
                <div className="field-row">
                  <input
                    inputMode="numeric"
                    className={cls}
                    disabled={disabled}
                    aria-label={`${def.label} vanaf`}
                    placeholder="vanaf (jaar)"
                    value={from}
                    aria-invalid={invalid}
                    onChange={(e) => set(def.key, [e.target.value, to])}
                  />
                  <input
                    inputMode="numeric"
                    className={cls}
                    disabled={disabled}
                    aria-label={`${def.label} tot`}
                    placeholder="tot (jaar)"
                    value={to}
                    aria-invalid={invalid}
                    onChange={(e) => set(def.key, [from, e.target.value])}
                  />
                </div>
                {hint}
              </div>
            );
          }
          case "select": {
            const current = typeof raw === "string" ? raw : "";
            const options = def.options ?? [];
            return (
              <label key={def.key} className="field">
                {label}
                <select className={cls} disabled={disabled} value={current} onChange={(e) => set(def.key, e.target.value)}>
                  <option value="">—</option>
                  {/* Een waarde uit een import die niet in de lijst staat, blijft kiesbaar. */}
                  {current && !options.includes(current) && <option value={current}>{current}</option>}
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          case "longtext":
            return (
              <label key={def.key} className={`field ${wide}`}>
                {label}
                <textarea
                  rows={4}
                  maxLength={8000}
                  className={cls}
                  disabled={disabled}
                  value={typeof raw === "string" ? raw : ""}
                  placeholder={def.hint}
                  onChange={(e) => set(def.key, e.target.value)}
                />
              </label>
            );
          case "money":
            return (
              <label key={def.key} className={`field ${wide}`}>
                {label}
                <MoneyInput value={typeof raw === "string" ? raw : ""} onChange={(v) => set(def.key, v)} disabled={disabled} className={cls} />
                {hint}
              </label>
            );
          default: {
            const listId = suggestions?.[def.key]?.length ? `sugg-${def.key}` : undefined;
            return (
              <label key={def.key} className={`field ${wide}`}>
                {label}
                <input
                  className={cls}
                  disabled={disabled}
                  type={def.type === "date" ? "date" : def.type === "time" ? "time" : def.type === "phone" ? "tel" : "text"}
                  inputMode={INPUT_MODES[def.type]}
                  autoCapitalize={def.type === "url" || def.type === "email" ? "none" : undefined}
                  placeholder={PLACEHOLDERS[def.type]}
                  list={listId}
                  value={typeof raw === "string" ? raw : ""}
                  aria-invalid={invalid}
                  onChange={(e) => set(def.key, e.target.value)}
                />
                {listId && (
                  <datalist id={listId}>
                    {suggestions![def.key].map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                )}
                {def.type === "multi" ? (
                  <span className="hint">Gescheiden door komma's{def.options?.length ? `, bv. ${def.options.slice(0, 2).join(", ")}` : ""}</span>
                ) : def.type === "duration" &&
                  typeof raw === "string" &&
                  raw.trim() &&
                  !invalid &&
                  formatDuration(draftValue(def, raw) as number) !== raw.trim() ? (
                  // Wat de app las: "90" wordt 1 u 30 min.
                  <span className="hint">= {formatDuration(draftValue(def, raw) as number)}</span>
                ) : (
                  hint
                )}
              </label>
            );
          }
        }
      })}
    </div>
  );
}

/** Een item uit een andere lijst kiezen (de verkoper van een wijn, de plaats van een fles). */
function ItemSelect({ def, value, onChange, disabled }: { def: FieldDef; value: string; onChange: (v: string) => void; disabled: boolean }) {
  const { data, error } = useApi<ItemRef[]>(`/items?type=${def.ref_type}`);
  const options = data ?? [];
  return (
    <>
      <select disabled={disabled || !data} value={value} onChange={(e) => onChange(e.target.value)} aria-label={def.label}>
        <option value="">{data ? (options.length ? "—" : "Nog niets om te kiezen") : "Laden…"}</option>
        {value && data && !options.some((o) => o.id === value) && <option value={value}>Verborgen</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {error && <span className="hint error">{error}</span>}
    </>
  );
}

/** Meerdere items uit een andere lijst (de ingrediënten van een recept): als chips, met een keuzelijst erbij. */
function ItemsSelect({ def, value, onChange, disabled }: { def: FieldDef; value: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  const { data, error } = useApi<ItemRef[]>(`/items?type=${def.ref_type}`);
  const options = data ?? [];
  const name = (id: string) => options.find((o) => o.id === id)?.name ?? (data ? "Verborgen" : "…");
  const rest = options.filter((o) => !value.includes(o.id));
  return (
    <>
      {value.length > 0 && (
        <ul className="ref-chips">
          {value.map((id) => (
            <li key={id} className="tag static ref-chip">
              <span>{name(id)}</span>
              {!disabled && (
                <button type="button" aria-label={`${name(id)} weghalen`} onClick={() => onChange(value.filter((x) => x !== id))}>
                  <Icon name="close" size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <select
          value=""
          disabled={!data || rest.length === 0}
          aria-label={`${def.label}: toevoegen`}
          onChange={(e) => e.target.value && onChange([...value, e.target.value])}
        >
          <option value="">{!data ? "Laden…" : rest.length ? "Toevoegen…" : options.length ? "Alles staat erbij" : "Nog niets om te kiezen"}</option>
          {rest.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      {error && <span className="hint error">{error}</span>}
    </>
  );
}

/** Personen uit het project aan- en uitvinken (wie meegaat, wie het moet doen). */
function PeoplePicker({
  label,
  people,
  meId,
  value,
  onChange,
  disabled,
}: {
  label: string;
  people: Person[];
  meId: string;
  value: string[];
  onChange: (v: string[]) => void;
  disabled: boolean;
}) {
  const unknown = value.filter((id) => !people.some((p) => p.id === id)).length;
  return (
    <div className="tag-picker" role="group" aria-label={label}>
      {people.map((p) => {
        const on = value.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            className="tag person-chip"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}
          >
            <Icon name="check" size={14} className="check" />
            <Avatar member={p} size="sm" />
            {p.id === meId ? `${p.name} (ik)` : p.name}
          </button>
        );
      })}
      {unknown > 0 && <span className="hint">+ {unknown === 1 ? "1 ander" : `${unknown} anderen`}</span>}
    </div>
  );
}

/**
 * Een takenlijst invullen: afvinken, tekst aanpassen, weghalen. Onderaan staat altijd een lege regel: wat je daar
 * typt, wordt een nieuwe taak (ook als je meteen bewaart). Enter springt naar de volgende regel.
 */
function ChecklistInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: ChecklistEntry[];
  onChange: (v: ChecklistEntry[]) => void;
  disabled: boolean;
}) {
  const list = useRef<HTMLUListElement>(null);
  const rows = disabled ? value : [...value, { text: "", done: false }];
  const update = (i: number, patch: Partial<ChecklistEntry>) => {
    const next = rows.map((e, k) => (k === i ? { ...e, ...patch } : e));
    // Een lege regel in het midden blijft staan tot je bewaart; de lege regel onderaan telt niet mee.
    onChange(next[next.length - 1]?.text || disabled ? next : next.slice(0, -1));
  };
  const focusRow = (i: number) => requestAnimationFrame(() => list.current?.querySelectorAll<HTMLInputElement>("input[type=text]")[i]?.focus());
  return (
    <ul className="checklist" ref={list}>
      {rows.map((e, i) => {
        const blank = !disabled && i === rows.length - 1;
        return (
          <li key={i} className="checklist-row" data-done={e.done}>
            <input
              type="checkbox"
              checked={e.done}
              disabled={disabled || blank}
              aria-label={`${e.text || "Taak"}: klaar`}
              onChange={(ev) => update(i, { done: ev.target.checked })}
            />
            <input
              type="text"
              value={e.text}
              disabled={disabled}
              maxLength={200}
              placeholder={blank ? (value.length ? "Nog een taak" : "Eerste taak") : undefined}
              aria-label={blank ? `${label}: nieuwe taak` : `Taak ${i + 1}`}
              onChange={(ev) => update(i, { text: ev.target.value })}
              onKeyDown={(ev) => {
                if (ev.key !== "Enter") return;
                ev.preventDefault();
                if (e.text.trim()) focusRow(i + 1);
              }}
            />
            {!disabled &&
              (blank ? (
                // Even breed als de knop erboven, zodat de regels gelijk lopen.
                <span className="btn btn-ghost btn-icon btn-sm" style={{ visibility: "hidden" }} aria-hidden="true" />
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  aria-label={`${e.text || "Taak"} weghalen`}
                  onClick={() => onChange(value.filter((_, k) => k !== i))}
                >
                  <Icon name="close" size={14} />
                </button>
              ))}
          </li>
        );
      })}
    </ul>
  );
}

/** Een barcode of QR-code: typen of scannen (met het formaat dat de scanner herkent). */
function CodeInput({
  def,
  value,
  onChange,
  disabled,
  auto,
}: {
  def: FieldDef;
  value: CodeValue | null;
  onChange: (v: CodeValue | null) => void;
  disabled: boolean;
  auto: boolean;
}) {
  const [scanning, setScanning] = useState(false);
  const format: CodeFormat = value?.format ?? def.format ?? "qr_code";
  const set = (text: string, f: CodeFormat = format) => onChange(text ? { text, format: f } : null);
  return (
    <>
      <div className="code-input">
        <input
          className={`mono ${auto ? "auto" : ""}`}
          disabled={disabled}
          value={value?.text ?? ""}
          placeholder="Nummer of tekst"
          aria-label={def.label}
          onChange={(e) => set(e.target.value)}
        />
        <select
          disabled={disabled}
          value={format}
          onChange={(e) => value && set(value.text, e.target.value as CodeFormat)}
          aria-label={`Formaat van ${def.label}`}
        >
          {Object.entries(CODE_FORMATS).map(([k, f]) => (
            <option key={k} value={k}>
              {f.label}
            </option>
          ))}
        </select>
        {!disabled && (
          <button type="button" className="btn btn-outline btn-icon" onClick={() => setScanning(true)} aria-label={`${def.label} scannen`}>
            <Icon name="scan" />
          </button>
        )}
      </div>
      {scanning && (
        <BarcodeScanner
          hint={`Scan ${def.label.toLowerCase()}`}
          onClose={() => setScanning(false)}
          onResult={(r: ScanResult) => {
            setScanning(false);
            set(r.rawValue, isCodeFormat(r.format) ? r.format : format);
          }}
        />
      )}
    </>
  );
}

let rates: Promise<Rates> | undefined;
/** De dagkoersen van de ECB, één keer per bezoek opgehaald. */
const loadRates = () => (rates ??= api.get<Rates>("/rates").catch((err) => ((rates = undefined), Promise.reject(err))));

/**
 * Een bedrag in euro. Een bedrag in een andere munt ("45 USD", "$45", "£12,50") rekent het veld bij het verlaten om
 * met de dagkoers van de ECB; eronder staat wat het was.
 */
function MoneyInput({ value, onChange, disabled, className }: { value: string; onChange: (v: string) => void; disabled: boolean; className?: string }) {
  const [note, setNote] = useState<string>();
  const foreign = parseForeign(value);

  async function convert() {
    if (!foreign || foreign.currency === "EUR") return;
    try {
      const found = await loadRates();
      const cents = toEuroCents(foreign.amount, foreign.currency, found);
      if (cents === null) return setNote(`Die munt kent de ECB niet (${foreign.currency}). Vul het bedrag in euro in.`);
      onChange(centsToInput(cents));
      setNote(`${value.trim()} = ${formatCents(cents)}, met de koers van ${formatDate(found.date)}.`);
    } catch (err) {
      setNote((err as Error).message);
    }
  }

  const invalid = Boolean(value.trim()) && !foreign && !Number.isFinite(parseEuro(value) ?? NaN);
  return (
    <>
      <input
        className={className}
        disabled={disabled}
        inputMode="text"
        placeholder={PLACEHOLDERS.money}
        value={value}
        aria-invalid={invalid}
        onBlur={convert}
        onKeyDown={(e) => {
          if (e.key === "Enter" && foreign) {
            e.preventDefault();
            convert();
          }
        }}
        onChange={(e) => {
          setNote(undefined);
          onChange(e.target.value);
        }}
      />
      {note && <span className="hint">{note}</span>}
    </>
  );
}

/** Score op 5 met halve sterren: tik een ster, tik nog eens voor een halve. */
export function ScoreInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="score-input" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className="score-star"
          disabled={disabled}
          aria-label={`${n} op 5`}
          aria-pressed={value !== null && value >= n - 0.5}
          onClick={() => onChange(value === n ? n - 0.5 : n)}
        >
          <Stars value={value ?? 0} n={n} />
        </button>
      ))}
      {value !== null && !disabled && (
        <button type="button" className="link-button" onClick={() => onChange(null)}>
          Wissen
        </button>
      )}
    </div>
  );
}

function Stars({ value, n }: { value: number; n: number }) {
  if (value >= n) return <Icon name="star" size={22} className="on" />;
  if (value >= n - 0.5) return <Icon name="starHalf" size={22} className="on" />;
  return <Icon name="star" size={22} />;
}

/** Een score als kleine sterren in een lijst of fiche. */
export function ScoreStars({ value }: { value: number }) {
  return (
    <span className="score-stars" title={`${String(value).replace(".", ",")} op 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Stars key={n} value={value} n={n} />
      ))}
    </span>
  );
}

const SHARE_MODES = [
  { value: "none" as const, label: "Niemand" },
  { value: "equal" as const, label: "Gelijk" },
  { value: "percent" as const, label: "Procent" },
  { value: "amount" as const, label: "Bedrag" },
];

/** Personen met een aandeel: tik op een avatar om iemand erbij te zetten, gelijk of in procent. */
export function SharesField({
  people,
  meId,
  value,
  onChange,
  disabled,
  total,
}: {
  people: Person[];
  meId: string;
  value: SharesDraft;
  onChange: (v: SharesDraft) => void;
  disabled?: boolean;
  /** Het bedrag (in cent) als het formulier er een heeft: in bedragen moet de verdeling daarop uitkomen. */
  total?: number | null;
}) {
  const set = (patch: Partial<SharesDraft>) => !disabled && onChange({ ...value, ...patch });
  const toggle = (id: string) => set({ people: value.people.includes(id) ? value.people.filter((x) => x !== id) : [...value.people, id] });
  const built = buildShares(value);
  // In bedragen: wat er samen staat, en wat er nog te verdelen is.
  const entered = value.mode === "amount" ? value.people.reduce((sum, id) => sum + (parseEuro(value.values[id] ?? "") || 0), 0) : 0;
  const choose = (mode: SharesDraft["mode"]) => {
    const chosen = mode !== "none" && value.people.length === 0 ? [meId] : value.people;
    // Naar bedragen met een gekend bedrag: begin met een gelijke verdeling (tot op de cent).
    const values =
      mode === "amount" && total && total > 0
        ? Object.fromEntries([...splitCents(total, chosen.map((id) => ({ person_id: id, share: 1 })))].map(([id, c]) => [id, centsToInput(c)]))
        : value.values;
    set({ mode, people: chosen, values });
  };
  return (
    <>
      <Segmented label="Verdeling" value={value.mode} options={SHARE_MODES} onChange={choose} />
      {value.mode !== "none" && (
        <>
          <div className="split-rows">
            {people.map((m) => {
              const on = value.people.includes(m.id);
              const share = on && built ? built.find((o) => o.person_id === m.id)?.share : undefined;
              return (
                <div key={m.id} className="split-row" data-off={!on}>
                  <button
                    type="button"
                    className="split-toggle"
                    disabled={disabled}
                    aria-pressed={on}
                    onClick={() => toggle(m.id)}
                    aria-label={`${m.name} ${on ? "doet mee" : "doet niet mee"}`}
                  >
                    <Avatar member={m} size="sm" />
                    <span className="split-check">
                      <Icon name="check" size={10} />
                    </span>
                  </button>
                  <span className="split-name">{m.id === meId ? `${m.name} (ik)` : m.name}</span>
                  {(value.mode === "percent" || value.mode === "amount") && on && (
                    <span className="split-input" data-unit={value.mode === "percent" ? "%" : "€"}>
                      <input
                        inputMode="decimal"
                        disabled={disabled}
                        placeholder="0"
                        value={value.values[m.id] ?? ""}
                        onChange={(e) => set({ values: { ...value.values, [m.id]: e.target.value } })}
                        aria-label={`Deel van ${m.name} ${value.mode === "percent" ? "in procent" : "in euro"}`}
                      />
                    </span>
                  )}
                  <span className="split-share">{share !== undefined ? `${String(Math.round(share * 10) / 10).replace(".", ",")}%` : on ? "—" : ""}</span>
                </div>
              );
            })}
          </div>
          {built === undefined && (
            <span className="hint split-status error" role="status">
              {value.mode === "amount" ? "Geef elk een bedrag." : "Samen 100%, en elk een deel."}
            </span>
          )}
          {built !== undefined && value.mode === "amount" && total != null && total > 0 && entered !== total && (
            <span className="hint split-status error" role="status">
              Samen {formatCents(entered)}, het bedrag is {formatCents(total)}: {entered < total ? `nog ${formatCents(total - entered)} te verdelen` : `${formatCents(entered - total)} te veel`}. Anders wordt het naar verhouding verdeeld.
            </span>
          )}
        </>
      )}
    </>
  );
}

// ---------- waarden tonen ----------

/** Velden met een eigen kaart op de fiche (niet als regel). */
const OWN_CARD: FieldType[] = ["longtext", "code", "checklist"];

/**
 * De ingevulde velden als regels in een `dl` (de lege vallen weg). Een verwijzing linkt naar dat item; een webadres,
 * e-mail, telefoon of adres opent de site, een mail, de telefoon of een kaart. `lists`: de andere lijsten (voor de
 * uitleg bij een berekening).
 */
export function AttributeRows({ defs, data, names, refs, lists }: { defs: FieldDef[]; data: Attributes; names: Names; refs: ItemRef[]; lists?: CalcList[] }) {
  return (
    <>
      {defs
        .filter((d) => data[d.key] !== undefined && !OWN_CARD.includes(d.type))
        .map((d) => (
          <div key={d.key}>
            <dt>
              {d.label}
              {d.type === "calc" && <Tip text={d.hint || `Rekent de app uit: ${describeCalc(d, defs, lists)}.`} label={`Hoe ${d.label} berekend wordt`} />}
            </dt>
            <dd>
              <FieldValueView def={d} value={data[d.key]} names={names} refs={refs} />
            </dd>
          </div>
        ))}
    </>
  );
}

function FieldValueView({ def: d, value: v, names, refs }: { def: FieldDef; value: FieldValue; names: Names; refs: ItemRef[] }) {
  const refLink = (id: string) => {
    const ref = refs.find((r) => r.id === id);
    return ref ? (
      <Link key={id} to={`/items/${ref.id}`} className="link-quiet">
        {ref.name}
      </Link>
    ) : (
      <span key={id}>{names.item(id)}</span>
    );
  };
  // Een opgezocht webadres, e-mail, ... toont zoals dat veld (met link); dagen tot blijft "over 12 dagen".
  if (d.type === "calc" && d.result && d.result !== "calc" && d.calc?.kind !== "days_until")
    return <FieldValueView def={{ ...d, type: d.result }} value={v} names={names} refs={refs} />;
  if (d.type === "score") return <ScoreStars value={v as number} />;
  if (d.type === "item" && typeof v === "string") return refLink(v);
  if (d.type === "items" && Array.isArray(v))
    return (
      <span className="ref-list">
        {(v as string[]).map((id, i) => (
          <span key={id}>
            {i > 0 && ", "}
            {refLink(id)}
          </span>
        ))}
      </span>
    );
  if (typeof v === "string" && (d.type === "url" || (d.type === "text" && WEB_ADDRESS.test(v)))) return <WebLink url={v} />;
  if (typeof v === "string" && d.type === "email") return <OutLink href={`mailto:${v}`} text={v} />;
  if (typeof v === "string" && d.type === "phone") return <OutLink href={`tel:${v.replace(/[^\d+]/g, "")}`} text={v} />;
  if (typeof v === "string" && d.type === "address")
    return <OutLink href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}`} text={v} external />;
  return <>{formatFieldValue(d, v, names)}</>;
}

/** Een mail, telefoon of kaart openen. Op een kiosk gewoon tekst. */
function OutLink({ href, text, external }: { href: string; text: string; external?: boolean }) {
  if (isKiosk) return <span>{text}</span>;
  return (
    <a href={href} className="link-quiet" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {text}
    </a>
  );
}

const WEB_ADDRESS = /^https?:\/\/\S+$/i;

/** Een webadres in een tekstveld: enkel het domein, als link. Op een kiosk gewoon tekst (geen nieuw tabblad). */
function WebLink({ url }: { url: string }) {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return <>{url}</>;
  }
  if (isKiosk) return <span>{host}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="link-quiet">
      {host}
    </a>
  );
}

/**
 * Een takenlijst op de fiche: afvinken kan meteen (zonder het formulier te openen) als je het veld mag wijzigen.
 * `onToggle` bewaart; tot dan staat het vinkje er al (en bij een fout gaat het terug).
 */
export function ChecklistView({ value, onToggle }: { value: ChecklistEntry[]; onToggle?: (next: ChecklistEntry[]) => Promise<void> }) {
  const [shown, setShown] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setShown(value);
  }
  return (
    <ul className="checklist checklist-view">
      {shown.map((e, i) => (
        <li key={i} className="checklist-row" data-done={e.done}>
          <label>
            <input
              type="checkbox"
              checked={e.done}
              disabled={!onToggle}
              onChange={(ev) => {
                const next = shown.map((x, k) => (k === i ? { ...x, done: ev.target.checked } : x));
                setShown(next);
                onToggle?.(next).catch(() => setShown(value));
              }}
            />
            <span>{e.text}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/** Een barcode of QR-code groot, om te laten scannen (aan de kassa). */
export function CodeView({ value }: { value: CodeValue }) {
  return (
    <div className="code-view">
      <Suspense fallback={<div className="barcode" aria-hidden="true" />}>
        <Barcode format={value.format} value={value.text} />
      </Suspense>
      <p className="mono code-text">{value.text}</p>
    </div>
  );
}

/** Waarden die al voorkomen in tekstvelden, als voorstel bij het typen (zelfde schrijfwijze). */
export function fieldSuggestions(defs: FieldDef[], items: { data: Attributes }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const def of defs.filter((d) => d.type === "text")) {
    const values = new Set<string>();
    for (const item of items) {
      const v = item.data[def.key];
      if (typeof v === "string") values.add(v);
    }
    if (values.size) out[def.key] = [...values].sort((a, b) => a.localeCompare(b, "nl"));
  }
  return out;
}

// ---------- de velden van een lijst samenstellen ----------

export type FieldDraft = FieldDef & { isNew?: boolean; optionsText: string; open?: boolean; sharesDraft?: SharesDraft };

export function fieldsDraft(defs: FieldDef[]): FieldDraft[] {
  return defs.map((d) => ({ ...d, optionsText: (d.options ?? []).join(", "), ...(d.type === "share" ? { sharesDraft: sharesDraft(d.default_shares) } : {}) }));
}

/**
 * Van wat in het formulier staat naar velden voor de API. Een nieuw veld krijgt een sleutel uit zijn naam (en een
 * berekening die het gebruikt, krijgt die sleutel mee). `selfId`: deze lijst ("self" bij een nieuwe).
 */
export function buildFields(drafts: FieldDraft[], selfId = "self"): { fields: FieldDef[] } | { error: string } {
  const taken = drafts.filter((d) => !d.isNew).map((d) => d.key);
  const keys = new Map<string, string>();
  for (const d of drafts) {
    const label = d.label.trim();
    if (!label) return { error: "Geef elk veld een naam (of haal het weg)." };
    const key = d.isNew ? fieldKey(label, taken) : d.key;
    taken.push(key);
    keys.set(d.key, key);
  }
  const rename = (k: string) => keys.get(k) ?? k;
  const refOf = (k: string) => {
    const ref = drafts.find((d) => d.key === k)?.ref_type;
    return ref === "self" ? selfId : ref;
  };
  const fields: FieldDef[] = [];
  for (const d of drafts) {
    const label = d.label.trim();
    const options = d.optionsText
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    if (d.type === "select" && options.length === 0) return { error: `Geef de keuzes voor ${label}, gescheiden door komma's.` };
    if ((d.type === "item" || d.type === "items") && !d.ref_type) return { error: `Kies naar welke lijst ${label} verwijst.` };
    if (d.type === "calc" && !d.calc) return { error: `Kies wat ${label} uitrekent.` };
    const shares = d.type === "share" && d.fill ? buildShares(d.sharesDraft ?? sharesDraft(undefined)) : [];
    if (shares === undefined) return { error: `${label}: de gewone verdeling is samen 100%, en elk een deel.` };
    fields.push({
      key: rename(d.key),
      label,
      type: d.type,
      ...((d.type === "select" || d.type === "multi") && options.length ? { options } : {}),
      ...((d.type === "number" || d.type === "calc") && d.unit?.trim() ? { unit: d.unit.trim() } : {}),
      ...(d.type === "item" || d.type === "items" ? { ref_type: d.ref_type } : {}),
      ...(d.type === "code" && d.format ? { format: d.format } : {}),
      ...(d.type === "calc" && d.calc ? { calc: renameCalc(d.calc, rename, refOf, selfId) } : {}),
      ...(d.column ? { column: true } : {}),
      ...(d.filter && FILTERABLE.includes(d.type) ? { filter: true } : {}),
      ...(d.required && d.type !== "calc" ? { required: true } : {}),
      ...(d.type === "date" && d.today ? { today: true } : {}),
      ...(d.product && productFits(d.product, d.type) ? { product: d.product } : {}),
      ...(d.type === "person" && d.me ? { me: true } : {}),
      ...(d.type === "share" && d.fill ? { fill: true, ...(shares.length ? { default_shares: shares } : {}) } : {}),
      ...(d.hint?.trim() ? { hint: d.hint.trim() } : {}),
    });
  }
  return { fields };
}

/**
 * De velden van een lijst: naam en soort veld op één regel; onder ⋯ de uitleg bij die soort, de keuzes, eenheid,
 * verwijzing, formaat, wat een berekening uitrekent, uitleg, kolom, filter en verplicht. `types`: de lijsten waarnaar
 * een verwijzing kan wijzen; `lists`: de lijsten waarmee een berekening kan werken (ook eronder).
 */
export function FieldsEditor({
  value,
  onChange,
  types,
  lists = types,
  selfLabel,
  selfId,
  people,
  meId,
}: {
  value: FieldDraft[];
  onChange: (v: FieldDraft[]) => void;
  types: ItemType[];
  lists?: CalcList[];
  selfLabel: string;
  /** De lijst zelf (bij bewerken); bij een nieuwe lijst verwijst "self" naar zichzelf. */
  selfId?: string;
  /** Wie in het project zit (voor een gewone verdeling), en jij. */
  people: Person[];
  meId: string;
}) {
  const counter = useRef(0);
  const self = selfId ?? "self";
  // Elke berekening meteen nakijken: haar uitkomst (welke velden een andere berekening kan gebruiken) of wat nog mist.
  const preview = useMemo(
    () =>
      previewCalcs(
        value.map((d) => ({ ...d, label: d.label.trim() || "Naamloos veld" })),
        lists.filter((l) => l.id !== self),
        self,
      ),
    [value, lists, self],
  );
  const update = (i: number, patch: Partial<FieldDraft>) => onChange(value.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const sortable = useSortable(
    value.map((f) => f.key),
    (keys) => onChange(keys.map((k) => value.find((f) => f.key === k)!)),
    (k) => value.find((f) => f.key === k)?.label || "Veld",
  );
  const add = () => {
    counter.current += 1;
    onChange([...value, { key: `nieuw_${counter.current}`, label: "", type: "text", isNew: true, optionsText: "", open: true }]);
  };

  return (
    <div className="field">
      <span className="label">Velden</span>
      {value.length > 0 && (
        <ul className="fields-editor">
          {value.map((f, i) => (
            <li key={f.key} className="fields-editor-row" data-open={f.open ?? false} {...sortable.itemProps(f.key)}>
              <div className="fields-editor-main">
                <button {...sortable.handleProps(f.key)}>
                  <Icon name="grip" size={16} />
                </button>
                <input
                  value={f.label}
                  maxLength={40}
                  placeholder="Naam van het veld"
                  aria-label="Naam van het veld"
                  onChange={(e) => update(i, { label: e.target.value })}
                />
                <select
                  value={f.type}
                  aria-label={`Soort van ${f.label || "het veld"}`}
                  onChange={(e) => update(i, { type: e.target.value as FieldType, open: true })}
                >
                  {Object.entries(FIELD_GROUPS).map(([group, groupLabel]) => (
                    <optgroup key={group} label={groupLabel}>
                      {Object.entries(FIELD_TYPES)
                        .filter(([, t]) => t.group === group)
                        .map(([type, t]) => (
                          <option key={type} value={type}>
                            {t.label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  aria-expanded={f.open ?? false}
                  aria-label={`Meer over ${f.label || "dit veld"}`}
                  onClick={() => update(i, { open: !f.open })}
                >
                  <Icon name="dots" size={15} />
                </button>
              </div>
              {f.open && (
                <div className="fields-editor-more">
                  <p className="hint">{FIELD_TYPES[f.type].hint}</p>
                  {f.type === "calc" && (
                    <CalcEditor
                      field={preview.fields[i]}
                      fields={preview.fields}
                      lists={lists.filter((l) => l.id !== self)}
                      selfId={self}
                      error={preview.errors[f.key]}
                      onChange={(calc) => update(i, { calc })}
                    />
                  )}
                  {(f.type === "select" || f.type === "multi") && (
                    <label className="field">
                      <span className="label">{f.type === "select" ? "Keuzes" : "Voorstellen"}</span>
                      <input
                        value={f.optionsText}
                        placeholder="Gescheiden door komma's, bv. Rood, Wit, Rosé"
                        onChange={(e) => update(i, { optionsText: e.target.value })}
                      />
                    </label>
                  )}
                  {(f.type === "number" || (f.type === "calc" && preview.fields[i].result === "number")) && (
                    <label className="field">
                      <span className="label">
                        Eenheid <span className="optional">· optioneel</span>
                      </span>
                      <input
                        value={f.unit ?? ""}
                        maxLength={12}
                        placeholder={f.type === "calc" ? "bv. dagen, flessen" : "bv. km, cm, kg"}
                        onChange={(e) => update(i, { unit: e.target.value })}
                      />
                    </label>
                  )}
                  {(f.type === "item" || f.type === "items") && (
                    <label className="field">
                      <span className="label">Verwijst naar</span>
                      <select value={f.ref_type ?? ""} onChange={(e) => update(i, { ref_type: e.target.value || undefined })}>
                        <option value="">Kies een lijst</option>
                        <option value={selfId ?? "self"}>{selfLabel} (deze lijst)</option>
                        {types.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.plural}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {f.type === "code" && (
                    <label className="field">
                      <span className="label">Formaat als je zelf typt</span>
                      <select value={f.format ?? "qr_code"} onChange={(e) => update(i, { format: e.target.value as CodeFormat })}>
                        {Object.entries(CODE_FORMATS).map(([k, c]) => (
                          <option key={k} value={k}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {(f.type === "text" || f.type === "number") && (
                    <label className="field">
                      <span className="label">
                        Uit productinfo <span className="optional">· optioneel</span>
                      </span>
                      <select value={f.product ?? ""} onChange={(e) => update(i, { product: (e.target.value || undefined) as ProductKey | undefined })}>
                        <option value="">Niets</option>
                        {(Object.entries(PRODUCT_KEYS) as [ProductKey, { label: string }][])
                          .filter(([key]) => productFits(key, f.type))
                          .map(([key, p]) => (
                            <option key={key} value={key}>
                              {p.label}
                            </option>
                          ))}
                      </select>
                      <span className="hint">Een barcode of een foto van een gekend product vult dit in met echte gegevens uit Open Food Facts.</span>
                    </label>
                  )}
                  <label className="field">
                    <span className="label">
                      Uitleg <span className="optional">· optioneel</span>
                    </span>
                    <input value={f.hint ?? ""} maxLength={160} placeholder="Wat hier hoort" onChange={(e) => update(i, { hint: e.target.value })} />
                  </label>
                  {f.type !== "calc" && <Switch checked={Boolean(f.required)} onChange={(on) => update(i, { required: on })} label="Verplicht" />}
                  {f.type === "date" && (
                    <Switch
                      checked={Boolean(f.today)}
                      onChange={(on) => update(i, { today: on })}
                      label="Begint met vandaag"
                      hint="Een nieuw item krijgt de datum van vandaag; je kan ze aanpassen."
                    />
                  )}
                  {f.type === "person" && (
                    <Switch
                      checked={Boolean(f.me)}
                      onChange={(on) => update(i, { me: on })}
                      label="Begint met jou"
                      hint="Een nieuw item krijgt wie het toevoegt, bv. wie betaalde."
                    />
                  )}
                  {f.type === "share" && (
                    <Switch
                      checked={Boolean(f.fill)}
                      onChange={(on) => update(i, { fill: on })}
                      label="Leeg = verdelen"
                      hint="Blijft het leeg, dan krijgt het de gewone verdeling (of gelijk over iedereen in het project)."
                    />
                  )}
                  {f.type === "share" && f.fill && (
                    <div className="field">
                      <span className="label">Gewone verdeling</span>
                      <SharesField
                        people={people}
                        meId={meId}
                        value={f.sharesDraft ?? sharesDraft(undefined)}
                        onChange={(sharesDraft) => update(i, { sharesDraft })}
                      />
                      <span className="hint">Niemand apart: gelijk over iedereen in het project.</span>
                    </div>
                  )}
                  <Switch checked={Boolean(f.column)} onChange={(on) => update(i, { column: on })} label="Als kolom in de lijst" />
                  {FILTERABLE.includes(f.type) && (
                    <Switch checked={Boolean(f.filter)} onChange={(on) => update(i, { filter: on })} label="Als filter boven de lijst" />
                  )}
                  <div className="btn-row">
                    <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => onChange(value.filter((_, k) => k !== i))}>
                      <Icon name="trash" size={14} /> Weghalen
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {sortable.status}
      <button type="button" className="btn btn-outline btn-sm" style={{ justifySelf: "start" }} onClick={add}>
        <Icon name="plus" size={15} /> Veld toevoegen
      </button>
      <span className="hint">Elk item heeft al een naam; hier komt wat je daarnaast wil bijhouden.</span>
    </div>
  );
}

// ---------- foto's ----------

/**
 * Foto van een etiket (of typeplaatje): de app leest naam en velden van de lijst.
 * `onResult` krijgt ook de foto, om bij het item te bewaren.
 */
export function LabelScanner({
  projectId,
  typeId,
  products,
  onResult,
  onProduct,
  onCreate,
}: {
  projectId: string;
  typeId: string;
  /** De lijst heeft velden uit productinfo: barcode zoeken en opzoeken in Open Food Facts. */
  products?: boolean;
  /** `original`: een PDF die gelezen werd (de eerste pagina als `photo`); die hoort als bestand bij het item. */
  onResult: (scan: LabelScan, photo: File, original: File | null) => void;
  onProduct?: (info: ProductInfo, code: string | null, photo: File | null) => void;
  /** Een verwijzing die nog niet bestaat (bv. een nieuwe winkel) toevoegen; true als het lukte. */
  onCreate?: (suggestion: NonNullable<LabelScan["create"]>[number]) => Promise<boolean>;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<{ tone: "busy" | "ok" | "partial" | "none"; text: string }>();
  const [suggestions, setSuggestions] = useState<NonNullable<LabelScan["create"]>>([]);
  // Uitleg voor de AI bij deze foto ("ik at de helft"); pas je ze achteraf aan, dan kan je opnieuw laten lezen.
  const [note, setNote] = useState("");
  const [last, setLast] = useState<{ file: File; note: string }>();
  const found = (info: ProductInfo) => setStatus({ tone: "ok", text: `Gevonden in Open Food Facts: ${productLabel(info)}. Kijk de blauwe velden even na.` });

  async function read(chosen: File | undefined) {
    if (!chosen) return;
    setSuggestions([]);
    setStatus({ tone: "busy", text: products ? "Product zoeken" : "Lezen" });
    try {
      // Een PDF (bv. een factuur): de eerste pagina lezen als foto, en de PDF zelf bewaren bij het item.
      const pdf = chosen.type === "application/pdf" ? chosen : null;
      const file = pdf ? await (await import("../pdf")).pdfFirstPage(pdf) : chosen;
      const [small, photo] = await Promise.all([prepareForReading(file), prepareUpload(file)]);
      // Eerst een barcode op de foto zelf: gratis, zonder AI, en exact. Met uitleg ("ik at de helft") leest de AI
      // toch de rest, met die barcode erbij.
      let code: string | undefined;
      if (products && onProduct) {
        const read = (await detectInImage(file).catch(() => null))?.rawValue;
        code = read && isProductCode(read) ? read : undefined;
        const info = code && !note.trim() ? await findProduct(code) : null;
        if (info) {
          onProduct(info, code!, photo);
          return found(info);
        }
      }
      const body = new FormData();
      body.set("image", small);
      body.set("type_id", typeId);
      if (note.trim()) body.set("note", note.trim());
      if (code) body.set("code", code);
      setLast({ file: chosen, note: note.trim() });
      const scan = await api.post<LabelScan>(`/projects/${projectId}/items/scan`, body);
      onResult(scan, photo, pdf);
      setSuggestions(onCreate ? (scan.create ?? []) : []);
      setStatus(
        scan.message
          ? { tone: "none", text: scan.message }
          : scan.source?.kind === "database"
            ? { tone: "ok", text: `Herkend als ${scan.source.label}: de gegevens komen uit Open Food Facts. Kijk de hoeveelheid na.` }
            : scan.source?.kind === "estimate"
              ? { tone: "partial", text: "Geschat op basis van de foto (geen gekend product gevonden). Kijk de blauwe velden na." }
              : { tone: "ok", text: "Gelezen. Kijk de blauwe velden even na." },
      );
    } catch (err) {
      setStatus({ tone: "none", text: (err as Error).message });
    }
  }

  async function scanned(code: string) {
    setScanning(false);
    setStatus({ tone: "busy", text: "Product opzoeken" });
    try {
      const info = isProductCode(code) ? await findProduct(code) : null;
      if (!info) return setStatus({ tone: "none", text: "Dit product staat (nog) niet in Open Food Facts. Vul het zelf in, of trek een foto." });
      onProduct?.(info, code, null);
      found(info);
    } catch (err) {
      setStatus({ tone: "none", text: (err as Error).message });
    }
  }

  async function create(s: NonNullable<LabelScan["create"]>[number]) {
    if (await onCreate!(s)) setSuggestions((list) => list.filter((x) => x !== s));
  }

  const input = (ref: typeof cameraRef, camera: boolean) => (
    <input
      ref={ref}
      type="file"
      accept={camera ? "image/*" : "image/*,application/pdf"}
      capture={camera ? "environment" : undefined}
      hidden
      onChange={(e) => {
        read(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  return (
    <div className="scan-buttons">
      <label className="field">
        <span className="label">
          Uitleg voor de AI <span className="optional">· optioneel</span>
        </span>
        <input
          value={note}
          maxLength={200}
          placeholder={products ? "bv. ik at de helft, met havermelk" : "bv. enkel de boodschappen, niet de tankbeurt"}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="btn-row">
        <button type="button" className="btn btn-outline" disabled={status?.tone === "busy"} onClick={() => cameraRef.current?.click()}>
          <Icon name="camera" /> Foto
        </button>
        <button type="button" className="btn btn-outline" disabled={status?.tone === "busy"} onClick={() => fileRef.current?.click()}>
          <Icon name="image" /> {products ? "Uit foto" : "Uit bestand"}
        </button>
        {products && (
          <button type="button" className="btn btn-outline" disabled={status?.tone === "busy"} onClick={() => setScanning(true)}>
            <Icon name="scan" /> Barcode
          </button>
        )}
      </div>
      {input(cameraRef, true)}
      {input(fileRef, false)}
      {scanning && <BarcodeScanner hint="Scan de barcode op de verpakking" onClose={() => setScanning(false)} onResult={(r) => scanned(r.rawValue)} />}
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
      {last && status?.tone !== "busy" && note.trim() !== last.note && (
        <button type="button" className="btn btn-outline btn-sm" style={{ justifySelf: "start" }} onClick={() => read(last.file)}>
          <Icon name="repeat" size={15} /> Opnieuw lezen met deze uitleg
        </button>
      )}
      {suggestions.map((s) => (
        <div key={s.key} className="scan-suggestion">
          <span className="hint">
            "{s.name}" staat nog niet bij {s.plural}.
          </span>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => create(s)}>
            <Icon name="plus" size={15} /> Toevoegen
          </button>
        </div>
      ))}
    </div>
  );
}

/** Een product op barcode in Open Food Facts; null als het er niet in staat. */
export async function findProduct(code: string): Promise<ProductInfo | null> {
  try {
    return await api.get<ProductInfo>(`/products/${code}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** De foto van een item bovenaan de fiche: tonen, toevoegen, vervangen of weghalen. */
export function ItemPhoto({
  item,
  canEdit,
  onChange,
}: {
  item: { id: string; name: string; photo_version: number | null };
  canEdit: boolean;
  onChange: (version: number | null, message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const body = new FormData();
      body.set("file", await prepareUpload(file));
      const { photo_version } = await api.put<{ photo_version: number }>(`/items/${item.id}/photo`, body);
      onChange(photo_version, "Foto bewaard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/items/${item.id}/photo`);
      onChange(null, "Foto weggehaald");
    } finally {
      setBusy(false);
    }
  }

  if (!item.photo_version && !canEdit) return null;
  return (
    <div className="item-photo" data-empty={!item.photo_version && canEdit}>
      {item.photo_version ? <img src={apiUrl(`/items/${item.id}/photo?v=${item.photo_version}`)} alt={`Foto van ${item.name}`} /> : null}
      {canEdit && (
        <div className="btn-row">
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="camera" size={15} /> {item.photo_version ? "Andere foto" : "Foto toevoegen"}
          </button>
          {item.photo_version ? (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={remove}>
              Weghalen
            </button>
          ) : null}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
