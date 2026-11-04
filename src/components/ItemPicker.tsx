// Een item kiezen bij een verwijzing: typ om te zoeken, over een of meer lijsten (ook uit andere projecten) heen.
// Met vrije tekst (`free`) mag je ook iets typen dat er niet bij staat. Zie STIJLBOEK.md → Lijsten en velden.

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { refLists, type FieldDef, type TextValue } from "../../shared/fields";
import type { ItemRef } from "../../shared/types";
import { useApi } from "../api";
import { useSession } from "../session";
import { Icon } from "./Icon";

const MAX_SHOWN = 50;
const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** De items om uit te kiezen, en per item het project als ze uit meer projecten komen. */
export function useItemOptions(def: FieldDef) {
  const { projects } = useSession();
  const { data, error } = useApi<ItemRef[]>(`/items?type=${refLists(def).join(",")}`);
  const several = new Set(data?.map((o) => o.project_id)).size > 1;
  const placeOf = (o: ItemRef) => (several ? (projects.find((p) => p.id === o.project_id)?.name ?? "") : "");
  return { options: data, error, placeOf };
}

/**
 * Het zoekveld met de keuzes eronder. `text`: wat er in het veld staat; `onText`: bij typen; `onPick`: een item
 * gekozen. Pijltjes, Enter en Escape werken zoals in het zoekpalet.
 */
function Combo({
  label,
  text,
  onText,
  onPick,
  onLeave,
  options,
  placeOf,
  exclude = [],
  disabled,
  placeholder,
  className,
}: {
  label: string;
  text: string;
  onText: (text: string) => void;
  onPick: (option: ItemRef) => void;
  onLeave?: () => void;
  options: ItemRef[] | undefined;
  placeOf: (o: ItemRef) => string;
  exclude?: string[];
  disabled: boolean;
  placeholder: string;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const matches = useMemo(() => {
    const q = normalize(text.trim());
    return (options ?? []).filter((o) => !exclude.includes(o.id) && (!q || normalize(o.name).includes(q))).slice(0, MAX_SHOWN);
  }, [options, text, exclude]);
  const current = Math.min(active, matches.length - 1);

  const pick = (o: ItemRef) => {
    onPick(o);
    setOpen(false);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const next = Math.max(0, Math.min(matches.length - 1, current + (e.key === "ArrowDown" ? 1 : -1)));
      setActive(next);
      listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && open && matches[current]) {
      e.preventDefault();
      pick(matches[current]);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="picker">
      <input
        role="combobox"
        className={className}
        aria-label={label}
        aria-expanded={open && matches.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && matches[current] ? `${id}-${current}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={text}
        placeholder={options ? placeholder : "Laden…"}
        onChange={(e) => {
          onText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          onLeave?.();
        }}
        onKeyDown={key}
      />
      {open && matches.length > 0 && (
        <ul className="picker-list" role="listbox" id={`${id}-list`} ref={listRef}>
          {matches.map((o, i) => (
            <li
              key={o.id}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === current}
              className="picker-option"
              // Kiezen vóór het veld de focus verliest.
              onPointerDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onPointerEnter={() => setActive(i)}
            >
              <span className="picker-name">{o.name}</span>
              {placeOf(o) && <span className="picker-place">{placeOf(o)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Eén item (of met `free` vrije tekst). `value`: een id, { text } of leeg. */
export function ItemPicker({
  def,
  value,
  onChange,
  disabled,
  className,
}: {
  def: FieldDef;
  value: string | TextValue | null;
  onChange: (value: string | TextValue | null) => void;
  disabled: boolean;
  /** Bv. `auto`: de app vulde het in. */
  className?: string;
}) {
  const { options, error, placeOf } = useItemOptions(def);
  const chosen = typeof value === "string" ? options?.find((o) => o.id === value) : undefined;
  const shown = typeof value === "string" ? (chosen?.name ?? (options ? "Verborgen" : "")) : (value?.text ?? "");
  // Wat je typt; tot je iets typt, staat er wat gekozen is.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? shown;

  return (
    <>
      <div className="picker-row">
        <Combo
          label={def.label}
          text={text}
          options={options}
          placeOf={placeOf}
          disabled={disabled}
          placeholder={def.free ? "Typ of kies…" : "Zoek of kies…"}
          className={className}
          onText={(t) => {
            setDraft(t);
            if (def.free) onChange(t.trim() ? { text: t } : null);
            else if (!t.trim()) onChange(null);
          }}
          onPick={(o) => {
            setDraft(null);
            onChange(o.id);
          }}
          onLeave={() => setDraft(null)}
        />
        {value && !disabled && (
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            aria-label={`${def.label} leegmaken`}
            onClick={() => {
              setDraft(null);
              onChange(null);
            }}
          >
            <Icon name="close" size={15} />
          </button>
        )}
      </div>
      {error && <span className="hint error">{error}</span>}
    </>
  );
}

/** Meerdere items (de ingrediënten van een recept): als chips, met het zoekveld om er een bij te zetten. */
export function ItemsPicker({ def, value, onChange, disabled }: { def: FieldDef; value: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  const { options, error, placeOf } = useItemOptions(def);
  const [text, setText] = useState("");
  const name = (id: string) => options?.find((o) => o.id === id)?.name ?? (options ? "Verborgen" : "…");
  return (
    <>
      {value.length > 0 && (
        <ul className="ref-chips">
          {value.map((id) => (
            <li key={id} className="tag static ref-chip">
              <span>{name(id)}</span>
              {!disabled && (
                <button type="button" aria-label={`${name(id)} weghalen`} onClick={() => onChange(value.filter((x) => x !== id))}>
                  <Icon name="close" size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <Combo
          label={`${def.label}: toevoegen`}
          text={text}
          options={options}
          placeOf={placeOf}
          exclude={value}
          disabled={false}
          placeholder="Toevoegen…"
          onText={setText}
          onPick={(o) => {
            setText("");
            onChange([...value, o.id]);
          }}
        />
      )}
      {error && <span className="hint error">{error}</span>}
    </>
  );
}
