// Eén veld voor alles (⌘K, Zoeken onderaan, of de + op het overzicht): zoeken naar een project of een item, en iets
// toevoegen in een lijst. Typ "bijvulling 3 zakken pellets" en bovenaan staat "Bijvulling: 3 zakken pellets" (het
// formulier opent met die tekst al ingevuld, zie shared/quickadd.ts); daaronder wat je zoekt. Met de + (modus
// "add") staan je meestgebruikte lijsten eerst; Nieuw project als laatste. Pijltjes kiezen, Enter opent, Escape sluit.

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { addPath, matchTargets, type AddTarget } from "../../shared/quickadd";
import { fold } from "../../shared/quickfill";
import type { SearchResult } from "../../shared/types";
import { api, useApi } from "../api";
import { useNavigate } from "../router";
import { useSession } from "../session";
import { Icon, type IconName } from "./Icon";

type Entry = { key: string; group: string; label: string; hint?: string; icon: IconName; to: string };
export type PaletteMode = "search" | "add";

const ACTIONS: Entry[] = [
  { key: "home", group: "Ga naar", label: "Overzicht", icon: "project", to: "/" },
  { key: "agenda", group: "Ga naar", label: "Agenda", icon: "calendar", to: "/agenda" },
  { key: "links", group: "Ga naar", label: "Verbanden", icon: "links", to: "/verbanden" },
  { key: "me", group: "Ga naar", label: "Jouw gegevens", icon: "user", to: "/ik" },
];
const NEW_PROJECT: Entry = { key: "new-project", group: "Nieuw", label: "Nieuw project", icon: "project", to: "/projecten/nieuw" };

/** Met zoekterm: hoogstens zoveel per groep. */
const PER_GROUP = 6;
/** Zoveel lijsten om in toe te voegen (zonder zoekterm bij zoeken: enkel je meestgebruikte). */
const ADD_SHOWN = 8;
const ADD_TOP = 3;

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Het palet openen vanaf eender waar (de + op het overzicht, een snelkoppeling, gedeelde tekst). */
export const PaletteContext = createContext<(mode: PaletteMode, text?: string) => void>(() => {});
export const usePalette = () => useContext(PaletteContext);

export function CommandPalette({ open, mode, text = "", onClose }: { open: boolean; mode: PaletteMode; text?: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { projects } = useSession();
  const { data: targets } = useApi<AddTarget[]>(open ? "/me/lists" : null);
  const [query, setQuery] = useState(text);
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<SearchResult>();
  const [highlight, setHighlight] = useState<{ top: number; height: number }>();

  // Vóór het meten hieronder openen, anders is het palet nog onzichtbaar en meet alles 0.
  useLayoutEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) {
      setQuery(text);
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
    const matches = matchTargets(query, targets ?? []);
    const strong = matches[0]?.strong ?? false;
    const add: Entry[] = matches
      .slice(0, mode === "add" || strong ? ADD_SHOWN : ADD_TOP)
      .map(({ target, rest }) => ({
        key: `a${target.project_id}/${target.type_id}`,
        group: "Toevoegen",
        label: rest ? `${target.name}: ${rest}` : target.name,
        hint: target.project_name,
        icon: (target.icon ?? "plus") as IconName,
        to: addPath(target, rest),
      }));
    const f = fold(query);
    const newProject = !f || "nieuw project".startsWith(f) || "project".startsWith(f) ? [NEW_PROJECT] : [];
    if (!q) return mode === "add" ? [...add, ...newProject] : [...ACTIONS, ...add, ...newProject];
    const match = (...texts: (string | null | undefined)[]) => texts.some((t) => t && normalize(t).includes(q));
    const search: Entry[] = [
      ...ACTIONS.filter((a) => match(a.label)),
      ...projects
        .filter((p) => match(p.name, p.description))
        .slice(0, PER_GROUP)
        .map((p) => ({
          key: `p${p.id}`,
          group: "Projecten",
          label: p.name,
          hint: p.archived ? "gearchiveerd" : undefined,
          icon: (p.icon ?? "project") as IconName,
          to: `/projecten/${p.id}`,
        })),
      // "verbanden" (of "kaart"), eventueel met een projectnaam: de kaart van de verbanden van dat project.
      ...(/verb|kaart/.test(q)
        ? projects
            .filter((p) => !p.archived && normalize(p.name).includes(q.replace(/\bverb\w*|\bkaart\w*/g, "").trim()))
            .slice(0, PER_GROUP)
            .map((p) => ({
              key: `v${p.id}`,
              group: "Verbanden",
              label: `Verbanden van ${p.name}`,
              icon: "links" as IconName,
              to: `/projecten/${p.id}/verbanden`,
            }))
        : []),
      ...(found?.items ?? []).slice(0, PER_GROUP).map((i) => ({
        key: `i${i.id}`,
        group: "Items",
        label: i.name,
        hint: `${i.type_name} · ${i.project_name}`,
        icon: (i.icon ?? "folder") as IconName,
        to: `/items/${i.id}`,
      })),
    ];
    // Noemt je tekst een lijst (of je kwam via de +), dan toevoegen eerst; anders wat je zoekt eerst.
    if (mode === "add" || strong) return [...add, ...newProject, ...search];
    return [...search, ...newProject];
  }, [query, projects, found, targets, mode]);

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

  const label = mode === "add" ? "Toevoegen" : "Zoeken";
  return (
    <dialog
      ref={ref}
      className="palette"
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="palette-search">
        <Icon name={mode === "add" ? "plus" : "search"} size={16} />
        <input
          autoFocus
          value={query}
          placeholder={mode === "add" ? "Wat wil je toevoegen?" : "Zoek of voeg toe…"}
          aria-label={label}
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
