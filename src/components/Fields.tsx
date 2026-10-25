import { lazy, Suspense, useRef, useState } from "react";
import type { Access } from "../../shared/access";
import {
  CODE_FORMATS,
  FIELD_TYPES,
  FILTERABLE,
  fieldKey,
  formatFieldValue,
  isCodeFormat,
  normalizeShares,
  parseFieldText,
  type Attributes,
  type CodeFormat,
  type CodeValue,
  type FieldDef,
  type FieldType,
  type FieldValue,
  type Names,
  type Share,
} from "../../shared/fields";
import type { ItemRef, ItemType, LabelScan, Person } from "../../shared/types";
import { api, apiUrl, useApi } from "../api";
import type { ScanResult } from "../barcode-detect";
import { isKiosk } from "../device";
import { centsToInput } from "../format";
import { prepareForReading, prepareUpload } from "../image";
import { Link } from "../router";
import { BarcodeScanner } from "./BarcodeScanner";
import { Alert, Avatar, Segmented, Switch } from "./Controls";
import { Icon } from "./Icon";
import { useSortable } from "./Sortable";

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

export type SharesDraft = { mode: "none" | "equal" | "percent"; people: string[]; values: Record<string, string> };

/** Wat in een veld staat terwijl je typt. */
type DraftValue = string | [string, string] | number | boolean | null | CodeValue | SharesDraft;
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

