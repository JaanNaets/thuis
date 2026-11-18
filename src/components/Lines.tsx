// De lijnen van een gebeurtenis, per groep van haar formulier (Wat, Waar, Ruimte): het ding (of een tekst, of een
// nieuw ding in een lijst), hoeveel, de eenheid en de prijs, elk met een label. Zie STIJLBOEK.md → Lijnen.

import { useState } from "react";
import { stockOp, type Op } from "../../shared/cells";
import { groupOf, type KindInfo, type LineGroup, type LineRole, type ListNode, type ThingRef } from "../../shared/model";
import { fold } from "../../shared/parse";
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
  /** De naam op het kasticket: kies of maak je een ding met een andere naam (Go-tan wok → Noedels), dan onthoudt dat ding hem. */
  ticket: string;
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
  ticket: "",
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
    ...(l.thing
      ? { thing_id: l.thing.id }
      : l.newIn
        ? { new_thing: { list_id: l.newIn, name: l.text.trim(), ...(renamed(l) ? { alias: l.ticket } : {}) } }
        : { text: l.text.trim() }),
    amount,
    unit: l.unit || null,
    price,
    expires: l.expires || null,
    owner: l.owner || null,
  };
}

/** Heet de lijn anders dan op het kasticket (dan onthoudt het ding de naam op het ticket)? */
export const renamed = (l: LineDraft): boolean => Boolean(l.ticket && fold(l.ticket) !== fold(l.thing?.name ?? l.text));

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

/** De groepen om te tonen: die van het formulier, en een rol die een bewaarde lijn heeft maar het formulier niet. */
export function shownGroups(kind: Pick<KindInfo, "parts">, lines: Pick<LineDraft, "role">[]): LineGroup[] {
  const extra = [...new Set(lines.map((l) => l.role))].filter((r) => !kind.parts.groups.some((g) => g.role === r));
  return [...kind.parts.groups, ...extra.map((r) => groupOf(kind, r))];
}

/**
 * De lijnen, per groep van het formulier (Wat, Waar, Ruimte): de naam van de groep erboven, de lijnen eronder en
 * "+ Lijn" (of "+ Ruimte" bij een groep uit één lijst). Een groep uit één lijst kiest enkel daaruit.
 */
