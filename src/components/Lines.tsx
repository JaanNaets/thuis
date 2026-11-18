// De lijnen van een gebeurtenis, per groep van haar formulier (Wat, Waar, Ruimte): het item (of een tekst, of een
// nieuw item in een lijst), hoeveel, de eenheid en de prijs, elk met een label. Zie STIJLBOEK.md → Lijnen.

import { useState } from "react";
import { stockOp, type Op } from "../../shared/cells";
import { groupOf, type KindInfo, type LineGroup, type LineRole, type ListNode, type ItemRef } from "../../shared/model";
import { fold } from "../../shared/parse";
import { UNITS } from "../../shared/units";
import { centsToInput, parseEuro } from "../format";
import { Combo, useListItems } from "./ItemPicker";
import { Icon } from "./Icon";

/** Een lijn terwijl je ze invult. `item`: gekozen item; anders `text` (en eventueel `newIn`: maak er een item van). */
export type LineDraft = {
  key: string;
  role: LineRole;
  item: ItemRef | null;
  text: string;
  newIn: string;
  amount: string;
  unit: string;
  price: string;
  expires: string;
  owner: string;
  /** De naam op het kasticket: kies of maak je een item met een andere naam (Go-tan wok → Noedels), dan onthoudt dat item hem. */
  ticket: string;
};