/** Van wat er staat naar aandelen; undefined = klopt nog niet. */
export function buildShares(draft: SharesDraft): Share[] | undefined {
  if (draft.mode === "none" || draft.people.length === 0) return [];
  if (draft.mode === "equal") return normalizeShares(draft.people.map((id) => ({ person_id: id })));
  const shares = draft.people.map((id) => ({ person_id: id, share: parsePercent(draft.values[id]) }));
  if (shares.some((s) => !(s.share > 0))) return undefined;
  const total = shares.reduce((sum, s) => sum + s.share, 0);
  return Math.abs(total - 100) > 0.05 ? undefined : shares;
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
    case "year_range": {
      const [from, to] = Array.isArray(raw) ? raw : ["", ""];
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
const WIDE: FieldType[] = ["text", "longtext", "multi", "year_range", "bool", "share", "code", "item"];
const PLACEHOLDERS: Partial<Record<FieldType, string>> = { year: "bv. 2019", money: "€ 0,00", number: "0" };

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
          case "bool":
            return (
              <div key={def.key} className={`field ${wide}`}>
                <Switch checked={raw === true} onChange={(on) => !disabled && set(def.key, on)} label={def.label} hint={def.hint} />
              </div>
            );
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
                <SharesField people={people} meId={meId} value={raw as SharesDraft} onChange={(v) => set(def.key, v)} disabled={disabled} />
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
            const [from, to] = Array.isArray(raw) ? raw : ["", ""];
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
          default: {
            const listId = suggestions?.[def.key]?.length ? `sugg-${def.key}` : undefined;
            return (
              <label key={def.key} className={`field ${wide}`}>
                {label}
                <input
                  className={cls}
                  disabled={disabled}
                  type={def.type === "date" ? "date" : "text"}
                  inputMode={def.type === "year" ? "numeric" : def.type === "number" || def.type === "money" ? "decimal" : undefined}
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
  { value: "none" as const, label: "Niemand apart" },
  { value: "equal" as const, label: "Gelijk" },
  { value: "percent" as const, label: "Procent" },
];

/** Personen met een aandeel: tik op een avatar om iemand erbij te zetten, gelijk of in procent. */
export function SharesField({
  people,
  meId,
  value,
  onChange,
  disabled,
}: {
  people: Person[];
  meId: string;
  value: SharesDraft;
  onChange: (v: SharesDraft) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<SharesDraft>) => !disabled && onChange({ ...value, ...patch });
  const toggle = (id: string) => set({ people: value.people.includes(id) ? value.people.filter((x) => x !== id) : [...value.people, id] });
  const built = buildShares(value);
  return (
    <>
      <Segmented
        label="Verdeling"
        value={value.mode}
        options={SHARE_MODES}
        onChange={(mode) => set({ mode, people: mode !== "none" && value.people.length === 0 ? [meId] : value.people })}
      />
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
                  {value.mode === "percent" && on && (
                    <span className="split-input" data-unit="%">
                      <input
                        inputMode="decimal"
                        disabled={disabled}
                        placeholder="0"
                        value={value.values[m.id] ?? ""}
                        onChange={(e) => set({ values: { ...value.values, [m.id]: e.target.value } })}
                        aria-label={`Deel van ${m.name} in procent`}
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
              Samen 100%, en elk een deel.
            </span>
          )}
        </>
      )}
    </>
  );
}

// ---------- waarden tonen ----------

/** De ingevulde velden als regels in een `dl` (de lege vallen weg). Een verwijzing linkt naar dat item. */
export function AttributeRows({ defs, data, names, refs }: { defs: FieldDef[]; data: Attributes; names: Names; refs: ItemRef[] }) {
  return (
    <>
      {defs
        .filter((d) => data[d.key] !== undefined && d.type !== "longtext" && d.type !== "code")
        .map((d) => {
          const v = data[d.key];
          const ref = d.type === "item" ? refs.find((r) => r.id === v) : undefined;
          return (
            <div key={d.key}>
              <dt>{d.label}</dt>
              <dd>
                {d.type === "score" ? (
                  <ScoreStars value={v as number} />
                ) : ref ? (
                  <Link to={`/items/${ref.id}`} className="link-quiet">
                    {ref.name}
                  </Link>
                ) : d.type === "text" && typeof v === "string" && WEB_ADDRESS.test(v) ? (
                  <WebLink url={v} />
                ) : (
                  formatFieldValue(d, v, names)
                )}
              </dd>
            </div>
          );
        })}
    </>
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

export type FieldDraft = FieldDef & { isNew?: boolean; optionsText: string; open?: boolean };

export function fieldsDraft(defs: FieldDef[]): FieldDraft[] {
  return defs.map((d) => ({ ...d, optionsText: (d.options ?? []).join(", ") }));
}

/** Van wat in het formulier staat naar velden voor de API. Een nieuw veld krijgt een sleutel uit zijn naam. */
export function buildFields(drafts: FieldDraft[]): { fields: FieldDef[] } | { error: string } {
  const taken = drafts.filter((d) => !d.isNew).map((d) => d.key);
  const fields: FieldDef[] = [];
  for (const d of drafts) {
    const label = d.label.trim();
    if (!label) return { error: "Geef elk veld een naam (of haal het weg)." };
    const options = d.optionsText
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    if (d.type === "select" && options.length === 0) return { error: `Geef de keuzes voor ${label}, gescheiden door komma's.` };
    if (d.type === "item" && !d.ref_type) return { error: `Kies naar welke lijst ${label} verwijst.` };
    const key = d.isNew ? fieldKey(label, taken) : d.key;
    taken.push(key);
    fields.push({
      key,
      label,
      type: d.type,
      ...((d.type === "select" || d.type === "multi") && options.length ? { options } : {}),
      ...(d.type === "number" && d.unit?.trim() ? { unit: d.unit.trim() } : {}),
      ...(d.type === "item" ? { ref_type: d.ref_type } : {}),
      ...(d.type === "code" && d.format ? { format: d.format } : {}),
      ...(d.column ? { column: true } : {}),
      ...(d.filter && FILTERABLE.includes(d.type) ? { filter: true } : {}),
      ...(d.required ? { required: true } : {}),
      ...(d.hint?.trim() ? { hint: d.hint.trim() } : {}),
    });
  }
  return { fields };
}

/**
 * De velden van een lijst: naam en soort veld op één regel; onder ⋯ de keuzes, eenheid, verwijzing, formaat, uitleg,
 * kolom, filter, verplicht en de volgorde. `types`: de lijsten waarnaar een verwijzing kan wijzen.
 */
export function FieldsEditor({
  value,
  onChange,
  types,
  selfLabel,
  selfId,
}: {
  value: FieldDraft[];
  onChange: (v: FieldDraft[]) => void;
  types: ItemType[];
  selfLabel: string;
  /** De lijst zelf (bij bewerken); bij een nieuwe lijst verwijst "self" naar zichzelf. */
  selfId?: string;
}) {
  const counter = useRef(0);
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
                  {Object.entries(FIELD_TYPES).map(([type, t]) => (
                    <option key={type} value={type}>
                      {t.label}
                    </option>
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
                  {f.type === "number" && (
                    <label className="field">
                      <span className="label">
                        Eenheid <span className="optional">· optioneel</span>
                      </span>
                      <input value={f.unit ?? ""} maxLength={12} placeholder="bv. km, cm, kg" onChange={(e) => update(i, { unit: e.target.value })} />
                    </label>
                  )}
                  {f.type === "item" && (
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
                  <label className="field">
                    <span className="label">
                      Uitleg <span className="optional">· optioneel</span>
                    </span>
                    <input value={f.hint ?? ""} maxLength={160} placeholder="Wat hier hoort" onChange={(e) => update(i, { hint: e.target.value })} />
                  </label>
                  <Switch checked={Boolean(f.required)} onChange={(on) => update(i, { required: on })} label="Verplicht" />
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
export function LabelScanner({ projectId, typeId, onResult }: { projectId: string; typeId: string; onResult: (scan: LabelScan, photo: File) => void }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ tone: "busy" | "ok" | "none"; text: string }>();

  async function read(file: File | undefined) {
    if (!file) return;
    setStatus({ tone: "busy", text: "Etiket lezen" });
    try {
      const [small, photo] = await Promise.all([prepareForReading(file), prepareUpload(file)]);
      const body = new FormData();
      body.set("image", small);
      body.set("type_id", typeId);
      const scan = await api.post<LabelScan>(`/projects/${projectId}/items/scan`, body);
      onResult(scan, photo);
      setStatus(scan.message ? { tone: "none", text: scan.message } : { tone: "ok", text: "Gelezen. Kijk de blauwe velden even na." });
    } catch (err) {
      setStatus({ tone: "none", text: (err as Error).message });
    }
  }

  const input = (ref: typeof cameraRef, camera: boolean) => (
    <input
      ref={ref}
      type="file"
      accept="image/*"
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
      <div className="btn-row">
        <button type="button" className="btn btn-outline" disabled={status?.tone === "busy"} onClick={() => cameraRef.current?.click()}>
          <Icon name="camera" /> Foto van het etiket
        </button>
        <button type="button" className="btn btn-outline" disabled={status?.tone === "busy"} onClick={() => fileRef.current?.click()}>
          <Icon name="image" /> Uit foto
        </button>
      </div>
      {input(cameraRef, true)}
      {input(fileRef, false)}
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
    </div>
  );
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
    <div className="item-photo">
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
