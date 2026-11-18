// Filteren, sorteren en kolommen kiezen, en dat bewaren als weergave (zie shared/views.ts). In een onderblad: per
// voorwaarde een wit kaartje met het veld, de vergelijking en de waarde; daaronder sorteren, kolommen en bewaren.

import { useState } from "react";
import type { FieldDef, Names } from "../../shared/fields";
import {
  canGroup,
  conditionText,
  kindOf,
  kindOfKey,
  OPS,
  OPS_FOR,
  COUNTED,
  PERIOD_UNITS,
  PERIODS,
  TAGS,
  WEEKDAYS,
  type Condition,
  type Op,
  type Period,
  type PeriodKind,
  type PeriodUnit,
  type SavedView,
  type SortKey,
  type ViewDef,
} from "../../shared/views";
import { api } from "../api";
import { Segmented, Switch } from "./Controls";
import { Icon } from "./Icon";
import { useSortable } from "./Sortable";
import { useToast } from "./Toast";

/** Zoveel kolommen hoogstens (zie `cleanView`). */
export const MAX_COLUMNS = 20;

/**
 * Welke velden als kolom staan en in welke volgorde: per veld een rij met een greep (slepen) en een schakelaar. `value`
 * leeg: zoals de lijst het instelt (`defaults`).
 */
