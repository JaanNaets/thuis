// De lijsten van een formulier en wat het met hun kolommen doet (zie STIJLBOEK.md → Wat een formulier doet). Per groep
// lijnen (zoveel als je wil, ook met dezelfde rol of uit dezelfde lijst) een kaartje: de naam, de rol, of je een
// bestaand item kiest of een nieuwe rij maakt, één of meerdere, en per lijst al haar kolommen. Elke kolom koppel je aan een veld van het formulier (een bestaand of een nieuw, dat de kolom
// overneemt), de datum, hoeveel, de prijs, het bedrag of een vaste waarde: Zet op, en bij een getal ook Tel bij of
// Tel af. Een kolom zonder koppeling verschijnt niet. Eén veld kan zo kolommen in meer lijsten tegelijk invullen. Het
// blijven gewone groepen (`parts.groups`) en handelingen (`does`, shared/cells.ts).

import { COUNTABLE, OPS, STOCK, type Handeling, type ListColumns, type Op, type Value } from "../../shared/cells";
import { FIELD_TYPES, type FieldDef } from "../../shared/fields";
import { MAX_GROUPS, type LineGroup, type LineRole, type Parts } from "../../shared/model";
import { Segmented } from "./Controls";
import { newDoes, type DoesDraft } from "./Does";
import type { FieldDraft } from "./Fields";
import { Icon } from "./Icon";

/** Hoe je de rol van een groep lijnen kiest (ze bepaalt ook wie ze ziet: Waar of bij wie enkel met de hele gebeurtenis). */
const ROLE_CHOICES: Record<LineRole, string> = {
  voor: "Waarover",
  in: "Wat erbij komt",
  uit: "Wat eraf gaat",
  bij: "Waar of bij wie",
};
const ROLE_ORDER = Object.keys(ROLE_CHOICES) as LineRole[];

type Column = ListColumns["fields"][number];
type ColType = FieldDef["type"] | "stock";

const isText = (t: ColType) => t !== "stock" && FIELD_TYPES[t].group === "text";
const countable = (t: ColType) => t === "stock" || COUNTABLE.includes(t);
const numeric = (x: number | string) => typeof x === "number" || /^-?\d+([.,]\d+)?$/.test(x.trim());
/** Kan een veld van het formulier in deze kolom (dezelfde soort, tekst bij tekst; tellen enkel met een getal)? */
const fits = (f: Pick<FieldDef, "type">, t: ColType, op: Op) =>
  f.type !== "calc" && (op !== "zet" || t === "stock" ? COUNTABLE.includes(f.type) : f.type === t || (isText(f.type) && isText(t)));
/** Een vaste waarde typ je enkel bij tekst, een getal of een keuze. */
const fixable = (t: ColType) => t === "stock" || isText(t) || ["number", "money", "score", "year", "select"].includes(t);

/** Een veld van het formulier dat een kolom overneemt (zijn naam, soort, eenheid, keuzes en verwijzing). */
let made = 0;
export function fieldFrom(col: Pick<Column, "label" | "type" | "unit" | "options" | "ref_type">): FieldDraft {
  return {
    key: `kolom_${++made}`,
    label: col.label,
    type: col.type,
    ...(col.unit ? { unit: col.unit } : {}),
    ...(col.options?.length ? { options: col.options } : {}),
    ...(col.ref_type ? { ref_type: col.ref_type } : {}),
    isNew: true,
    optionsText: (col.options ?? []).join(", "),
  };
}

/** Is een handeling er een van deze groep (haar lijnen), op deze kolom? */
const on = (h: Handeling, group: string, list: string | null, field: string) =>
  h.rows.from === "lines" && h.rows.group === group && h.list === list && h.field === field;
