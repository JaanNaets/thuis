import { useId, useState, type KeyboardEvent } from "react";
import type { Vendor } from "../../shared/types";
import { Icon } from "./Icon";

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Verkoper typen of kiezen. Bestaande verkopers verschijnen terwijl je typt;
 * een nieuwe naam wordt bij het opslaan vanzelf een nieuwe verkoper.
 */
export function VendorField({
  vendors,
  value,
  onChange,
  className,
  placeholder = "bv. Colruyt, Coolblue, de loodgieter",
}: {
  vendors: Vendor[];
  value: string;
  onChange: (name: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const q = fold(value.trim());
  const matches = vendors
    .filter((v) => !q || fold(v.name).includes(q))
    .sort((a, b) => Number(fold(b.name).startsWith(q)) - Number(fold(a.name).startsWith(q)) || b.usage - a.usage)
    .slice(0, 6);
  const exact = vendors.some((v) => fold(v.name) === q);
  const showNew = q !== "" && !exact;
  const options = [...matches.map((v) => v.name), ...(showNew ? [value.trim()] : [])];
  const visible = open && options.length > 0 && !(exact && matches.length === 1);

  function choose(name: string) {
    onChange(name);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!visible) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === "Escape") {
      // Enkel de lijst sluiten, niet het onderblad waarin het veld staat.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className="combobox">
      <input
        className={className}
        role="combobox"
        aria-label="Verkoper"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        maxLength={100}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        // Even wachten, anders verdwijnt de lijst voor een tik erop telt.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      {visible && (
        <ul className="combobox-list" id={listId} role="listbox">
          {matches.map((v, i) => (
            <li
              key={v.id}
              role="option"
              aria-selected={i === active}
              className="combobox-option"
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(v.name);
              }}
            >
              <Icon name="store" size={16} />
              {v.name}
              {v.usage > 0 && <span className="count">{v.usage}×</span>}
            </li>
          ))}
          {showNew && (
            <li
              role="option"
              aria-selected={active === matches.length}
              className="combobox-option"
              onMouseEnter={() => setActive(matches.length)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(value.trim());
              }}
            >
              <Icon name="plus" size={16} />
              Nieuwe verkoper "{value.trim()}"
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
