// Filteren, sorteren en kolommen kiezen, en dat bewaren als weergave (zie shared/views.ts). In een onderblad: per
// voorwaarde een wit kaartje met het veld, de vergelijking en de waarde; daaronder sorteren, kolommen en bewaren.

import { useState } from "react";
import type { FieldDef, Names } from "../../shared/fields";
import type { Tag } from "../../shared/types";
import {
  conditionText,
  kindOf,
  kindOfKey,
  OPS,
  OPS_FOR,
  PERIODS,
  TAGS,
  WEEKDAYS,
  type Condition,
  type Op,
  type Period,
  type PeriodKind,
  type SavedView,
  type SortKey,
  type ViewDef,
} from "../../shared/views";
import { api } from "../api";
import { Segmented, Switch } from "./Controls";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

/** Waaruit je kiest bij een voorwaarde "is een van": keuzes, mensen (met jij), verwijzingen, tags. */
export type Choices = (def: FieldDef) => { value: string; label: string }[];

/** De bewaarde weergaven als pillen boven de lijst: Alles, en elke weergave. */
export function ViewChips({ views, active, onPick }: { views: SavedView[]; active: string | null; onPick: (view: SavedView | null) => void }) {
  if (!views.length) return null;
  return (
    <div className="filters view-chips" role="group" aria-label="Weergaven">
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
  tags: Tag[];
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
  return (
    <div className="condition-value">
      <select aria-label="Periode" value={value.p} onChange={(e) => onChange({ p: e.target.value as PeriodKind, ...(e.target.value.endsWith("_days") ? { n: 7 } : {}) })}>
        {Object.entries(PERIODS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
      {(value.p === "last_days" || value.p === "next_days") && (
        <input inputMode="numeric" aria-label="Hoeveel dagen" value={value.n ?? 7} onChange={(e) => onChange({ ...value, n: Math.max(1, Number(e.target.value) || 1) })} />
      )}
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
export function ViewEditor({
  fields,
  columnsFrom,
  initial,
  active,
  choices,
  canShare,
  projectId,
  typeId,
  onApply,
  onSaved,
  onDeleted,
}: {
  /** Velden om op te filteren en sorteren (met naam, tags en toegevoegd op). */
  fields: FieldDef[];
  /** Velden die een kolom kunnen zijn. */
  columnsFrom: FieldDef[];
  initial: ViewDef;
  active: SavedView | null;
  choices: Choices;
  canShare: boolean;
  projectId: string;
  typeId: string;
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
  const sort = def.sort?.[0];
  const setConditions = (conditions: Condition[]) => setDef((d) => ({ ...d, conditions }));
  const dateFields = fields.filter((f) => kindOf(f) === "date" && !f.key.startsWith("_"));

  async function save(asNew: boolean) {
    if (!name.trim()) return toast("Geef de weergave een naam", "alert");
    setBusy(true);
    try {
      const view =
        active && !asNew
          ? await api.put<SavedView>(`/views/${active.id}`, { name, def: completed(def) })
          : await api.post<SavedView>(`/projects/${projectId}/views`, { type_id: typeId, name, shared, def: completed(def) });
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
      <div className="field">
        <span className="label">Toon wat</span>
        <Segmented
          label="Toon wat"
          value={def.match}
          onChange={(match) => setDef((d) => ({ ...d, match }))}
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

      <div className="field">
        <span className="label">Sorteren op</span>
        <div className="condition-value">
          <select
            aria-label="Sorteren op"
            value={sort?.field ?? ""}
            onChange={(e) => setDef((d) => ({ ...d, sort: e.target.value ? [{ field: e.target.value, dir: sort?.dir ?? "asc" } satisfies SortKey] : undefined }))}
          >
            <option value="">Zoals de lijst het doet</option>
            {sortable.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          {sort && (
            <select aria-label="Richting" value={sort.dir} onChange={(e) => setDef((d) => ({ ...d, sort: [{ field: sort.field, dir: e.target.value as SortKey["dir"] }] }))}>
              <option value="asc">oplopend (A–Z, klein–groot, oud–nieuw)</option>
              <option value="desc">aflopend (Z–A, groot–klein, nieuw–oud)</option>
            </select>
          )}
        </div>
      </div>

      <div className="field">
        <span className="label">
          Kolommen <span className="optional">· leeg = zoals de lijst</span>
        </span>
        <Toggles
          label="Kolommen"
          options={columnsFrom.map((f) => ({ value: f.key, label: f.label }))}
          value={def.columns ?? []}
          onChange={(columns) => setDef((d) => ({ ...d, columns: columns.length ? columns.slice(0, 6) : undefined }))}
        />
      </div>

      {dateFields.length > 0 && (
        <Switch
          checked={def.mode === "agenda"}
          onChange={(on) => setDef((d) => (on ? { ...d, mode: "agenda", date: d.date ?? dateFields[0].key } : { ...d, mode: undefined, date: undefined }))}
          label="Als agenda"
          hint={`Per dag in een kalender, volgens ${dateFields[0].label.toLowerCase()}.`}
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
          <Switch checked={shared} onChange={setShared} label="Voor iedereen in dit project" hint="Anders zie enkel jij ze." />
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
