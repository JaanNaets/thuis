// "Typ wat je weet" met keuzes terwijl je typt: wat past bij het woord bij de cursor, uit alle velden van het formulier
// (items uit de lijsten waarnaar het verwijst, keuzes, personen, ja/nee en namen van eerder). Kiezen zet de volledige
// naam in je tekst en vult dat veld meteen in (`onPick`). Staat de cursor in een getal of datum die al ergens
// ingevuld is, dan tonen de keuzes de andere velden waar het naartoe kan (`moves`); Tab doet hetzelfde op een
// computer (`onTab`). Zie STIJLBOEK.md → Formulier.
//
// Items komen van de server (enkel wat jij mag zien, nooit een hele lijst): per groep lijsten één vraag met het woord
// dat je typt; de woorden ervoor zoeken daarin verder ("rode wi" → Rode wijn).

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { formatFieldValue, type FieldDef, type FieldValue, type Names } from "../../shared/fields";
import { formSuggestions, insertSuggestion, matchSuggestions, suggestionLists, typedFragments, wordAt, type Suggestion } from "../../shared/quickfill";
import type { ItemRef } from "../../shared/types";
import { api } from "../api";
import { Sheet } from "./Sheet";

/** Zoveel items per groep lijsten om uit te kiezen (de beste komen bovenaan, zie `matchSuggestions`). */
const FETCH = 20;

export type QuickSource = {
  /** De velden die je mag wijzigen. */
  fields: FieldDef[];
  people: { id: string; name: string }[];
  /** Namen van eerdere items in deze lijst. */
  names: string[];
  /** Hoe de naam heet in deze lijst ("Wat" bij Eten). */
  nameLabel: string;
};

