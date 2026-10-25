import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { SearchResult } from "../../shared/types";
import { api } from "../api";
import { useNavigate } from "../router";
import { useSession } from "../session";
import { Icon, type IconName } from "./Icon";

type Entry = { key: string; group: string; label: string; hint?: string; icon: IconName; to: string };

const ACTIONS: Entry[] = [
  { key: "home", group: "Ga naar", label: "Projecten", icon: "project", to: "/" },
  { key: "me", group: "Ga naar", label: "Jouw gegevens", icon: "user", to: "/ik" },
  { key: "new-project", group: "Nieuw", label: "Nieuw project", icon: "plus", to: "/projecten/nieuw" },
];

/** Met zoekterm: hoogstens zoveel per groep. */
const PER_GROUP = 6;

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Zoekpalet (⌘K of het zoekveld in de zijbalk): springt naar een project of een item in je projecten.
 * Pijltjes kiezen, Enter opent, Escape sluit.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { projects } = useSession();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<SearchResult>();
  const [highlight, setHighlight] = useState<{ top: number; height: number }>();

  // Vóór het meten hieronder openen, anders is het palet nog onzichtbaar en meet alles 0.
  useLayoutEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) {
      setQuery("");
      setActive(0);
      setFound(undefined);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Items zoekt de server (enkel wat je mag zien), even na het typen.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setFound(undefined);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.get<SearchResult>(`/search?q=${encodeURIComponent(q)}`).then(
        (r) => !cancelled && setFound(r),
        () => {},
      );
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return ACTIONS;
    const match = (...texts: (string | null | undefined)[]) => texts.some((t) => t && normalize(t).includes(q));
    const groups: Entry[][] = [
      ACTIONS.filter((a) => match(a.label)),
      projects
        .filter((p) => match(p.name, p.description))
        .map((p) => ({
          key: `p${p.id}`,
          group: "Projecten",
          label: p.name,
          hint: p.archived ? "gearchiveerd" : undefined,
          icon: (p.icon ?? "project") as IconName,
          to: `/projecten/${p.id}`,
        })),
      (found?.items ?? []).map((i) => ({
        key: `i${i.id}`,
        group: "Items",
        label: i.name,
        hint: `${i.type_name} · ${i.project_name}`,
        icon: (i.icon ?? "folder") as IconName,
        to: `/items/${i.id}`,
      })),
    ];
    return groups.flatMap((g) => g.slice(0, PER_GROUP));
  }, [query, projects, found]);

  const current = Math.min(active, results.length - 1);

  // Het grijze vlak schuift naar de gekozen regel, en die blijft in beeld.
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
      aria-label="Zoeken"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="palette-search">
        <Icon name="search" size={16} />
        <input
          autoFocus
          value={query}
          placeholder="Zoek een project of iets erin…"
          aria-label="Zoeken"
          aria-controls="palette-list"
          aria-activedescendant={results[current] ? `palette-${results[current].key}` : undefined}
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
      <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
        {highlight && <span className="palette-highlight" style={{ "--top": `${highlight.top}px`, "--h": `${highlight.height}px` } as CSSProperties} />}
        {results.length === 0 && <p className="palette-empty">Niets gevonden voor “{query.trim()}”</p>}
        {results.map((entry, i) => (
          <div key={entry.key} className="palette-entry">
            {entry.group !== results[i - 1]?.group && <p className="palette-group">{entry.group}</p>}
            <div
              id={`palette-${entry.key}`}
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
