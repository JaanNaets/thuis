// Eén veld voor alles (⌘K, Zoeken onderaan, of de + op het overzicht): zoeken naar een lijst, een ding of iets dat
// gebeurde, en iets toevoegen. Typ "gegeten pasta 300 g" en bovenaan staat "Gegeten: pasta 300 g" (het formulier opent
// met die tekst, zie shared/targets.ts); daaronder wat je zoekt. Met de + (modus "add") staan je meestgebruikte
// plekken eerst; Nieuwe lijst als laatste. Pijltjes kiezen, Enter opent, Escape sluit. Op een lijst (`scope`) staat er
// enkel wat in die lijst kan, verder precies hetzelfde. Met de camera neem of kies je eerst een foto: ze gaat mee naar
// het formulier dat je kiest (en wordt daar gelezen als je dat aanzette). Lijsten die je bij de + verborg, staan er
// niet (Je lijsten in Jouw gegevens); op die lijst zelf wel.

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { shownIn } from "../../shared/apps";
import { buildTargets, fold, matchTargets, targetPath, type Targets } from "../../shared/targets";
import type { ThingRef } from "../../shared/model";
import { api, useApi } from "../api";
import { listIcon } from "../lists";
import { useNavigate } from "../router";
import { useSession } from "../session";
import { isTouch } from "../device";
import { clearShared, putShared } from "../shared-file";
import { AiMark } from "./Fields";
import { PhotoSheet, usePhotoInputs } from "./PhotoPicker";
import { LINKS_MAP, LINKS_PLACE, placesOf } from "./Sidebar";
import { Icon, type IconName } from "./Icon";

type Entry = { key: string; group: string; label: string; hint?: string; icon: IconName; to: string };
export type PaletteMode = "search" | "add";
/** Enkel deze lijst (de + op een lijst): eerst een ding toevoegen (`thing`) of eerst loggen, en eventueel plannen. */
export type PaletteScope = { list: string; thing?: boolean; planned?: boolean };

type Found = { lists: { id: string; name: string }[]; things: { id: string; name: string; list: string; icon: string | null }[]; events: { id: string; name: string; list: string; at: string }[] };

const NEW_LIST: Entry = { key: "new-list", group: "Nieuw", label: "Nieuwe lijst", icon: "folder", to: "/lijsten/nieuw" };

const PER_GROUP = 6;
const ADD_SHOWN = 8;
const ADD_TOP = 3;

/** Het palet openen vanaf eender waar (de + op het overzicht, een snelkoppeling, gedeelde tekst). */
export const PaletteContext = createContext<(mode: PaletteMode, text?: string, scope?: PaletteScope) => void>(() => {});
export const usePalette = () => useContext(PaletteContext);

export function CommandPalette({ open, mode, text = "", scope, onClose }: { open: boolean; mode: PaletteMode; text?: string; scope?: PaletteScope; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { lists, tags, boards, hidden, ai } = useSession();
  // Ga naar: je borden, Verbanden en jij.
  const ACTIONS: Entry[] = useMemo(
    () => [
      ...[...placesOf(boards), LINKS_PLACE, LINKS_MAP].map((p) => ({ key: p.to, group: "Ga naar", label: p.label, icon: p.icon, to: p.to })),
      { key: "me", group: "Ga naar", label: "Jouw gegevens", icon: "user", to: "/ik" },
    ],
    [boards],
  );
  const { data: raw } = useApi<Targets>(open ? "/me/targets" : null);
  const all = useMemo(() => (raw ? buildTargets(raw) : []), [raw]);
  // Op een lijst: enkel haar plekken (wat je wil toevoegen eerst); anders alles wat je niet verborg.
  const targets = useMemo(
    () =>
      scope
        ? [...all.filter((t) => t.list_id === scope.list && t.thing === Boolean(scope.thing)), ...all.filter((t) => t.list_id === scope.list && t.thing !== Boolean(scope.thing))]
        : all.filter((t) => shownIn(hidden, "add", t.list_id)),
    [all, scope, hidden],
  );
  const scopeList = scope ? lists.find((l) => l.id === scope.list) : undefined;
  // De foto bij de +: klaargezet voor het formulier, en of de AI ze daar leest.
  const [photo, setPhoto] = useState<{ name: string; read: boolean } | null>(null);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [photoRead, setPhotoRead] = useState(ai);
  const pick = usePhotoInputs(async (file) => {
    if (await putShared(file)) setPhoto({ name: file.name, read: ai && photoRead });
  });
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
      setPhoto(null);
      setPhotoRead(ai);
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
      hint: scope ? undefined : (target.hint ?? undefined),
      icon: (target.icon ?? "plus") as IconName,
      to: withExtras(targetPath(target, rest), { planned: Boolean(scope?.planned && !target.thing), photo }),
    }));
    if (scope) return add;
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
  }, [query, lists, tags, found, targets, named, mode, scope, photo]);

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
  // Dicht zonder te kiezen: de klaargezette foto mag weg.
  const dismiss = () => {
    if (photo) clearShared();
    onClose();
  };

  const label = mode === "add" ? "Toevoegen" : "Zoeken";
  return (
    <dialog
      ref={ref}
      className="palette"
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
      onClick={(e) => e.target === e.currentTarget && dismiss()}
    >
      <div className="palette-search">
        <Icon name={mode === "add" ? "plus" : "search"} size={16} />
        {scopeList && <span className="palette-scope">{scopeList.name}</span>}
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
        {mode === "add" && (
          <button type="button" className="btn btn-ghost btn-icon palette-camera" aria-label="Foto" onClick={() => setPhotoSheet(true)}>
            <Icon name="camera" size={18} />
          </button>
        )}
        <kbd>Esc</kbd>
      </div>
      {photo && (
        <div className="palette-photo">
          <Icon name="image" size={15} />
          <span className="photo-name">{photo.name}</span>
          {photo.read && <AiMark />}
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            aria-label="Foto weghalen"
            onClick={() => {
              setPhoto(null);
              clearShared();
            }}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {pick.inputs}
      <PhotoSheet
        open={photoSheet}
        touch={isTouch()}
        read={ai ? photoRead : null}
        onRead={setPhotoRead}
        onClose={() => setPhotoSheet(false)}
        onCamera={() => (setPhotoSheet(false), pick.camera())}
        onLibrary={() => (setPhotoSheet(false), pick.library())}
      />
      <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
        {highlight && <span className="palette-highlight" style={{ "--top": `${highlight.top}px`, "--h": `${highlight.height}px` } as CSSProperties} />}
        {results.length === 0 && <p className="palette-empty">{query.trim() ? `Niets gevonden voor “${query.trim()}”` : "Niets om toe te voegen"}</p>}
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

/** Het pad van een plek, met plannen en de foto erbij (`foto=gedeeld`, `lezen=1` als de AI ze moet lezen). */
function withExtras(path: string, extra: { planned: boolean; photo: { read: boolean } | null }): string {
  const q = new URLSearchParams();
  if (extra.planned) q.set("gepland", "1");
  if (extra.photo) q.set("foto", "gedeeld");
  if (extra.photo?.read) q.set("lezen", "1");
  const more = q.toString();
  return more ? `${path}${path.includes("?") ? "&" : "?"}${more}` : path;
}
