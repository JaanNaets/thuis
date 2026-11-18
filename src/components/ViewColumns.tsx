// De kolommen van een weergave (zie STIJLBOEK.md → Weergaven en shared/viewcols.ts): per kolom een wit kaartje met het
// veld (of een formule op de kolommen ervoor) en ×, eronder wat ermee gebeurt (Tonen, Som, Gemiddelde, Kleinste,
// Grootste, Aantal, Van–tot), de naam erboven in de weergave en, over meer lijsten, per lijst die het veld niet heeft
// welk veld daar meetelt. Onderaan "+ Kolom" en "+ Formule".

import { COL_CALCS, calcsFor, colFields, newColKey, sameField, SUM_TYPES, type ColCalc, type ViewCol } from "../../shared/viewcols";
import { NAME } from "../../shared/views";
import type { FieldDef } from "../../shared/fields";
import { FormulaInput } from "./CalcEditor";
import { Icon } from "./Icon";

export function ViewColumns({
  cols,
  onChange,
  fields,
  lists,
}: {
  cols: ViewCol[];
  onChange: (cols: ViewCol[]) => void;
  /** De velden van wat je toont (van de server). */
  fields: FieldDef[];
  /** De gekozen lijsten met hun velden, om een veld per lijst te koppelen (enkel bij de items van meer lijsten). */
  lists: { id: string; name: string; fields: FieldDef[] }[];
}) {
  const defs = colFields(cols, fields);
  const set = (i: number, patch: Partial<ViewCol>) => onChange(cols.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  function remove(i: number) {
    const gone = cols[i].key;
    // Een formule die deze kolom gebruikt, gaat mee weg.
    onChange(cols.filter((c, k) => k !== i && !(c.formula && c.formula.includes(`[${gone}]`))));
  }
  function add(field: string) {
    const def = fields.find((f) => f.key === field);
    if (!def) return;
    onChange([...cols, { key: newColKey(cols, field), field, calc: "toon" }]);
  }
  const addFormula = () => onChange([...cols, { key: newColKey(cols, "f"), formula: "", calc: "toon", label: "Formule" }]);
  const label = (f: FieldDef) => (f.key === NAME ? "Naam" : f.label);
  return (
    <div className="field">
      {cols.length > 0 && (
        <ul className="line-rows">
          {cols.map((c, i) => {
            const def = defs[i];
            const title = c.label || (def ? label(def) : "Kolom");
            // Een formule rekent met de getallen in de kolommen ervoor.
            const before = cols
              .slice(0, i)
              .map((x, k) => ({ x, d: defs[k] }))
              .filter((p): p is { x: ViewCol; d: FieldDef } => p.d !== null && SUM_TYPES.includes(p.d.type))
              .map((p) => ({ ...p.d, key: p.x.key, label: p.x.label || p.d.label }));
            const source = c.field ? fields.find((f) => f.key === c.field) : undefined;
            const calcs: ColCalc[] = c.formula !== undefined ? ["toon", "sum", "avg", "min", "max"] : calcsFor(source?.type === "calc" ? source.result : source?.type);
            // Over meer lijsten: de lijsten zonder dit veld kiezen er een van hen.
            const missing = c.field && c.field !== NAME && lists.length > 1 && source ? lists.filter((l) => !l.fields.some((f) => sameField(f, source))) : [];
            return (
              <li key={c.key} className="line-row">
                <div className="line-main is-plain">
                  {c.formula !== undefined ? (
                    <input aria-label="Naam van de formule" value={c.label ?? ""} maxLength={40} placeholder="Formule" onChange={(e) => set(i, { label: e.target.value })} />
                  ) : (
                    <select
                      aria-label="Kolom"
                      value={c.field}
                      onChange={(e) => {
                        const next = fields.find((f) => f.key === e.target.value);
                        const ok = calcsFor(next?.type === "calc" ? next.result : next?.type).includes(c.calc);
                        set(i, { field: e.target.value, calc: ok ? c.calc : "toon", from: undefined });
                      }}
                    >
                      {!source && <option value={c.field}>Een veld dat er niet meer is</option>}
                      {fields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {label(f)}
                        </option>
                      ))}
                    </select>
                  )}
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${title} weghalen`} onClick={() => remove(i)}>
                    <Icon name="close" size={15} />
                  </button>
                </div>
                {c.formula !== undefined && <FormulaInput expr={c.formula} fields={before} onChange={(formula) => set(i, { formula })} />}
                <div className="line-details">
                  <label className="line-field">
                    <span>Berekening</span>
                    <select aria-label={`${title}: berekening`} value={c.calc} onChange={(e) => set(i, { calc: e.target.value as ColCalc })}>
                      {calcs.map((k) => (
                        <option key={k} value={k}>
                          {COL_CALCS[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {c.formula === undefined && (
                    <label className="line-field">
                      <span>Naam</span>
                      <input aria-label={`${title}: naam`} value={c.label ?? ""} maxLength={40} placeholder={source ? label(source) : ""} onChange={(e) => set(i, { label: e.target.value || undefined })} />
                    </label>
                  )}
                  {missing.map((l) => (
                    <label key={l.id} className="line-field">
                      <span>In {l.name}</span>
                      <select
                        aria-label={`${title} in ${l.name}`}
                        value={c.from?.[l.id] ?? ""}
                        onChange={(e) => {
                          const from = { ...(c.from ?? {}) };
                          if (e.target.value) from[l.id] = e.target.value;
                          else delete from[l.id];
                          set(i, { from: Object.keys(from).length ? from : undefined });
                        }}
                      >
                        <option value="">—</option>
                        {l.fields
                          .filter((f) => f.type !== "calc" || f.result)
                          .map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                      </select>
                    </label>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="btn-row" style={{ justifySelf: "start" }}>
        <select aria-label="Kolom toevoegen" className="map-add" value="" onChange={(e) => e.target.value && add(e.target.value)}>
          <option value="">+ Kolom</option>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {label(f)}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-outline btn-sm" onClick={addFormula}>
          <Icon name="plus" size={15} /> Formule
        </button>
      </div>
    </div>
  );
}