const inGroup = (h: Handeling, group: string) => h.rows.from === "lines" && h.rows.group === group;
/** Een nieuwe sleutel voor een groep: willekeurig, zodat lijnen van een weggehaalde groep nooit bij een nieuwe komen. */
const newKey = (groups: LineGroup[]): string => {
  let key = "";
  while (!key || groups.some((g) => g.key === key)) key = `g${Math.random().toString(36).slice(2, 8)}`;
  return key;
};

export function FormLists({
  parts,
  onParts,
  does,
  onDoes,
  fields,
  onFields,
  columns,
}: {
  parts: Parts;
  onParts: (p: Parts) => void;
  does: DoesDraft[];
  onDoes: (d: DoesDraft[]) => void;
  fields: FieldDraft[];
  onFields: (f: FieldDraft[]) => void;
  /** De lijsten waarin je items mag aanpassen, met hun kolommen. */
  columns: ListColumns[];
}) {
  const groups = parts.groups;
  const listOf = (id: string) => columns.find((l) => l.id === id);
  const setGroups = (next: LineGroup[]) => onParts({ ...parts, groups: next });
  const setGroup = (i: number, patch: Partial<LineGroup>) =>
    setGroups(
      groups.map((g, k) => {
        if (k !== i) return g;
        const n = { ...g, ...patch };
        // Een nieuwe rij heeft minstens één lijst; haar naam uit een veld enkel met één lijst, en dan is ze één item.
        const fresh = n.fresh && n.lists.length > 0;
        const named = fresh && n.lists.length === 1 && n.name;
        const { fresh: _f, name: _n, one: _o, ...rest } = n;
        return { ...rest, ...(fresh ? { fresh: true as const } : {}), ...(named ? { name: n.name } : {}), ...(named || n.one ? { one: true as const } : {}) };
      }),
    );

  function add(id: string) {
    if (groups.length >= MAX_GROUPS) return;
    // Een rol die het formulier nog niet heeft, anders Waarover; je kiest ze erna zelf.
    const role = ROLE_ORDER.find((r) => !groups.some((g) => g.role === r)) ?? "voor";
    const l = id === "*" ? undefined : listOf(id);
    setGroups([...groups, { key: newKey(groups), role, label: l ? (l.one ?? l.name) : "", lists: l ? [l.id] : [] }]);
  }
  function remove(i: number) {
    const g = groups[i];
    setGroups(groups.filter((_, k) => k !== i));
    onDoes(does.filter((h) => !inGroup(h, g.key)));
  }
  function dropList(i: number, id: string) {
    const g = groups[i];
    setGroup(i, { lists: g.lists.filter((l) => l !== id) });
    onDoes(does.filter((h) => !(inGroup(h, g.key) && h.list === id)));
  }

  /** De naam van de nieuwe rij uit een nieuw tekstveld (dat heet zoals één item van de lijst). */
  function newName(i: number, l: ListColumns) {
    const f = fieldFrom({ label: l.one ?? "Naam", type: "text" });
    onFields([...fields, f]);
    setGroup(i, { name: f.key });
  }

  /** Een kolom koppelen (`value`), loskoppelen (null) of aan een nieuw veld dat de kolom overneemt ("new"). */
  function map(g: LineGroup, list: string | null, field: string, type: ColType, next: { op: Op; value: Value } | null | "new", col?: Column) {
    const rest = does.filter((h) => !on(h, g.key, list, field));
    const had = does.find((h) => on(h, g.key, list, field));
    if (next === null) return onDoes(rest);
    let choice = next;
    if (choice === "new") {
      if (!col) return;
      const f = fieldFrom(col);
      onFields([...fields, f]);
      choice = { op: had?.op ?? "zet", value: { from: "field", key: f.key } };
    }
    const h: Handeling = {
      rows: { from: "lines", group: g.key },
      list,
      field,
      op: countable(type) ? choice.op : "zet",
      value: choice.value,
    };
    // Op dezelfde plaats als ze stond, anders achteraan.
    onDoes(had ? does.map((x) => (x === had ? { ...x, ...h } : x)) : [...does, newDoes(h)]);
  }

  return (
    <div className="field">
      <span className="label">Lijsten</span>
      {groups.length > 0 && (
        <ul className="line-rows">
          {groups.map((g, i) => {
            // De lijsten van de groep; uit elke lijst: die waarvan het formulier al een kolom invult.
            const shown = g.lists.length ? g.lists : [...new Set(does.filter((h) => inGroup(h, g.key) && h.list && h.field !== STOCK).map((h) => h.list!))];
            // De voorraad van elke lijst: niet bij Waar of bij wie (een winkel telt geen voorraad), tenzij ze al ingevuld is.
            const stocked = (g.role !== "bij" && (!g.lists.length || g.lists.some((l) => listOf(l)?.stock))) || does.some((h) => on(h, g.key, null, STOCK));
            const fresh = Boolean(g.fresh);
            const others = columns.filter((l) => !g.lists.includes(l.id));
            const named = fresh && g.lists.length === 1;
            const title = g.label || "Groep";
            return (
              <li key={g.key} className="line-row">
                <div className="line-main is-plain">
                  <input
                    aria-label="Naam van de groep"
                    value={g.label}
                    maxLength={30}
                    placeholder="bv. Ruimte, Fles"
                    onChange={(e) => setGroup(i, { label: e.target.value })}
                  />
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${title} weghalen`} onClick={() => remove(i)}>
                    <Icon name="close" size={15} />
                  </button>
                </div>
                <div className="line-details">
                  <label className="line-field is-double">
                    <span>Rol</span>
                    <select aria-label={`${title}: rol`} value={g.role} onChange={(e) => setGroup(i, { role: e.target.value as LineRole })}>
                      {ROLE_ORDER.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_CHOICES[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {g.lists.length > 0 && (
                    <div className="line-field is-double">
                      <span>Item</span>
                      <Segmented
                        label={`${title}: item`}
                        value={fresh ? "nieuw" : "bestaand"}
                        options={[
                          { value: "bestaand", label: "Bestaand" },
                          { value: "nieuw", label: "Nieuwe rij" },
                        ]}
                        onChange={(v) =>
                          setGroup(i, {
                            fresh: v === "nieuw" ? true : undefined,
                          })
                        }
                      />
                    </div>
                  )}
                  {!(named && g.name) && (
                    <div className="line-field is-double">
                      <span>Aantal</span>
                      <Segmented
                        label={`${title}: aantal`}
                        value={g.one ? "een" : "meer"}
                        options={[
                          { value: "een", label: "Eén" },
                          { value: "meer", label: "Meerdere" },
                        ]}
                        onChange={(v) => setGroup(i, { one: v === "een" ? true : undefined })}
                      />
                    </div>
                  )}
                  {others.length > 0 && (
                    <label className="line-field is-double">
                      <span>{g.lists.length ? "Ook uit" : "Enkel uit"}</span>
                      <select
                        aria-label={`${title}: ook uit`}
                        value=""
                        onChange={(e) => e.target.value && setGroup(i, { lists: [...g.lists, e.target.value] })}
                      >
                        <option value="">—</option>
                        {others.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {stocked && (
                  <div className="map-list">
                    {!g.lists.length && <span className="map-head">Elke lijst</span>}
                    <ul className="map-rows">
                      <MapRow
                        label="Voorraad"
                        type="stock"
                        h={does.find((h) => on(h, g.key, null, STOCK))}
                        fields={fields}
                        money={parts.money}
                        start={stockStart(g.role)}
                        onChange={(n) => map(g, null, STOCK, "stock", n)}
                      />
                    </ul>
                  </div>
                )}
                {shown.map((id) => {
                  const l = listOf(id);
                  if (!l)
                    return (
                      <div key={id} className="map-list">
                        <span className="map-head">Een lijst die je niet mag aanpassen</span>
                      </div>
                    );
                  const cols = l.fields.filter((f) => f.type !== "calc");
                  return (
                    <div key={id} className="map-list">
                      <div className="map-head">
                        <span>{l.name}</span>
                        {g.lists.length > 1 && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-sm"
                            aria-label={`${l.name} weghalen uit ${title}`}
                            onClick={() => dropList(i, id)}
                          >
                            <Icon name="close" size={15} />
                          </button>
                        )}
                      </div>
                      <ul className="map-rows">
                        {named && <NameRow g={g} fields={fields} onName={(name) => setGroup(i, { name })} onNew={() => newName(i, l)} />}
                        {cols.map((c) => (
                          <MapRow
                            key={c.key}
                            label={c.label}
                            type={c.type}
                            col={c}
                            h={does.find((h) => on(h, g.key, id, c.key))}
                            fields={fields}
                            money={parts.money}
                            onChange={(n) => map(g, id, c.key, c.type, n, c)}
                          />
                        ))}
                        {does.some((h) => on(h, g.key, id, STOCK)) && (
                          <MapRow
                            label="Voorraad"
                            type="stock"
                            h={does.find((h) => on(h, g.key, id, STOCK))}
                            fields={fields}
                            money={parts.money}
                            start={stockStart(g.role)}
                            onChange={(n) => map(g, id, STOCK, "stock", n)}
                          />
                        )}
                      </ul>
                    </div>
                  );
                })}
              </li>
            );
          })}
        </ul>
      )}
      {groups.length < MAX_GROUPS && (
        <select aria-label="Lijst toevoegen" className="map-add" value="" onChange={(e) => e.target.value && add(e.target.value)}>
          <option value="">+ Lijst</option>
          {columns.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          <option value="*">Elke lijst</option>
        </select>
      )}
    </div>
  );
}

/** Wat een voorraad standaard doet: erbij telt bij, eraf telt af, de rest zet (een telling). */
const stockStart = (role: LineRole): Op => (role === "in" ? "bij" : role === "uit" ? "af" : "zet");

/** De naam van een nieuwe rij: het veld dat ze geeft, of (leeg) typ je ze bij de groep zelf. */
function NameRow({ g, fields, onName, onNew }: { g: LineGroup; fields: FieldDraft[]; onName: (key: string | undefined) => void; onNew: () => void }) {
  const texts = fields.filter((f) => isText(f.type));
  return (
    <li className={`map-row${g.name ? " is-on" : ""}`}>
      <span className="map-label">Naam</span>
      <select
        aria-label={`${g.label || "Groep"}: naam`}
        value={g.name ?? ""}
        onChange={(e) => (e.target.value === "new" ? onNew() : onName(e.target.value || undefined))}
      >
        <option value="">—</option>
        {texts.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label.trim() || "Naamloos veld"}
          </option>
        ))}
        {g.name && !texts.some((f) => f.key === g.name) && <option value={g.name}>Een veld dat er niet meer is</option>}
        <option value="new">+ Nieuw veld</option>
      </select>
    </li>
  );
}

const SOURCES: {
  from: Exclude<Value["from"], "field">;
  label: string;
  fits: (t: ColType, op: Op, money: boolean) => boolean;
}[] = [
  {
    from: "at",
    label: "De datum",
    fits: (t, op) => op === "zet" && t === "date",
  },
  {
    from: "qty",
    label: "Hoeveel",
    fits: (t) => t === "stock" || t === "number",
  },
  {
    from: "price",
    label: "De prijs",
    fits: (t, _op, money) => money && (t === "money" || t === "number"),
  },
  {
    from: "amount",
    label: "Het bedrag",
    fits: (t, _op, money) => money && (t === "money" || t === "number"),
  },
  { from: "fixed", label: "Een vaste waarde", fits: (t) => fixable(t) },
];

/**
 * Eén kolom: waarmee het formulier ze invult (— is niet), en bij een getal hoe (Zet op, Tel bij, Tel af). Een vaste
 * waarde typ je ernaast.
 */
function MapRow({
  label,
  type,
  col,
  h,
  fields,
  money,
  start = "zet",
  onChange,
}: {
  label: string;
  type: ColType;
  col?: Column;
  h: DoesDraft | undefined;
  fields: FieldDraft[];
  money: boolean;
  /** Hoe een nieuwe koppeling begint. */
  start?: Op;
  onChange: (next: { op: Op; value: Value } | null | "new") => void;
}) {
  const op: Op = h?.op ?? (countable(type) ? start : "zet");
  const usable = fields.filter((f) => fits(f, type, op));
  const sources = SOURCES.filter((s) => s.fits(type, op, money));
  const id = !h ? "" : h.value.from === "field" ? `field:${h.value.key}` : h.value.from;
  const lost = h?.value.from === "field" && !usable.some((f) => f.key === (h.value as { key: string }).key);
  const lostSource = h && h.value.from !== "field" && !sources.some((s) => s.from === h.value.from);
  function pick(v: string) {
    if (!v) return onChange(null);
    if (v === "new") return onChange("new");
    if (v.startsWith("field:")) return onChange({ op, value: { from: "field", key: v.slice(6) } });
    if (v === "fixed")
      return onChange({
        op,
        value: { from: "fixed", value: countable(type) ? "1" : "" },
      });
    onChange({ op, value: { from: v } as Value });
  }
  /** Van Zet naar tellen: wat niet telt (de datum, een tekstveld, een vaste tekst) wordt hoeveel of 1. */
  function how(next: Op) {
    if (!h) return;
    let v = h.value;
    const counts = (x: Value) =>
      x.from === "qty" ||
      x.from === "price" ||
      x.from === "amount" ||
      (x.from === "field" && COUNTABLE.includes(fields.find((f) => f.key === x.key)?.type ?? "text")) ||
      (x.from === "fixed" && numeric(x.value));
    if (next !== "zet" && !counts(v)) v = type === "stock" ? { from: "qty" } : { from: "fixed", value: "1" };
    onChange({ op: next, value: v });
  }
  return (
    <li className={`map-row${h ? " is-on" : ""}`}>
      <span className="map-label">{label}</span>
      <select aria-label={`${label}: met`} value={id} onChange={(e) => pick(e.target.value)}>
        <option value="">—</option>
        {usable.length > 0 && (
          <optgroup label="Velden">
            {usable.map((f) => (
              <option key={f.key} value={`field:${f.key}`}>
                {f.label.trim() || "Naamloos veld"}
              </option>
            ))}
          </optgroup>
        )}
        {lost && <option value={id}>Een veld dat er niet meer is</option>}
        {col && <option value="new">+ Nieuw veld</option>}
        <optgroup label="Van de gebeurtenis">
          {sources.map((s) => (
            <option key={s.from} value={s.from}>
              {s.label}
            </option>
          ))}
          {lostSource && <option value={id}>{h.value.from === "at" ? "De datum" : "Iets dat hier niet meer past"}</option>}
        </optgroup>
      </select>
      {h && (countable(type) || h.value.from === "fixed") && (
        <div className="map-how">
          {countable(type) && (
            <select aria-label={`${label}: hoe`} value={op} onChange={(e) => how(e.target.value as Op)}>
              {(Object.keys(OPS) as Op[]).map((o) => (
                <option key={o} value={o}>
                  {OPS[o].label}
                </option>
              ))}
            </select>
          )}
          {h.value.from === "fixed" && (
            <input
              aria-label={`${label}: vaste waarde`}
              inputMode={countable(type) ? "decimal" : undefined}
              value={String(h.value.value)}
              onChange={(e) =>
                onChange({
                  op,
                  value: { from: "fixed", value: e.target.value },
                })
              }
            />
          )}
        </div>
      )}
    </li>
  );
}
