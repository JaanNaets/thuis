// Eén veld voor alles (⌘K, Zoeken onderaan, of de + op het overzicht): zoeken naar een lijst, een ding of iets dat
// gebeurde, en iets toevoegen. De + is voor wat er gebeurde, in drie groepen: **Loggen** (de formulieren; typ je een
// ding, dan "Uit eten · Het Forum" met dat ding al ingevuld, zie `logForms`), **Nieuw** (een ding in een lijst:
// Restaurant “Foru”) en **Openen** (wat je typte, om naartoe te gaan). Typ "gegeten pasta 300 g" en bovenaan staat
// "Gegeten: pasta 300 g" (het formulier opent met die tekst, zie shared/targets.ts). Pijltjes kiezen, Enter opent,
// Escape sluit. Op een lijst (`scope`) staat er enkel wat bij die lijst hoort (ook Aankoop in Uitgaven bij Wijnen). Met de camera neem of kies je eerst een foto: ze gaat mee naar
// het formulier dat je kiest (en wordt daar gelezen als je dat aanzette). Lijsten die je bij de + verborg, staan er
// niet (Je lijsten in Jouw gegevens); op die lijst zelf wel.

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { shownIn } from "../../shared/apps";
import { buildTargets, fold, logForms, logPath, matchTargets, pricedFirst, restAfter, targetPath, withoutPrice, type Match, type Targets } from "../../shared/targets";
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

type Found = { lists: { id: string; name: string }[]; things: { id: string; name: string; list_id: string; list: string; icon: string | null }[]; events: { id: string; name: string; list: string; at: string }[] };

const NEW_LIST: Entry = { key: "new-list", group: "Nieuw", label: "Nieuwe lijst", icon: "folder", to: "/lijsten/nieuw" };

const PER_GROUP = 6;
const ADD_SHOWN = 8;
const ADD_TOP = 3;
/** Zoveel dingen uit je tekst krijgen hun formulieren erbij ("Uit eten · Het Forum"), elk met zoveel formulieren. */
const THINGS_LOGGED = 3;
const FORMS_PER_THING = 3;

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
  // Wat je bij de + verborg, staat er niet; de lijst waarop je staat altijd wel.
  const shown = (id: string) => shownIn(hidden, "add", id) || id === scope?.list;
  // Op een lijst: een nieuw ding erin en de formulieren die bij haar dingen horen (`logForms`); anders alles.
  const targets = useMemo(() => {
    if (!scope) return all.filter((t) => shownIn(hidden, "add", t.list_id));
    const forms = new Set(raw ? logForms(raw, scope.list, shown).map((f) => f.key) : []);
    return all.filter((t) => (t.thing ? t.list_id === scope.list : forms.has(t.key)));
  }, [all, scope, hidden, raw]);
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
    const extras = (thing: boolean) => ({ planned: Boolean(scope?.planned && !thing), photo });
    const listOf = (id: string) => lists.find((l) => l.id === id);
    // De dingen in je tekst ("chablis 54 euro", "foru"): wat de tekst noemt en wat het zoeken vond; op een lijst de hare.
    const seen = new Set<string>();
    const things = [...named.map((t) => ({ id: t.id, name: t.name, list_id: t.list_id, icon: null as string | null })), ...(found?.things ?? [])].filter(
      (t) => !seen.has(t.id) && (seen.add(t.id), !scope || t.list_id === scope.list),
    );

    // Loggen: eerst met een ding uit je tekst (het formulier opent met dat ding als lijn), dan de formulieren zelf.
    const withThing: Entry[] = raw
      ? things.slice(0, THINGS_LOGGED).flatMap((t) =>
          pricedFirst(logForms(raw, t.list_id, shown), query)
            .slice(0, FORMS_PER_THING)
            .map((f) => ({
              key: `l${f.key}|${t.id}`,
              group: "Loggen",
              label: `${f.label} · ${t.name}`,
              hint: f.hint ?? undefined,
              icon: f.icon as IconName,
              to: withExtras(logPath(f, t.id, restAfter(query, t.name)), extras(false)),
            })),
        )
      : [];
    const entry = ({ target, rest }: Match, group: string, label: string): Entry => ({
      key: `a${target.key}`,
      group,
      label,
      hint: scope && target.list_id === scope.list ? undefined : (target.hint ?? undefined),
      icon: (target.icon ?? "plus") as IconName,
      to: withExtras(targetPath(target, rest), extras(target.thing)),
    });
    const forms = matches.filter((m) => !m.target.thing).map((m) => entry(m, "Loggen", m.rest ? `${m.target.label}: ${m.rest}` : m.target.label));
    // Noemt je tekst een ding, dan staan de formulieren al bij dat ding; enkel een formulier dat je zelf noemde nog los.
    const logs = [...withThing, ...(withThing.length && !strong ? [] : forms)].slice(0, ADD_SHOWN);
    // Nieuw: een ding in een lijst, met wat je typte als naam.
    const news = matches
      .filter((m) => m.target.thing)
      .slice(0, ADD_TOP)
      .map((m) => {
        const name = withoutPrice(m.rest);
        return entry(m, "Nieuw", name ? `${m.target.name} “${name}”` : m.target.name);
      });
    // Openen: de dingen die je typte.
    const opens: Entry[] = things.slice(0, PER_GROUP).map((t) => {
      const list = listOf(t.list_id);
      return { key: `d${t.id}`, group: "Openen", label: t.name, hint: scope ? undefined : list?.name, icon: (t.icon ?? (list ? listIcon(list) : "folder")) as IconName, to: `/dingen/${t.id}` };
    });

    if (scope) return scope.thing ? [...news, ...logs, ...opens] : [...logs, ...news, ...opens];
    const add = [...logs, ...news];
    const newList = !q || "nieuwe lijst".startsWith(q) || "lijst".startsWith(q) ? [NEW_LIST] : [];
    if (!q) return mode === "add" ? [...add, ...newList] : [...ACTIONS, ...add.slice(0, ADD_TOP), ...newList];
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
    // De +: wat je typte om naartoe te gaan, onder Openen (de dingen eerst).
    if (mode === "add") {
      const rest = search.filter((e) => e.group !== "Dingen" && !opens.some((o) => o.key === e.key)).map((e) => ({ ...e, group: "Openen" }));
      return [...add, ...newList, ...opens, ...rest];
    }
    // Zoeken: eerst wat je zoekt; begint je tekst met een formulier ("gegeten pasta"), dan dat eerst.
    if (strong) return [...add, ...newList, ...search];
    return [...search, ...add.slice(0, ADD_SHOWN), ...newList];
  }, [query, lists, tags, found, targets, named, mode, scope, photo, raw]);

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
