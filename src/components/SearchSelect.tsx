// Kiezen uit iets dat kan groeien (lijsten, formulieren, tags, items): een zoekveld met de keuzes eronder (`Combo`),
// nooit een rij pillen of een gewone keuzelijst die je niet kan doorzoeken. Zie STIJLBOEK.md → Kiezen.
//
// - `SearchSelect`: één keuze; het veld toont wat gekozen is, × maakt het leeg (als dat mag).
// - `SearchMulti`: meer keuzes; de gekozen als tags met × (`.ref-chips`), eronder het zoekveld om er een bij te zetten.
// - `SearchAdd`: iets toevoegen of doen (een lijst bij een formulier, een formulier samenvoegen): kiezen voert het uit.

import { useState } from "react";
import { Combo } from "./ItemPicker";
import { Icon } from "./Icon";

/** Een keuze: id, naam en eventueel waar ze bij hoort (grijs ernaast: de tag van een lijst). */
export type Choice = { id: string; name: string; place?: string };

const placeOf = (o: Choice) => o.place ?? "";

export function SearchSelect({
  label,
  value,
  options,
  onChange,
  placeholder = "Zoek…",
  clearable = false,
  disabled = false,
}: {
  label: string;
  value: string | null;
  options: Choice[];
  onChange: (id: string | null) => void;
  placeholder?: string;
  /** Leeg mag (× maakt het leeg). */
  clearable?: boolean;
  disabled?: boolean;
}) {
  const [typing, setTyping] = useState<string | null>(null);
  const chosen = options.find((o) => o.id === value);
  return (
    <div className="search-select">
      <Combo<Choice>
        label={label}
        text={typing ?? chosen?.name ?? ""}
        options={options}
        placeOf={placeOf}
        disabled={disabled}
        placeholder={placeholder}
        onText={setTyping}
        onPick={(o) => {
          setTyping(null);
          onChange(o.id);
        }}
        onLeave={() => setTyping(null)}
      />
      {clearable && value && !disabled && (
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${label} leegmaken`} onClick={() => onChange(null)}>
          <Icon name="close" size={15} />
        </button>
      )}
    </div>
  );
}

export function SearchMulti({
  label,
  value,
  options,
  onChange,
  placeholder = "Toevoegen…",
  keepOne = false,
}: {
  label: string;
  value: string[];
  options: Choice[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  /** Minstens één blijft staan (de laatste heeft geen ×). */
  keepOne?: boolean;
}) {
  const [text, setText] = useState("");
  const name = (id: string) => options.find((o) => o.id === id)?.name ?? "Verborgen";
  return (
    <div className="search-multi">
      {value.length > 0 && (
        <ul className="ref-chips">
          {value.map((id) => (
            <li key={id} className="tag static ref-chip">
              <span>{name(id)}</span>
              {!(keepOne && value.length === 1) && (
                <button type="button" aria-label={`${name(id)} weghalen`} onClick={() => onChange(value.filter((x) => x !== id))}>
                  <Icon name="close" size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Combo<Choice>
        label={label}
        text={text}
        options={options}
        placeOf={placeOf}
        exclude={value}
        disabled={false}
        placeholder={placeholder}
        onText={setText}
        onPick={(o) => {
          setText("");
          onChange([...value, o.id]);
        }}
      />
    </div>
  );
}

export function SearchAdd({ label, options, onPick, placeholder }: { label: string; options: Choice[]; onPick: (id: string) => void; placeholder: string }) {
  const [text, setText] = useState("");
  return (
    <Combo<Choice>
      label={label}
      text={text}
      options={options}
      placeOf={placeOf}
      disabled={false}
      placeholder={placeholder}
      onText={setText}
      onPick={(o) => {
        setText("");
        onPick(o.id);
      }}
    />
  );
}