let counter = 0;
export const emptyLine = (role: LineRole, item: ItemRef | null = null): LineDraft => ({
  key: `l${++counter}`,
  role,
  item,
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
  if (!l.item && !l.text.trim()) return null;
  const amount = l.amount.trim() ? Number(l.amount.replace(",", ".")) : null;
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return { error: `Hoeveel bij ${l.item?.name ?? l.text} klopt niet` };
  const price = l.price.trim() ? parseEuro(l.price) : null;
  if (price !== null && Number.isNaN(price)) return { error: `De prijs bij ${l.item?.name ?? l.text} klopt niet` };
  return {
    role: l.role,
    ...(l.item
      ? { item_id: l.item.id }
      : l.newIn
        ? { new_item: { list_id: l.newIn, name: l.text.trim(), ...(renamed(l) ? { alias: l.ticket } : {}) } }
        : { text: l.text.trim() }),
    amount,
    unit: l.unit || null,
    price,
    expires: l.expires || null,
    owner: l.owner || null,
  };
}

/** Heet de lijn anders dan op het kasticket (dan onthoudt het item de naam op het ticket)? */
export const renamed = (l: LineDraft): boolean => Boolean(l.ticket && fold(l.ticket) !== fold(l.item?.name ?? l.text));

/** Een bewaarde lijn terug als ontwerp. */
export function lineDraft(
  l: {
    role: LineRole;
    item_id: string | null;
    text: string | null;
    amount: number | null;
    unit: string | null;
    price: number | null;
    expires: string | null;
    owner: string | null;
  },
  item: ItemRef | undefined,
): LineDraft {
  return {
    ...emptyLine(l.role, l.item_id && item ? item : null),
    text: l.item_id ? "" : (l.text ?? ""),
    amount: l.amount !== null ? String(l.amount).replace(".", ",") : "",
    unit: l.unit ?? "",
    price: centsToInput(l.price),
    expires: l.expires ?? "",
    owner: l.owner ?? "",
  };
}

/**
 * De groepen om te tonen: die van het formulier, en een rol die een bewaarde lijn heeft maar het formulier niet. Een
 * nieuwe rij met haar naam uit een veld niet: die lijn maakt het bewaren (`namedLines`).
 */
export function shownGroups(kind: Pick<KindInfo, "parts">, lines: Pick<LineDraft, "role">[]): LineGroup[] {
  const extra = [...new Set(lines.map((l) => l.role))].filter((r) => !kind.parts.groups.some((g) => g.role === r));
  return [...kind.parts.groups.filter((g) => !(g.fresh && g.name)), ...extra.map((r) => groupOf(kind, r))];
}

/** De lijnen waarmee een nieuwe gebeurtenis begint: één lege in de eerste groep en in elke groep van één item. */
export function startLines(kind: Pick<KindInfo, "parts">, main: LineRole): LineDraft[] {
  return shownGroups(kind, [])
    .filter((g) => g.role === main || g.one)
    .map((g) => ({ ...emptyLine(g.role), newIn: g.fresh ? g.lists[0] : "" }));
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
  onPick,
}: {
  kind: Pick<KindInfo, "parts" | "does">;
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  /** Wie een lijn "enkel van" kan zijn (de mensen in de verdeling); leeg = geen keuze. */
  people: { id: string; name: string }[];
  /** Lijsten waarin een nieuw item kan komen (waar je mag toevoegen). */
  targets: ListNode[];
  /** Waar iets nieuws dat erbij komt standaard in komt (de lijst waar je vandaan kwam); leeg: enkel tekst. */
  defaultNew?: string;
  /** Een gekozen item (om velden in te vullen met wat het nu heeft). */
  onPick?: (item: ItemRef, role: LineRole) => void;
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
        // Een groep uit bepaalde lijsten: iets nieuws komt in een van die lijsten (waar je vandaan kwam, anders de eerste
        // waarin je mag toevoegen); uit elke lijst: waar je vandaan kwam (een wijn in Wijnen).
        const into = g.lists.length ? targets.filter((t) => g.lists.includes(t.id)) : targets;
        const startIn = defaultNew && into.some((t) => t.id === defaultNew) ? defaultNew : g.lists.length ? (into[0]?.id ?? "") : "";
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
                    targets={into}
                    startIn={startIn}
                    onPick={(t) => onPick?.(t, g.role)}
                    onChange={(p) => set(l.key, p)}
                    onRemove={() => onChange(lines.filter((x) => x.key !== l.key))}
                  />
                ))}
              </ul>
            )}
            {/* Eén item of een nieuwe rij: geen tweede lijn. */}
            {!(g.one && own.length) && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                style={{ justifySelf: "start" }}
                onClick={() => onChange([...lines, { ...emptyLine(g.role), newIn: g.fresh ? g.lists[0] : "" }])}
              >
                <Icon name="plus" size={15} /> {oneOf(into, g.lists) ?? "Lijn"}
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Hoe één item heet in de lijsten van een groep (+ Ruimte, + Wijn), als die het allemaal hetzelfde noemen. */
function oneOf(targets: ListNode[], lists: string[]): string | null {
  const names = new Set(targets.filter((t) => lists.includes(t.id)).map((t) => t.one));
  return lists.length && names.size === 1 ? ([...names][0] ?? null) : null;
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
  onPick,
  onChange,
  onRemove,
}: {
  line: LineDraft;
  group: LineGroup;
  /** Wat de lijn met de voorraad van haar item doet. */
  op: Op | null;
  /** Hoeveel en de eenheid doen ertoe. */
  counted: boolean;
  money: boolean;
  people: { id: string; name: string }[];
  targets: ListNode[];
  startIn: string;
  onPick: (item: ItemRef) => void;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
}) {
  const [typing, setTyping] = useState<string | null>(null);
  const { options, placeOf } = useListItems(group.lists, typing ?? "", line.item ? [line.item.id] : []);
  const shown = typing ?? (line.item ? line.item.name : line.text);
  const units = [...new Set(["", ...(line.item?.unit ? [line.item.unit] : []), ...UNITS, ...(line.unit ? [line.unit] : [])])];
  const free = !line.item && line.text.trim();
  const what = line.item?.name ?? (line.text || "lijn");
  return (
    <li className="line-row">
      <div className="line-main is-plain">
        {group.fresh ? (
          // Een nieuwe rij: enkel haar naam (een bewaarde lijn wijst al naar haar item).
          <input
            aria-label={group.label}
            value={line.item ? line.item.name : line.text}
            disabled={Boolean(line.item)}
            maxLength={120}
            placeholder="Typ een naam…"
            onChange={(e) => onChange({ text: e.target.value, newIn: group.lists[0] })}
          />
        ) : (
          <Combo
            label={group.label}
            text={shown}
            options={options}
            placeOf={placeOf}
            disabled={false}
            placeholder="Typ een naam…"
            className="line-item"
            typeFirst
            onText={(t) => {
              setTyping(t);
              // Iets nieuws dat erbij komt: standaard in de lijst van de groep, of waar je vandaan kwam (een wijn in Wijnen).
              const fresh = !line.text && !line.newIn && t.trim() && (op === "bij" || group.lists.length) && startIn;
              onChange({ item: null, text: t, ...(fresh ? { newIn: startIn } : {}) });
            }}
            onPick={(o) => {
              setTyping(null);
              onChange({ item: o, text: "", newIn: "", unit: line.unit || o.unit || "" });
              onPick(o);
            }}
            onLeave={() => setTyping(null)}
          />
        )}
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
              <input
                inputMode="decimal"
                aria-label={`Prijs van ${what}`}
                placeholder="€"
                value={line.price}
                onChange={(e) => onChange({ price: e.target.value })}
              />
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
      {free && !group.fresh && (op === "bij" || op === "af" || group.lists.length > 0) && targets.length > 0 && (
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
