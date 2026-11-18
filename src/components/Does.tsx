import { COUNTABLE, OPS, STOCK, VALUE_FROM, type Handeling, type ListColumns, type Op, type Value, type ValueFrom } from "../../shared/cells";
import type { FieldDef } from "../../shared/fields";
import { LINE_ROLES, type LineRole } from "../../shared/model";
import { Icon } from "./Icon";

/** Een handeling terwijl je ze invult (`key`: om te tekenen). */
export type DoesDraft = Handeling & { key: string };

let counter = 0;
export const doesDraft = (does: Handeling[]): DoesDraft[] => does.map((h) => ({ ...h, key: `h${counter++}` }));
/** Naar de API: een vaste waarde die een getal is ("2,5"), als getal. */
export const buildDoes = (drafts: DoesDraft[]): Handeling[] =>
  drafts.map(({ key: _k, ...h }) => {
    const v = h.value;
    if (v.from !== "fixed" || typeof v.value !== "string") return h;
    const n = Number(v.value.trim().replace(",", "."));
    return /^-?\d+([.,]\d+)?$/.test(v.value.trim()) && Number.isFinite(n) ? { ...h, value: { from: "fixed", value: n } } : h;
  });

/** Waar een kolom staat: "lijst|sleutel" ("|$voorraad": de voorraad van elke lijst). */
const columnId = (h: Pick<Handeling, "list" | "field">) => `${h.list ?? ""}|${h.field}`;

type Field = Pick<FieldDef, "key" | "label" | "type">;

/** Het type van een kolom ("stock" voor de voorraad). */
function columnType(columns: ListColumns[], h: Pick<Handeling, "list" | "field">): FieldDef["type"] | "stock" | null {
  if (h.field === STOCK) return "stock";
  return columns.find((l) => l.id === h.list)?.fields.find((f) => f.key === h.field)?.type ?? null;
}

const countable = (t: FieldDef["type"] | "stock" | null) => t === "stock" || (t !== null && COUNTABLE.includes(t));

/**
 * Wat een formulier doet met de kolommen van de dingen in zijn lijnen (shared/cells.ts): per handeling een kaartje
 * zoals een lijn, met de kolom, hoe (Zet op, Tel bij, Tel af), met wat en welke lijnen. Zie STIJLBOEK.md → Formulier.
 */
