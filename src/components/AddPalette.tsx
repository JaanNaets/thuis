// Toevoegen (de + op het overzicht): typ waar het heen moet en wat je weet ("bijvulling 3 zakken pellets"), kies de
// lijst, en het formulier opent met de rest van je tekst al ingevuld. Jouw meestgebruikte lijsten staan bovenaan; Nieuw
// project als laatste. Zelfde opbouw als het zoekpalet (pijltjes, Enter, Escape). Zie shared/quickadd.ts.

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { fold } from "../../shared/quickfill";
import { addPath, matchTargets, type AddTarget } from "../../shared/quickadd";
import { useApi } from "../api";
import { useNavigate } from "../router";
import { Icon, type IconName } from "./Icon";

/** Zoveel lijsten tegelijk. */
const SHOWN = 8;

type Entry = { key: string; group: string; label: string; hint?: string; icon: IconName; to: string };

export function AddPalette({ open, onClose, text = "" }: { open: boolean; onClose: () => void; text?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { data: targets } = useApi<AddTarget[]>(open ? "/me/lists" : null);
  const [query, setQuery] = useState(text);
  const [active, setActive] = useState(0);
  const [highlight, setHighlight] = useState<{ top: number; height: number }>();

  useLayoutEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) {
      setQuery(text);
      setActive(0);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const results = useMemo<Entry[]>(() => {
    const lists = matchTargets(query, targets ?? [])
      .slice(0, SHOWN)
      .map(({ target, rest }) => ({
        key: `${target.project_id}/${target.type_id}`,
        group: "Toevoegen",
        label: rest ? `${target.name}: ${rest}` : target.name,
        hint: target.project_name,
        icon: (target.icon ?? "plus") as IconName,
        to: addPath(target, rest),
      }));
    const q = fold(query);
    const project = !q || "nieuw project".startsWith(q) || "project".startsWith(q);
    return [...lists, ...(project ? [{ key: "new-project", group: "Nieuw", label: "Nieuw project", icon: "project" as IconName, to: "/projecten/nieuw" }] : [])];
  }, [query, targets]);

  const current = Math.min(active, results.length - 1);

  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el) return setHighlight(undefined);
    setHighlight({ top: el.offsetTop, height: el.offsetHeight });
    el.scrollIntoView({ block: "nearest" });
  }, [current, results, open]);

  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    onClose();
    navigate(entry.to);
  };

  return (
    <dialog
      ref={ref}
      className="palette"
      aria-label="Toevoegen"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="palette-search">
        <Icon name="plus" size={16} />
        <input
          autoFocus
          value={query}
          placeholder="Wat wil je toevoegen?"
          aria-label="Toevoegen"
          aria-controls="add-list"
          aria-activedescendant={results[current] ? `add-${results[current].key}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((current + 1) % Math.max(results.length, 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((current - 1 + results.length) % Math.max(results.length, 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(results[current]);
            }
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <div className="palette-list" id="add-list" role="listbox" ref={listRef}>
        {highlight && <span className="palette-highlight" style={{ "--top": `${highlight.top}px`, "--h": `${highlight.height}px` } as CSSProperties} />}
        {results.map((entry, i) => (
          <div key={entry.key} className="palette-entry">
            {entry.group !== results[i - 1]?.group && <p className="palette-group">{entry.group}</p>}
            <div
              id={`add-${entry.key}`}
              role="option"
              aria-selected={i === current}
              className="palette-option"
              onPointerMove={() => i !== current && setActive(i)}
              onClick={() => go(entry)}
            >
              <Icon name={entry.icon} size={16} />
              <span className="palette-label">{entry.label}</span>
              {entry.hint && <span className="palette-hint">{entry.hint}</span>}
              <Icon name="arrow" size={14} className="palette-go" />
            </div>
          </div>
        ))}
      </div>
    </dialog>
  );
}