export function ColumnsEditor({ fields, value, defaults, onChange }: { fields: FieldDef[]; value: string[] | undefined; defaults: string[]; onChange: (columns: string[] | undefined) => void }) {
  const shown = (value?.length ? value : defaults).filter((k) => fields.some((f) => f.key === k));
  const [order, setOrder] = useState(() => [...shown, ...fields.map((f) => f.key).filter((k) => !shown.includes(k))]);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const pick = (next: string[], on: Set<string>) => onChange(next.filter((k) => on.has(k)).slice(0, MAX_COLUMNS));
  const sortable = useSortable(
    order,
    (next) => {
      setOrder(next);
      pick(next, new Set(shown));
    },
    (k) => byKey.get(k)?.label ?? "Kolom",
  );
  return (
    <>
      <ul className="rows sort-list">
        {order.map((k) => {
          const f = byKey.get(k);
          if (!f) return null;
          const on = shown.includes(k);
          return (
            <li key={k} {...sortable.itemProps(k)}>
              <div className="row">
                <button {...sortable.handleProps(k)}>
                  <Icon name="grip" size={16} />
                </button>
                <span className="cell-main">
                  <Switch
                    checked={on}
                    label={f.label}
                    onChange={(yes) => {
                      const next = new Set(shown);
                      if (yes) next.add(k);
                      else next.delete(k);
                      pick(order, next);
                    }}
                  />
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {sortable.status}
    </>
  );
}

/** Waaruit je kiest bij een voorwaarde "is een van": keuzes, mensen (met jij), verwijzingen, tags. */
export type Choices = (def: FieldDef) => { value: string; label: string }[];

/** De bewaarde weergaven als pillen boven de lijst: Alles, en elke weergave. */
export function ViewChips({ views, active, onPick }: { views: SavedView[]; active: string | null; onPick: (view: SavedView | null) => void }) {
  if (!views.length) return null;
  return (
    <div className="filters" role="group" aria-label="Weergaven">
      <button type="button" className="filter" aria-pressed={!active} onClick={() => onPick(null)}>
        Alles
      </button>
      {views.map((v) => (
        <button key={v.id} type="button" className="filter" aria-pressed={active === v.id} onClick={() => onPick(v)}>
          {v.shared ? null : <Icon name="user" size={13} />} {v.name}
        </button>
      ))}
    </div>
  );
}

/** De voorwaarden die nu gelden, als pillen met een kruisje. */
export function ConditionPills({
  def,
  fields,
  names,
  tags,
  onRemove,
}: {
  def: ViewDef;
  fields: FieldDef[];
  names: Names;
  tags: { id: string; name: string }[];
  onRemove: (index: number) => void;
}) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const tagName = (id: string) => tags.find((t) => t.id === id)?.name ?? "?";
  return (
    <>
      {def.conditions.map((c, i) => {
        const field = byKey.get(c.field);
        if (!field) return null;
        return (
          <span key={`${c.field}-${i}`} className="filter active condition-pill">
            <span>
              {i > 0 && def.match === "any" ? "of " : ""}
              {conditionText(c, field, { ...names, person: (id) => (id === "me" ? "jij" : names.person(id)) }, tagName)}
            </span>
            <button type="button" className="condition-pill-remove" aria-label="Voorwaarde weghalen" onClick={() => onRemove(i)}>
              <Icon name="close" size={13} />
            </button>
          </span>
        );
      })}
    </>
  );
}

/** Een voorwaarde zonder gekozen waarde ("is een van" niets) telt niet mee. */
const complete = (c: Condition) => OPS[c.op].value !== "options" || (Array.isArray(c.value) && c.value.length > 0);
const completed = (def: ViewDef): ViewDef => ({ ...def, conditions: def.conditions.filter(complete) });

const firstValue = (op: Op, _field: FieldDef, _choices: Choices): unknown => {
  switch (OPS[op].value) {
    case "text":
      return "";
    case "number":
      return 0;
    case "between":
      return [0, 0];
    case "period":
      return { p: "this_week" } satisfies Period;
    case "week":
      return 1;
    case "weekdays":
      return [1];
    case "options":
      return [];
    default:
      return undefined;
  }
};

/** Een getal zoals je het typt (komma of punt; bedragen in euro), en terug. */
const toInput = (field: FieldDef, n: number) => String(field.type === "money" || field.result === "money" ? n / 100 : n).replace(".", ",");
const fromInput = (field: FieldDef, text: string) => {
  const n = Number(text.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return field.type === "money" || field.result === "money" ? Math.round(n * 100) : n;
};

function NumberInput({ field, value, onChange, label }: { field: FieldDef; value: number; onChange: (n: number) => void; label: string }) {
  const [text, setText] = useState(toInput(field, value));
  return (
    <input
      inputMode="decimal"
      aria-label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(fromInput(field, e.target.value));
      }}
    />
  );
}

function PeriodInput({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const counted = COUNTED.includes(value.p);
  return (
    <div className="condition-value">
      <select
        aria-label="Periode"
        value={value.p}
        onChange={(e) => {
          const p = e.target.value as PeriodKind;
          onChange({ p, ...(COUNTED.includes(p) ? { n: value.n ?? 7, ...(value.u ? { u: value.u } : {}) } : {}) });
        }}
      >
        {Object.entries(PERIODS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
      {counted && (
        <>
          <input inputMode="numeric" aria-label="Hoeveel" value={value.n ?? 7} onChange={(e) => onChange({ ...value, n: Math.max(1, Number(e.target.value) || 1) })} />
          <select aria-label="Eenheid" value={value.u ?? "day"} onChange={(e) => onChange({ ...value, u: e.target.value as PeriodUnit })}>
            {(Object.entries(PERIOD_UNITS) as [PeriodUnit, (typeof PERIOD_UNITS)[PeriodUnit]][]).map(([k, u]) => (
              <option key={k} value={k}>
                {(value.n ?? 7) === 1 ? u.one : u.many}
              </option>
            ))}
          </select>
        </>
      )}
      {value.p === "on" && <input type="date" aria-label="Datum" value={value.from ?? ""} onChange={(e) => onChange({ ...value, from: e.target.value || undefined })} />}
      {value.p === "range" && (
        <>
          <input type="date" aria-label="Van" value={value.from ?? ""} onChange={(e) => onChange({ ...value, from: e.target.value || undefined })} />
          <input type="date" aria-label="Tot" value={value.to ?? ""} onChange={(e) => onChange({ ...value, to: e.target.value || undefined })} />
        </>
      )}
    </div>
  );
}

function Toggles({ options, value, onChange, label }: { options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  if (!options.length) return <span className="hint">Nog niets om uit te kiezen.</span>;
  return (
    <div className="tag-picker" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button" className="tag" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}>
            <Icon name="check" size={14} className="check" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ConditionEditor({
  condition,
  fields,
  choices,
  onChange,
  onRemove,
}: {
  condition: Condition;
  fields: FieldDef[];
  choices: Choices;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const field = fields.find((f) => f.key === condition.field) ?? fields[0];
  const ops = OPS_FOR[kindOfKey(field.key, field)];
  const shape = OPS[condition.op].value;
  const set = (patch: Partial<Condition>) => onChange({ ...condition, ...patch });
  return (
    <li className="condition">
      <div className="condition-head">
        <select
          aria-label="Veld"
          value={field.key}
          onChange={(e) => {
            const next = fields.find((f) => f.key === e.target.value)!;
            const op = OPS_FOR[kindOfKey(next.key, next)][0];
            onChange({ field: next.key, op, value: firstValue(op, next, choices) });
          }}
        >
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Voorwaarde weghalen" onClick={onRemove}>
          <Icon name="close" size={15} />
        </button>
      </div>
      <select aria-label="Vergelijking" value={condition.op} onChange={(e) => set({ op: e.target.value as Op, value: firstValue(e.target.value as Op, field, choices) })}>
        {ops.map((op) => (
          <option key={op} value={op}>
            {OPS[op].label}
          </option>
        ))}
      </select>
      {shape === "text" && <input aria-label="Waarde" value={String(condition.value ?? "")} onChange={(e) => set({ value: e.target.value })} />}
      {shape === "number" && <NumberInput key={condition.op} field={field} value={(condition.value as number) ?? 0} label="Waarde" onChange={(n) => set({ value: n })} />}
      {shape === "between" && (
        <div className="condition-value">
          <NumberInput field={field} value={(condition.value as number[])[0]} label="Van" onChange={(n) => set({ value: [n, (condition.value as number[])[1]] })} />
          <span className="muted">en</span>
          <NumberInput field={field} value={(condition.value as number[])[1]} label="Tot" onChange={(n) => set({ value: [(condition.value as number[])[0], n] })} />
        </div>
      )}
      {shape === "period" && <PeriodInput value={condition.value as Period} onChange={(p) => set({ value: p })} />}
      {shape === "week" && (
        <select aria-label="Week van de maand" value={String(condition.value)} onChange={(e) => set({ value: Number(e.target.value) })}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              week {n} (dag {n * 7 - 6}–{Math.min(31, n * 7)})
            </option>
          ))}
          <option value={-1}>de laatste week</option>
        </select>
      )}
      {shape === "weekdays" && (
        <Toggles
          label="Dagen van de week"
          options={WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d.slice(0, 2) }))}
          value={((condition.value as number[]) ?? []).map(String)}
          onChange={(v) => set({ value: v.map(Number) })}
        />
      )}
      {shape === "options" && <Toggles label="Waarden" options={choices(field)} value={(condition.value as string[]) ?? []} onChange={(v) => set({ value: v })} />}
    </li>
  );
}

/**
 * Het onderblad Filters: voorwaarden (alle of één ervan), sorteren, kolommen, en bewaren als weergave (nieuw, of de
 * weergave die openstaat bijwerken of verwijderen).
 */
/**
 * Voorwaarden: aan alles of aan één ervan, elk veld met een vergelijking en een waarde, en + Voorwaarde. In een
 * weergave (`ViewEditor`) en bij Toevoegen uit andere lijst (welke items meegaan).
 */
export function ConditionsEditor({
  label,
  def,
  fields,
  choices,
  onChange,
}: {
  label: string;
  def: Pick<ViewDef, "match" | "conditions">;
  fields: FieldDef[];
  choices: Choices;
  onChange: (def: Pick<ViewDef, "match" | "conditions">) => void;
}) {
  const setConditions = (conditions: Condition[]) => onChange({ match: def.match, conditions });
  return (
    <>
      <div className="field">
        <span className="label">{label}</span>
        <Segmented
          label={label}
          value={def.match}
          onChange={(match) => onChange({ match, conditions: def.conditions })}
          options={[
            { value: "all", label: "Aan alles voldoet" },
            { value: "any", label: "Aan één ervan voldoet" },
          ]}
        />
      </div>
      {def.conditions.length > 0 && (
        <ul className="conditions">
          {def.conditions.map((c, i) => (
            <ConditionEditor
              key={i}
              condition={c}
              fields={fields}
              choices={choices}
              onChange={(next) => setConditions(def.conditions.map((x, k) => (k === i ? next : x)))}
              onRemove={() => setConditions(def.conditions.filter((_, k) => k !== i))}
            />
          ))}
        </ul>
      )}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => {
            const field = fields[0];
            const op = OPS_FOR[kindOfKey(field.key, field)][0];
            setConditions([...def.conditions, { field: field.key, op, value: firstValue(op, field, choices) }]);
          }}
        >
          <Icon name="plus" size={15} /> Voorwaarde
        </button>
      </div>
    </>
  );
}

export function ViewEditor({
  fields,
  columnsFrom,
  defaultColumns = [],
  initial,
  active,
  choices,
  canShare,
  listId,
  target,
  onApply,
  onSaved,
  onDeleted,
}: {
  /** Velden om op te filteren en sorteren (met naam, tags en toegevoegd op). */
  fields: FieldDef[];
  /** Velden die een kolom kunnen zijn. */
  columnsFrom: FieldDef[];
  /** De kolommen zoals de lijst ze instelt (zonder eigen keuze). */
  defaultColumns?: string[];
  initial: ViewDef;
  active: SavedView | null;
  choices: Choices;
  canShare: boolean;
  /** De lijst (null: het logboek over al je lijsten) en of het over de items of het logboek gaat. */
  listId: string | null;
  target: "items" | "logboek";
  onApply: (def: ViewDef) => void;
  onSaved: (view: SavedView) => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [def, setDef] = useState<ViewDef>(initial);
  const [name, setName] = useState(active?.name ?? "");
  const [shared, setShared] = useState(active?.shared ?? false);
  const [busy, setBusy] = useState(false);
  const sortable = fields.filter((f) => f.key !== TAGS);
  const groupable = fields.filter((f) => canGroup(f.key, f));
  const sorts = def.sort ?? [];
  const setSort = (next: SortKey[]) => setDef((d) => ({ ...d, sort: next.length ? next : undefined }));
  const dateFields = fields.filter((f) => kindOf(f) === "date" && !f.key.startsWith("_"));

  async function save(asNew: boolean) {
    if (!name.trim()) return toast("Geef de weergave een naam", "alert");
    setBusy(true);
    try {
      const view =
        active && !asNew
          ? await api.put<SavedView>(`/views/${active.id}`, { name, def: completed(def) })
          : await api.post<SavedView>("/views", { list_id: listId, target, name, shared, def: completed(def) });
      toast(active && !asNew ? "Weergave bijgewerkt" : "Weergave bewaard");
      onSaved(view);
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!active) return;
    setBusy(true);
    try {
      await api.delete(`/views/${active.id}`);
      toast("Weergave verwijderd");
      onDeleted();
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form">
      <ConditionsEditor label="Toon wat" def={def} fields={fields} choices={choices} onChange={(next) => setDef((d) => ({ ...d, match: next.match, conditions: next.conditions }))} />

      {/* Sorteren op een kolom, dan bij gelijke waarden op de volgende. */}
      <div className="field">
        <span className="label">Sorteren op</span>
        {sorts.map((sort, i) => (
          <div key={i} className="condition-value">
            <select aria-label={i ? "Dan op" : "Sorteren op"} value={sort.field} onChange={(e) => setSort(sorts.map((x, k) => (k === i ? { ...x, field: e.target.value } : x)))}>
              {sortable
                .filter((f) => f.key === sort.field || !sorts.some((x) => x.field === f.key))
                .map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
            </select>
            <select aria-label="Richting" value={sort.dir} onChange={(e) => setSort(sorts.map((x, k) => (k === i ? { ...x, dir: e.target.value as SortKey["dir"] } : x)))}>
              <option value="asc">oplopend (A–Z, klein–groot, oud–nieuw)</option>
              <option value="desc">aflopend (Z–A, groot–klein, nieuw–oud)</option>
            </select>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Sortering weghalen" onClick={() => setSort(sorts.filter((_, k) => k !== i))}>
              <Icon name="close" size={15} />
            </button>
          </div>
        ))}
        {sorts.length < 3 && sortable.some((f) => !sorts.some((x) => x.field === f.key)) && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ justifySelf: "start" }}
            onClick={() => setSort([...sorts, { field: sortable.find((f) => !sorts.some((x) => x.field === f.key))!.key, dir: "asc" }])}
          >
            <Icon name="plus" size={15} /> {sorts.length ? "Dan op" : "Sortering"}
          </button>
        )}
      </div>

      {groupable.length > 0 && (
        <label className="field">
          <span className="label">Groeperen op</span>
          <select aria-label="Groeperen op" value={def.group ?? ""} onChange={(e) => setDef((d) => ({ ...d, group: e.target.value || undefined }))}>
            <option value="">Niet groeperen</option>
            {groupable.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="field">
        <span className="label">Kolommen</span>
        <ColumnsEditor fields={columnsFrom} value={def.columns} defaults={defaultColumns} onChange={(columns) => setDef((d) => ({ ...d, columns }))} />
      </div>

      {dateFields.length > 0 && (
        <Switch
          checked={def.mode === "agenda"}
          onChange={(on) => setDef((d) => (on ? { ...d, mode: "agenda", date: d.date ?? dateFields[0].key } : { ...d, mode: undefined, date: undefined }))}
          label="Als agenda"
        />
      )}
      {def.mode === "agenda" && dateFields.length > 1 && (
        <label className="field">
          <span className="label">Volgens</span>
          <select value={def.date} onChange={(e) => setDef((d) => ({ ...d, date: e.target.value }))}>
            {dateFields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <button type="button" className="btn btn-primary btn-lg" onClick={() => onApply(completed(def))}>
        Toepassen
      </button>

      <div className="view-save">
        <span className="label">Bewaren als weergave</span>
        <label className="field">
          <span className="label">Naam</span>
          <input maxLength={40} placeholder="bv. Deze week, Te kopen, Van mij" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {canShare && !active && (
          <Switch checked={shared} onChange={setShared} label="Voor iedereen bij deze lijst" />
        )}
        <div className="btn-row">
          {active?.can_edit && (
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => save(false)}>
              Bijwerken
            </button>
          )}
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => save(true)}>
            {active ? "Als nieuwe bewaren" : "Bewaren"}
          </button>
          {active?.can_edit && (
            <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={remove}>
              <Icon name="trash" size={15} /> Verwijderen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
