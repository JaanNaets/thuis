// "Typ wat je weet" met keuzes terwijl je typt: wat past bij het woord bij de cursor, uit alle velden van het formulier
// (items uit de lijsten waarnaar het verwijst, keuzes, personen, ja/nee en namen van eerder). Kiezen zet de volledige
// naam in je tekst en vult dat veld meteen in (`onPick`); Invullen doet daarna de rest. Zie STIJLBOEK.md → Formulier.
//
// Items komen van de server (enkel wat jij mag zien, nooit een hele lijst): per groep lijsten één vraag met het woord
// dat je typt; de woorden ervoor zoeken daarin verder ("rode wi" → Rode wijn).

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { FieldDef } from "../../shared/fields";
import { formSuggestions, insertSuggestion, matchSuggestions, suggestionLists, typedFragments, type Suggestion } from "../../shared/quickfill";
import type { ItemRef } from "../../shared/types";
import { api } from "../api";

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
  source,
  label,
  placeholder,
}: {
  value: string;
  onChange: (text: string) => void;
  /** Enter zonder keuze: invullen. */
  onEnter: () => void;
  onPick: (suggestion: Suggestion) => void;
  /** Zonder: een gewoon tekstveld. Moet stabiel blijven (useMemo). */
  source?: QuickSource;
  label: string;
  placeholder: string;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
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
  const shown = open && match ? match.suggestions : [];
  const current = active < shown.length ? active : -1;

  function pick(s: Suggestion) {
    if (!match) return;
    const next = insertSuggestion(value, match.start, match.end, s.text);
    onChange(next.text);
    onPick(s);
    setOpen(false);
    setActive(-1);
    setCaret(next.caret);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(next.caret, next.caret));
  }

  function key(e: KeyboardEvent<HTMLInputElement>) {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && shown.length) {
      e.preventDefault();
      setActive(Math.max(0, Math.min(shown.length - 1, current + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[current]) pick(shown[current]);
      else onEnter();
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
              key={`${s.field}:${String(s.value)}`}
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