export function DoesEditor({ value, onChange, columns, fields }: { value: DoesDraft[]; onChange: (v: DoesDraft[]) => void; columns: ListColumns[]; fields: Field[] }) {
  const set = (i: number, patch: Partial<Handeling>) => onChange(value.map((h, k) => (k === i ? fit({ ...h, ...patch }, columns, fields) : h)));
  function add() {
    const list = columns[0];
    const first = list?.fields.find((f) => f.type !== "calc");
    const same = first ? fields.find((f) => f.label.trim().toLowerCase() === first.label.toLowerCase()) : undefined;
    const h: Handeling = first
      ? { rows: { from: "lines", role: "voor" }, list: list.id, field: first.key, op: "zet", value: same ? { from: "field", key: same.key } : { from: "at" } }
      : { rows: { from: "lines", role: "voor" }, list: null, field: STOCK, op: "zet", value: { from: "qty" } };
    onChange([...value, { ...h, key: `h${counter++}` }]);
  }
  return (
    <div className="field">
      <span className="label">Wat het doet</span>
      {value.length > 0 && (
        <ul className="line-rows">
          {value.map((h, i) => (
            <DoesRow key={h.key} h={h} columns={columns} fields={fields} onChange={(p) => set(i, p)} onRemove={() => onChange(value.filter((_, k) => k !== i))} />
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-outline btn-sm" style={{ justifySelf: "start" }} onClick={add}>
        <Icon name="plus" size={15} /> Handeling
      </button>
    </div>
  );
}

/** Wat niet meer past bij de gekozen kolom (tellen bij tekst, een datum optellen), recht gezet. */
function fit(h: DoesDraft, columns: ListColumns[], fields: Field[]): DoesDraft {
  const type = columnType(columns, h);
  const op: Op = countable(type) ? h.op : "zet";
  let v: Value = h.value;
  const numeric = (x: number | string) => typeof x === "number" || /^-?\d+([.,]\d+)?$/.test(x.trim());
  if (op !== "zet" && (v.from === "at" || (v.from === "field" && !COUNTABLE.includes(fields.find((f) => f.key === (v as { key: string }).key)?.type ?? "text")) || (v.from === "fixed" && !numeric(v.value)))) {
    v = type === "stock" ? { from: "qty" } : { from: "fixed", value: "1" };
  }
  return { ...h, op, value: v };
}

function DoesRow({ h, columns, fields, onChange, onRemove }: { h: DoesDraft; columns: ListColumns[]; fields: Field[]; onChange: (p: Partial<Handeling>) => void; onRemove: () => void }) {
  const type = columnType(columns, h);
  const column = h.field === STOCK ? "Voorraad" : (columns.find((l) => l.id === h.list)?.fields.find((f) => f.key === h.field)?.label ?? "Kolom");
  const counts = h.op !== "zet";
  const usable = fields.filter((f) => f.type !== "calc" && (!counts || COUNTABLE.includes(f.type)));
  const sources: ValueFrom[] = counts ? ["qty", "price", "amount", "fixed"] : ["at", "qty", "price", "amount", "fixed"];
  const valueId = h.value.from === "field" ? `field:${h.value.key}` : h.value.from;
  // Een kolom van een lijst die je niet (meer) mag aanpassen: ze blijft staan zoals ze was.
  const known = h.field === STOCK || columns.some((l) => l.id === h.list && l.fields.some((f) => f.key === h.field));
  return (
    <li className="line-row">
      <div className="line-main does-main">
        <select
          aria-label="Kolom"
          value={columnId(h)}
          onChange={(e) => {
            const [list, field] = e.target.value.split("|");
            onChange({ list: list || null, field });
          }}
        >
          {!known && <option value={columnId(h)}>{column}</option>}
          <optgroup label="Elke lijst">
            <option value={`|${STOCK}`}>Voorraad</option>
          </optgroup>
          {columns.map((l) => (
            <optgroup key={l.id} label={l.name}>
              {l.fields
                .filter((f) => f.type !== "calc")
                .map((f) => (
                  <option key={f.key} value={`${l.id}|${f.key}`}>
                    {l.name} · {f.label}
                  </option>
                ))}
              {l.stock && <option value={`${l.id}|${STOCK}`}>{l.name} · Voorraad</option>}
            </optgroup>
          ))}
        </select>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${column} weghalen`} onClick={onRemove}>
          <Icon name="close" size={15} />
        </button>
      </div>
      <div className="line-details">
        <label className="line-field">
          <span>Hoe</span>
          <select aria-label={`Hoe ${column}`} value={h.op} onChange={(e) => onChange({ op: e.target.value as Op })}>
            {(Object.keys(OPS) as Op[])
              .filter((op) => op === "zet" || countable(type))
              .map((op) => (
                <option key={op} value={op}>
                  {OPS[op].label}
                </option>
              ))}
          </select>
        </label>
        <label className="line-field">
          <span>Met</span>
          <select
            aria-label={`${column}: met`}
            value={valueId}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith("field:")) onChange({ value: { from: "field", key: v.slice(6) } });
              else if (v === "fixed") onChange({ value: { from: "fixed", value: counts || countable(type) ? "1" : "" } });
              else onChange({ value: { from: v as Exclude<ValueFrom, "field" | "fixed"> } as Value });
            }}
          >
            {usable.map((f) => (
              <option key={f.key} value={`field:${f.key}`}>
                {f.label.trim() || "Naamloos veld"}
              </option>
            ))}
            {h.value.from === "field" && !usable.some((f) => f.key === (h.value as { key: string }).key) && <option value={valueId}>Een veld dat er niet meer is</option>}
            {sources.map((s) => (
              <option key={s} value={s}>
                {VALUE_FROM[s].label}
              </option>
            ))}
          </select>
        </label>
        {h.value.from === "fixed" && (
          <label className="line-field">
            <span>Waarde</span>
            <input
              inputMode={countable(type) ? "decimal" : undefined}
              aria-label={`${column}: vaste waarde`}
              value={String(h.value.value)}
              onChange={(e) => onChange({ value: { from: "fixed", value: e.target.value } })}
            />
          </label>
        )}
        <label className="line-field">
          <span>Lijn</span>
          <select aria-label={`${column}: van de lijn`} value={h.rows.role} onChange={(e) => onChange({ rows: { from: "lines", role: e.target.value as LineRole } })}>
            {(Object.keys(LINE_ROLES) as LineRole[]).map((r) => (
              <option key={r} value={r}>
                {LINE_ROLES[r].label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </li>
  );
}
