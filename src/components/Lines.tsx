// De lijnen van een gebeurtenis: per lijn wat ermee gebeurt (erbij, eraf, voor, bij), het ding (of een tekst, of een
// nieuw ding in een lijst), hoeveel, de eenheid en de prijs. Zie STIJLBOEK.md → Lijnen.

import { useState } from "react";
import { LINE_ROLES, type LineRole, type ListNode, type ThingRef } from "../../shared/model";
import { UNITS } from "../../shared/units";
import { centsToInput, parseEuro } from "../format";
import { Combo, useThingOptions } from "./ItemPicker";
import { Icon } from "./Icon";

/** Een lijn terwijl je ze invult. `thing`: gekozen ding; anders `text` (en eventueel `newIn`: maak er een ding van). */
export type LineDraft = {
  key: string;
  role: LineRole;
  thing: ThingRef | null;
  text: string;
  newIn: string;
  amount: string;
  unit: string;
  price: string;
  expires: string;
  owner: string;
};

let counter = 0;
export const emptyLine = (role: LineRole, thing: ThingRef | null = null): LineDraft => ({
  key: `l${++counter}`,
  role,
  thing,
  text: "",
  newIn: "",
  amount: "",
  unit: "",
  price: "",
  expires: "",
  owner: "",
});

/** Een lijn zoals de API ze wil, of null als ze leeg is; een fout als iets niet klopt. */
export function buildLine(l: LineDraft): Record<string, unknown> | null | { error: string } {
  if (!l.thing && !l.text.trim()) return null;
  const amount = l.amount.trim() ? Number(l.amount.replace(",", ".")) : null;
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return { error: `Hoeveel bij ${l.thing?.name ?? l.text} klopt niet` };
  const price = l.price.trim() ? parseEuro(l.price) : null;
  if (price !== null && Number.isNaN(price)) return { error: `De prijs bij ${l.thing?.name ?? l.text} klopt niet` };
  return {
    role: l.role,
    ...(l.thing ? { thing_id: l.thing.id } : l.newIn ? { new_thing: { list_id: l.newIn, name: l.text.trim() } } : { text: l.text.trim() }),
    amount,
    unit: l.unit || null,
    price,
    expires: l.expires || null,
    owner: l.owner || null,
  };
}

/** Een bewaarde lijn terug als ontwerp. */
export function lineDraft(l: { role: LineRole; thing_id: string | null; text: string | null; amount: number | null; unit: string | null; price: number | null; expires: string | null; owner: string | null }, thing: ThingRef | undefined): LineDraft {
  return {
    ...emptyLine(l.role, l.thing_id && thing ? thing : null),
    text: l.thing_id ? "" : (l.text ?? ""),
    amount: l.amount !== null ? String(l.amount).replace(".", ",") : "",
    unit: l.unit ?? "",
    price: centsToInput(l.price),
    expires: l.expires ?? "",
    owner: l.owner ?? "",
  };
}

export function LinesEditor({
  lines,
  onChange,
  money,
  people,
  targets,
}: {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  /** Met een prijs per lijn (een aankoop of dienst). */
  money: boolean;
  /** Wie een lijn "enkel van" kan zijn (de mensen in de verdeling); leeg = geen keuze. */
  people: { id: string; name: string }[];
  /** Lijsten waarin een nieuw ding kan komen (waar je mag toevoegen). */
  targets: ListNode[];
}) {
  const set = (i: number, patch: Partial<LineDraft>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  return (
    <div className="field">
      <span className="label">Lijnen</span>
      <ul className="line-rows">
        {lines.map((l, i) => (
          <LineRow key={l.key} line={l} money={money} people={people} targets={targets} onChange={(p) => set(i, p)} onRemove={() => onChange(lines.filter((_, k) => k !== i))} />
        ))}
      </ul>
      <button
        type="button"
        className="btn btn-outline btn-sm"
        style={{ justifySelf: "start" }}
        onClick={() => onChange([...lines, emptyLine(lines[lines.length - 1]?.role ?? "in")])}
      >
        <Icon name="plus" size={15} /> Lijn
      </button>
    </div>
  );
}

function LineRow({
  line,
  money,
  people,
  targets,
  onChange,
  onRemove,
}: {
  line: LineDraft;
  money: boolean;
  people: { id: string; name: string }[];
  targets: ListNode[];
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
}) {
  const [typing, setTyping] = useState<string | null>(null);
  const { options, placeOf } = useThingOptions([], typing ?? "", line.thing ? [line.thing.id] : []);
  const shown = typing ?? (line.thing ? line.thing.name : line.text);
  const units = [...new Set(["", ...(line.thing?.unit ? [line.thing.unit] : []), ...UNITS, ...(line.unit ? [line.unit] : [])])];
  const free = !line.thing && line.text.trim();
  const what = line.thing?.name ?? (line.text || "lijn");
  return (
    <li className="line-row">
      <div className="line-main">
        <select className="line-role" aria-label={`Wat gebeurt er met ${what}`} value={line.role} onChange={(e) => onChange({ role: e.target.value as LineRole })}>
          {Object.entries(LINE_ROLES).map(([k, r]) => (
            <option key={k} value={k}>
              {r.label}
            </option>
          ))}
        </select>
        <Combo
          label="Wat"
          text={shown}
          options={options}
          placeOf={placeOf}
          disabled={false}
          placeholder="Typ of kies…"
          className="line-thing"
          onText={(t) => {
            setTyping(t);
            onChange({ thing: null, text: t });
          }}
          onPick={(o) => {
            setTyping(null);
            onChange({ thing: o, text: "", newIn: "", unit: line.unit || o.unit || "" });
          }}
          onLeave={() => setTyping(null)}
        />
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${what} weghalen`} onClick={onRemove}>
          <Icon name="close" size={15} />
        </button>
      </div>
      {line.role !== "bij" && (
        <div className="line-details">
          <input className="line-amount" inputMode="decimal" aria-label={`Hoeveel ${what}`} placeholder="Hoeveel" value={line.amount} onChange={(e) => onChange({ amount: e.target.value })} />
          <select className="line-unit" aria-label={`Eenheid van ${what}`} value={line.unit} onChange={(e) => onChange({ unit: e.target.value })}>
            {units.map((u) => (
              <option key={u} value={u}>
                {u || "—"}
              </option>
            ))}
          </select>
          {money && (
            <input className="line-price" inputMode="decimal" aria-label={`Prijs van ${what}`} placeholder="€" value={line.price} onChange={(e) => onChange({ price: e.target.value })} />
          )}
          {line.role === "in" && (
            <input className="line-expires" type="date" aria-label={`${what}: houdbaar tot`} title="Houdbaar tot" value={line.expires} onChange={(e) => onChange({ expires: e.target.value })} />
          )}
          {money && people.length > 1 && (
            <select className="line-owner" aria-label={`${what}: van wie`} value={line.owner} onChange={(e) => onChange({ owner: e.target.value })}>
              <option value="">Gedeeld</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  Van {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {free && (line.role === "in" || line.role === "uit") && targets.length > 0 && (
        <label className="line-new">
          <span>Nieuw in</span>
          <select aria-label={`${line.text}: nieuw in`} value={line.newIn} onChange={(e) => onChange({ newIn: e.target.value })}>
            <option value="">Enkel tekst</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </li>
  );
}