export function LinesEditor({
  kind,
  lines,
  onChange,
  people,
  targets,
  defaultNew,
}: {
  kind: Pick<KindInfo, "parts" | "does">;
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  /** Wie een lijn "enkel van" kan zijn (de mensen in de verdeling); leeg = geen keuze. */
  people: { id: string; name: string }[];
  /** Lijsten waarin een nieuw ding kan komen (waar je mag toevoegen). */
  targets: ListNode[];
  /** Waar iets nieuws dat erbij komt standaard in komt (de lijst waar je vandaan kwam); leeg: enkel tekst. */
  defaultNew?: string;
}) {
  const set = (key: string, patch: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const groups = shownGroups(kind, lines);
  return (
    <>
      {groups.map((g) => {
        const own = lines.filter((l) => l.role === g.role);
        const op = stockOp(kind.does, g.role);
        // Hoeveel doet ertoe als de lijn de voorraad verandert of het formulier ermee iets invult.
        const counted = op !== null || kind.does.some((h) => h.rows.from === "lines" && h.rows.role === g.role && h.value.from === "qty");
        const only = g.list ? targets.find((t) => t.id === g.list) : undefined;
        // Iets nieuws: in de lijst van de groep, anders in de lijst waar je vandaan kwam (een wijn in Wijnen).
        const startIn = g.list ? (only ? g.list : "") : defaultNew && targets.some((t) => t.id === defaultNew) ? defaultNew : "";
        return (
          <div key={g.role} className="field">
            <span className="label">{g.label}</span>
            {own.length > 0 && (
              <ul className="line-rows">
                {own.map((l) => (
                  <LineRow
                    key={l.key}
                    line={l}
                    group={g}
                    op={op}
                    counted={counted}
                    money={kind.parts.money}
                    people={people}
                    targets={g.list ? targets.filter((t) => t.id === g.list) : targets}
                    startIn={startIn}
                    onChange={(p) => set(l.key, p)}
                    onRemove={() => onChange(lines.filter((x) => x.key !== l.key))}
                  />
                ))}
              </ul>
            )}
            <button type="button" className="btn btn-outline btn-sm" style={{ justifySelf: "start" }} onClick={() => onChange([...lines, emptyLine(g.role)])}>
              <Icon name="plus" size={15} /> {only?.one ?? "Lijn"}
            </button>
          </div>
        );
      })}
    </>
  );
}

function LineRow({
  line,
  group,
  op,
  counted,
  money,
  people,
  targets,
  startIn,
  onChange,
  onRemove,
}: {
  line: LineDraft;
  group: LineGroup;
  /** Wat de lijn met de voorraad van haar ding doet. */
  op: Op | null;
  /** Hoeveel en de eenheid doen ertoe. */
  counted: boolean;
  money: boolean;
  people: { id: string; name: string }[];
  targets: ListNode[];
  startIn: string;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
}) {
  const [typing, setTyping] = useState<string | null>(null);
  const { options, placeOf } = useThingOptions(group.list ? [group.list] : [], typing ?? "", line.thing ? [line.thing.id] : []);
  const shown = typing ?? (line.thing ? line.thing.name : line.text);
  const units = [...new Set(["", ...(line.thing?.unit ? [line.thing.unit] : []), ...UNITS, ...(line.unit ? [line.unit] : [])])];
  const free = !line.thing && line.text.trim();
  const what = line.thing?.name ?? (line.text || "lijn");
  return (
    <li className="line-row">
      <div className="line-main is-plain">
        <Combo
          label={group.label}
          text={shown}
          options={options}
          placeOf={placeOf}
          disabled={false}
          placeholder="Typ een naam…"
          className="line-thing"
          typeFirst
          onText={(t) => {
            setTyping(t);
            // Iets nieuws dat erbij komt: standaard in de lijst van de groep, of waar je vandaan kwam (een wijn in Wijnen).
            const fresh = !line.text && !line.newIn && t.trim() && (op === "bij" || group.list) && startIn;
            onChange({ thing: null, text: t, ...(fresh ? { newIn: startIn } : {}) });
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
      {renamed(line) && <p className="line-ticket">Op het ticket: {line.ticket}</p>}
      {line.role !== "bij" && (counted || money || line.amount) && (
        <div className="line-details">
          {(counted || line.amount) && (
            <>
              <label className="line-field">
                <span>Hoeveel</span>
                <input inputMode="decimal" aria-label={`Hoeveel ${what}`} value={line.amount} onChange={(e) => onChange({ amount: e.target.value })} />
              </label>
              <label className="line-field">
                <span>Eenheid</span>
                <select aria-label={`Eenheid van ${what}`} value={line.unit} onChange={(e) => onChange({ unit: e.target.value })}>
                  {units.map((u) => (
                    <option key={u} value={u}>
                      {u || "—"}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {money && (
            <label className="line-field">
              <span>Prijs</span>
              <input inputMode="decimal" aria-label={`Prijs van ${what}`} placeholder="€" value={line.price} onChange={(e) => onChange({ price: e.target.value })} />
            </label>
          )}
          {op === "bij" && (
            <label className="line-field">
              <span>Houdbaar tot</span>
              <input type="date" aria-label={`${what}: houdbaar tot`} value={line.expires} onChange={(e) => onChange({ expires: e.target.value })} />
            </label>
          )}
          {money && people.length > 1 && (
            <label className="line-field">
              <span>Van wie</span>
              <select aria-label={`${what}: van wie`} value={line.owner} onChange={(e) => onChange({ owner: e.target.value })}>
                <option value="">Samen</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {free && (op === "bij" || op === "af" || group.list) && targets.length > 0 && (
        <label className="line-field">
          <span>Nieuw in</span>
          <select aria-label={`${line.text}: nieuw in`} value={line.newIn} onChange={(e) => onChange({ newIn: e.target.value })}>
            <option value="">Geen lijst</option>
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
