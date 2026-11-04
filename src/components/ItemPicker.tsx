// Een item kiezen bij een verwijzing: typ om te zoeken, over een of meer lijsten (ook uit andere projecten) heen.
// Met vrije tekst (`free`) mag je ook iets typen dat er niet bij staat. Zie STIJLBOEK.md → Lijsten en velden.
//
// Een kleine lijst komt in één keer en zoekt in de browser; een grote (meer dan één bladzijde) zoekt op de server
// terwijl je typt. Wat al gekozen is maar niet op de eerste bladzijde staat, haalt de naam apart op.

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { refLists, type FieldDef, type TextValue } from "../../shared/fields";
import { nameMatches } from "../../shared/quickfill";
import type { ItemRef } from "../../shared/types";
import { useApi } from "../api";
import { useSession } from "../session";
import { Icon } from "./Icon";

const PAGE = 100;
const MAX_SHOWN = 50;
type Page = { items: ItemRef[]; more: boolean };

/** Een waarde die pas verandert als ze even stil staat (zoeken terwijl je typt). */
function useSettled(value: string, ms = 200) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * De items om uit te kiezen (bij `text`: wat daarbij past), de naam van wat gekozen is (`chosen`), en per item het
 * project als ze uit meer projecten komen.
 */
export function useItemOptions(def: FieldDef, text = "", chosen: string[] = []) {
  const { projects } = useSession();
  const lists = refLists(def).join(",");
  const base = useApi<Page>(`/items?type=${lists}&limit=${PAGE}`);
  const q = useSettled(text.trim());
  const large = Boolean(base.data?.more);
  const search = useApi<Page>(large && q ? `/items?type=${lists}&q=${encodeURIComponent(q)}&limit=${MAX_SHOWN}` : null);
  const missing = large ? chosen.filter((id) => !base.data!.items.some((o) => o.id === id)) : [];
  const named = useApi<Page>(missing.length ? `/items?type=${lists}&ids=${missing.join(",")}` : null);
  const options = base.data && (large && text.trim() ? (search.data?.items ?? base.data.items) : base.data.items);
  const known = [...(base.data?.items ?? []), ...(search.data?.items ?? []), ...(named.data?.items ?? [])];
  const several = new Set(known.map((o) => o.project_id)).size > 1;
  const placeOf = (o: ItemRef) => (several ? (projects.find((p) => p.id === o.project_id)?.name ?? "") : "");
  /** De naam van een gekozen item; "Verborgen" als je het niet (meer) mag zien. */
  const nameOf = (id: string) => known.find((o) => o.id === id)?.name ?? (base.data && (!large || named.data) ? "Verborgen" : "");
  return { options, error: base.error ?? search.error, placeOf, nameOf };
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
  const matches = useMemo(
    () => (options ?? []).filter((o) => !exclude.includes(o.id) && nameMatches(o.name, text)).slice(0, MAX_SHOWN),
    [options, text, exclude],
  );
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
  // Wat je typt; tot je iets typt, staat er wat gekozen is.
  const [draft, setDraft] = useState<string | null>(null);
  const { options, error, placeOf, nameOf } = useItemOptions(def, draft ?? "", typeof value === "string" ? [value] : []);
  const shown = typeof value === "string" ? nameOf(value) : (value?.text ?? "");
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
  const [text, setText] = useState("");
  const { options, error, placeOf, nameOf } = useItemOptions(def, text, value);
  const name = (id: string) => nameOf(id) || "…";
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