export function QuickInput({
  value,
  onChange,
  onEnter,
  onPick,
  moves,
  onTab,
  source,
  label,
  placeholder,
  inputRef: outerRef,
  idle,
}: {
  value: string;
  onChange: (text: string) => void;
  /** Enter zonder keuze: invullen. */
  onEnter: () => void;
  onPick: (suggestion: Suggestion) => void;
  /** Het woord bij de cursor staat al in een veld: naar welke andere velden het kan (keuzes met `move`). */
  moves?: (word: string) => Suggestion[];
  /** Tab (of Shift+Tab) bij een woord dat al in een veld staat: naar het volgende veld; true als dat lukte. */
  onTab?: (caret: number, back: boolean) => boolean;
  /** Zonder: een gewoon tekstveld. Moet stabiel blijven (useMemo). */
  source?: QuickSource;
  label: string;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** In het lege veld: wat je vaak kiest (keuzes met `repeat`). */
  idle?: Suggestion[];
}) {
  const id = useId();
  const ownRef = useRef<HTMLInputElement>(null);
  const inputRef = outerRef ?? ownRef;
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Items bij het woord dat je typt; die van een vorig woord blijven staan tot de nieuwe er zijn (geen geflikker).
  const [items, setItems] = useState<Suggestion[]>([]);

  const local = useMemo(() => (source ? formSuggestions(source.fields, source.people, source.names, source.nameLabel) : []), [source]);
  const groups = useMemo(() => (source ? suggestionLists(source.fields) : []), [source]);
  const fragments = useMemo(() => (source ? typedFragments(value, caret) : []), [source, value, caret]);
  const word = fragments.length ? fragments[fragments.length - 1].query : "";

  useEffect(() => {
    if (!word || !groups.length) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const found = await Promise.all(
        groups.map((g) =>
          api.get<{ items: ItemRef[] }>(`/items?type=${g.lists.join(",")}&q=${encodeURIComponent(word)}&limit=${FETCH}`).then(
            (r) => r.items.flatMap((it) => g.fields.map((f): Suggestion => ({ field: f.key, label: f.label, text: it.name, value: it.id }))),
            () => [],
          ),
        ),
      );
      if (!stale) setItems(found.flat());
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [word, groups]);

  const match = useMemo(() => (fragments.length ? matchSuggestions([...local, ...items], fragments) : null), [fragments, local, items]);
  // Een getal of datum die al ergens staat: de andere velden waar het naartoe kan.
  const here = source && moves && !match ? wordAt(value, caret) : null;
  const moving = useMemo(() => (here && moves ? moves(here.word) : []), [here?.word, moves]);
  const shown = open ? (match ? match.suggestions : !value.trim() && idle?.length ? idle : moving) : [];
  const current = active < shown.length ? active : -1;

  function pick(s: Suggestion) {
    setOpen(false);
    setActive(-1);
    if (s.move || s.repeat || !match) return onPick(s);
    const next = insertSuggestion(value, match.start, match.end, s.text);
    onChange(next.text);
    onPick(s);
    setCaret(next.caret);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(next.caret, next.caret));
  }

  function key(e: KeyboardEvent<HTMLInputElement>) {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && shown.length) {
      e.preventDefault();
      setActive(Math.max(0, Math.min(shown.length - 1, current + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
      // Ctrl/⌘ + Enter gaat door naar het formulier (opslaan).
      e.preventDefault();
      if (shown[current]) pick(shown[current]);
      else onEnter();
    } else if (e.key === "Tab" && onTab && !e.altKey && !e.metaKey && !e.ctrlKey) {
      if (onTab(e.currentTarget.selectionStart ?? value.length, e.shiftKey)) e.preventDefault();
    } else if (e.key === "Escape" && shown.length) {
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className="picker is-row">
      <input
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-expanded={shown.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={shown[current] ? `${id}-${current}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        maxLength={300}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setOpen(true);
          setActive(-1);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={key}
      />
      {shown.length > 0 && (
        <ul className="picker-list" role="listbox" id={`${id}-list`} aria-label={label}>
          {shown.map((s, i) => (
            <li
              key={`${s.move ?? s.repeat ?? ""}:${s.field}:${String(s.value)}`}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === current}
              className="picker-option"
              // Kiezen vóór het veld de focus verliest.
              onPointerDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onPointerEnter={() => setActive(i)}
            >
              <span className="picker-name">{s.text}</span>
              <span className="picker-place">{s.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Een waarde in het rijtje: zonder de eenheid als die al het label is ("Zakken 3", niet "Zakken 3 zakken"). */
export const chipValue = (def: FieldDef, value: FieldValue, names: Names) =>
  def.type === "number" && def.unit && def.unit.toLowerCase() === def.label.toLowerCase() ? String(value).replace(".", ",") : formatFieldValue(def, value, names);

/** Wat de tekst invulde: per veld het label en de waarde. */
export type QuickChip = {
  key: string;
  label: string;
  value: string;
  /** Andere velden waar de waarde naartoe kan. */
  targets: { key: string; label: string }[];
};

/**
 * Het rijtje onder "Typ wat je weet": wat je tekst invulde, live. Een tik opent een blad om de waarde naar een ander
 * veld te zetten of ze weg te halen (dan verdwijnt ze ook uit je tekst).
 */
export function QuickChips({ chips, onMove, onRemove }: { chips: QuickChip[]; onMove: (key: string, to: string) => void; onRemove: (key: string) => void }) {
  const [open, setOpen] = useState<QuickChip | null>(null);
  if (!chips.length && !open) return null;
  return (
    <>
      <div className="tag-picker quick-chips" role="group" aria-label="Ingevuld" aria-live="polite">
        {chips.map((c) => (
          <button key={c.key} type="button" className="tag is-filled" onClick={() => setOpen(c)}>
            <span className="tag-label">{c.label}</span>
            <span className="tag-value">{c.value}</span>
          </button>
        ))}
      </div>
      <Sheet open={Boolean(open)} title={open ? `${open.label} ${open.value}` : ""} onClose={() => setOpen(null)}>
        {open && (
          <ul className="rows sheet-menu">
            {open.targets.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  className="row"
                  onClick={() => {
                    onMove(open.key, t.key);
                    setOpen(null);
                  }}
                >
                  <span className="cell-main">
                    <span className="row-title">Naar {t.label}</span>
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="row"
                onClick={() => {
                  onRemove(open.key);
                  setOpen(null);
                }}
              >
                <span className="cell-main">
                  <span className="row-title">Weghalen</span>
                </span>
              </button>
            </li>
          </ul>
        )}
      </Sheet>
    </>
  );
}
