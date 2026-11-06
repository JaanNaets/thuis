// Eén veld voor alles (⌘K, Zoeken onderaan, of de + op het overzicht): zoeken naar een lijst, een ding of iets dat
// gebeurde, en iets toevoegen. Typ "gegeten pasta 300 g" en bovenaan staat "Gegeten: pasta 300 g" (het formulier opent
// met die tekst, zie shared/targets.ts); daaronder wat je zoekt. Met de + (modus "add") staan je meestgebruikte
// plekken eerst; Nieuwe lijst als laatste. Pijltjes kiezen, Enter opent, Escape sluit.

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { buildTargets, fold, matchTargets, targetPath, type Targets } from "../../shared/targets";
import type { ThingRef } from "../../shared/model";
import { api, useApi } from "../api";
import { listIcon } from "../lists";
import { useNavigate } from "../router";
import { useSession } from "../session";
import { LINKS_PLACE, placesOf } from "./Sidebar";
import { Icon, type IconName } from "./Icon";

type Entry = { key: string; group: string; label: string; hint?: string; icon: IconName; to: string };
export type PaletteMode = "search" | "add";

type Found = { lists: { id: string; name: string }[]; things: { id: string; name: string; list: string; icon: string | null }[]; events: { id: string; name: string; list: string; at: string }[] };

const NEW_LIST: Entry = { key: "new-list", group: "Nieuw", label: "Nieuwe lijst", icon: "folder", to: "/lijsten/nieuw" };

const PER_GROUP = 6;
const ADD_SHOWN = 8;
const ADD_TOP = 3;

/** Het palet openen vanaf eender waar (de + op het overzicht, een snelkoppeling, gedeelde tekst). */
export const PaletteContext = createContext<(mode: PaletteMode, text?: string) => void>(() => {});
export const usePalette = () => useContext(PaletteContext);

export function CommandPalette({ open, mode, text = "", onClose }: { open: boolean; mode: PaletteMode; text?: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { lists, tags, boards } = useSession();
  // Ga naar: je borden, Verbanden en jij.
  const ACTIONS: Entry[] = useMemo(
    () => [
      ...[...placesOf(boards), LINKS_PLACE].map((p) => ({ key: p.to, group: "Ga naar", label: p.label, icon: p.icon, to: p.to })),
      { key: "me", group: "Ga naar", label: "Jouw gegevens", icon: "user", to: "/ik" },
    ],
    [boards],
  );
  const { data: raw } = useApi<Targets>(open ? "/me/targets" : null);
  const targets = useMemo(() => (raw ? buildTargets(raw) : []), [raw]);
  const [query, setQuery] = useState(text);
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<Found>();
  const [named, setNamed] = useState<ThingRef[]>([]);
  const [highlight, setHighlight] = useState<{ top: number; height: number }>();

  useLayoutEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) {
      setQuery(text);
      setActive(0);
      setFound(undefined);
      setNamed([]);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Zoeken op de server (enkel wat je ziet), en welke dingen in je tekst staan (om te weten waar het hoort).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFound(undefined);
      setNamed([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.get<Found>(`/insights/search?q=${encodeURIComponent(q)}`).then((r) => !cancelled && setFound(r), () => {});
      api.get<{ things: ThingRef[] }>(`/things?in=${encodeURIComponent(q)}&limit=5`).then((r) => !cancelled && setNamed(r.things), () => {});
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const results = useMemo(() => {
    const q = fold(query);
    const matches = matchTargets(query, targets);
    const strong = matches[0]?.strong ?? false;
    // Staat er een ding in je tekst (yoghurt), dan loggen in zijn lijst eerst.
    const homes = new Set(named.map((t) => t.list_id));
    const ranked = strong ? matches : [...matches.filter((m) => homes.has(m.target.list_id) && !m.target.thing), ...matches.filter((m) => !(homes.has(m.target.list_id) && !m.target.thing))];
    const add: Entry[] = ranked.slice(0, mode === "add" || strong || homes.size ? ADD_SHOWN : ADD_TOP).map(({ target, rest }) => ({
      key: `a${target.key}`,
      group: "Toevoegen",
      label: rest ? `${target.label}: ${rest}` : target.label,
      hint: target.hint ?? undefined,
      icon: (target.icon ?? "plus") as IconName,
      to: targetPath(target, rest),
    }));
    const newList = !q || "nieuwe lijst".startsWith(q) || "lijst".startsWith(q) ? [NEW_LIST] : [];
    if (!q) return mode === "add" ? [...add, ...newList] : [...ACTIONS, ...add, ...newList];
    const match = (...texts: (string | null | undefined)[]) => texts.some((t) => t && fold(t).includes(q));
    const search: Entry[] = [
      ...ACTIONS.filter((a) => match(a.label)),
      ...tags
        .filter((t) => match(t.name))
        .slice(0, PER_GROUP)
        .map((t) => ({ key: `t${t.id}`, group: "Tags", label: t.name, icon: "tag" as IconName, to: `/tags/${t.id}` })),
      ...lists
        .filter((l) => match(l.name))
        .slice(0, PER_GROUP)
        .map((l) => ({ key: `l${l.id}`, group: "Lijsten", label: l.name, hint: l.archived ? "gearchiveerd" : undefined, icon: listIcon(l), to: `/lijsten/${l.id}` })),
      ...(found?.things ?? []).slice(0, PER_GROUP).map((t) => ({ key: `d${t.id}`, group: "Dingen", label: t.name, hint: t.list, icon: (t.icon ?? "folder") as IconName, to: `/dingen/${t.id}` })),
      ...(found?.events ?? []).slice(0, PER_GROUP).map((e) => ({ key: `e${e.id}`, group: "Logboek", label: e.name, hint: `${e.list} · ${e.at.slice(0, 10)}`, icon: "note" as IconName, to: `/gebeurtenissen/${e.id}` })),
    ];
    if (mode === "add" || strong || homes.size) return [...add, ...newList, ...search];
    return [...search, ...add.slice(0, ADD_TOP), ...newList];
  }, [query, lists, tags, found, targets, named, mode]);

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
          placeholder={mode === "add" ? "Wat gebeurde er?" : "Zoek of voeg toe…"}
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
