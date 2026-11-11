// Eén veld voor alles (⌘K, Zoeken onderaan, of de + op het overzicht): zoeken naar een lijst, een ding of iets dat
// gebeurde, en iets toevoegen. De + is voor wat er gebeurde, in drie groepen: **Loggen** (de formulieren; typ je een
// ding, dan "Uit eten · Het Forum" met dat ding al ingevuld, zie `logForms`), **Nieuw** (een ding in een lijst:
// Restaurant “Foru”) en **Openen** (wat je typte, om naartoe te gaan). Typ "gegeten pasta 300 g" en bovenaan staat
// "Gegeten: pasta 300 g" (het formulier opent met die tekst, zie shared/targets.ts). Pijltjes kiezen, Enter opent,
// Escape sluit. Op een lijst (`scope`) staat er enkel wat bij die lijst hoort (ook Aankoop in Uitgaven bij Wijnen).
// Kies je een formulier met een ding ("Uit eten · Het Forum") of iets nieuws, dan vul je het hier stap voor stap in (zie
// shared/steps.ts): het invulveld wordt telkens het volgende veld, met suggesties; leeg is overslaan, na het laatste
// bewaar je (met Ongedaan maken), en Alles invullen opent het formulier met wat er al staat. Met de camera neem of kies je eerst een foto: ze gaat mee naar
// het formulier dat je kiest (en wordt daar gelezen als je dat aanzette). Lijsten die je bij de + verborg, staan er
// niet (Je lijsten in Jouw gegevens); op die lijst zelf wel.

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { shownIn } from "../../shared/apps";
import { brusselsNow, type ListDetail, type Role, type ThingRef } from "../../shared/model";
import { canStep, eventBody, eventSteps, memoryOf, prefillOf, readStep, stepSuggestions, thingBody, thingSteps, type Step, type StepValues } from "../../shared/steps";
import { buildTargets, fold, hasPrice, logForms, logPath, matchTargets, pricedFirst, restAfter, targetPath, withoutPrice, type LogForm, type Match, type Target, type Targets } from "../../shared/targets";
import { parseMoney, type Attributes } from "../../shared/fields";
import { api, useApi } from "../api";
import { REFRESH_EVENT } from "../device";
import { enqueue, isOffline } from "../outbox";
import { useToast } from "./Toast";
import type { EventPage } from "./Log";
import { listIcon } from "../lists";
import { useNavigate } from "../router";
import { useSession } from "../session";
import { isTouch } from "../device";
import { clearShared, putShared } from "../shared-file";
import { AiMark } from "./Fields";
import { PhotoSheet, usePhotoInputs } from "./PhotoPicker";
import { LINKS_MAP, LINKS_PLACE, placesOf } from "./Sidebar";
import { Icon, type IconName } from "./Icon";

type Entry = { key: string; group: string; label: string; hint?: string; icon?: IconName; to?: string; run?: () => void };

/** Stap voor stap invullen: wat je invult (een gebeurtenis met een ding, of een nieuw ding), de stappen en wat er al staat. */
type Flow = {
  title: string;
  icon: IconName;
  /** Wat er in het palet stond voor je begon (terug brengt het terug). */
  query: string;
  /** null: nog aan het laden. */
  steps: Step[] | null;
  index: number;
  values: StepValues;
  texts: Record<string, string>;
  error?: string;
  busy?: boolean;
  people: { id: string; name: string; role: Role }[];
  memory: Record<string, string[]>;
  target:
    | { kind: "event"; form: LogForm & { kind: NonNullable<LogForm["kind"]> }; thing: { id: string; name: string; unit: string | null }; rest: string }
    | { kind: "thing"; list: string; name: string };
};

const placeholderOf = (step: Step) => (step.type === "qty" && step.unit ? `${step.label} (${step.unit})` : step.label);
const numeric = (step: Step) => step.type === "qty" || step.type === "amount" || (step.type === "field" && ["number", "money", "score", "year"].includes(step.def.type));
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
  const { lists, tags, boards, hidden, ai, person } = useSession();
  const toast = useToast();
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
  const [flow, setFlow] = useState<Flow | null>(null);

  useLayoutEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) {
      setQuery(text);
      setActive(0);
      setFlow(null);
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
    if (flow) return;
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
  }, [query, flow]);

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
              run: !photo && canStep(f.kind) ? () => startEvent({ ...f, kind: f.kind! }, t, restAfter(query, t.name)) : undefined,
            })),
        )
      : [];
    const entry = ({ target, rest }: Match, group: string, label: string): Entry => ({
      key: `a${target.key}`,
      group,
      label,
      hint: scope && target.list_id === scope.list ? undefined : (target.hint ?? undefined),
      icon: (target.icon ?? "plus") as IconName,
      // Op een lijst met een formulier van elders (Aankoop in Uitgaven, vanuit Wijnen): iets nieuws komt in deze lijst.
      to: withExtras(targetPath(target, rest), { ...extras(target.thing), newIn: scope && !target.thing && target.list_id !== scope.list ? scope.list : undefined }),
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
        const e = entry(m, "Nieuw", name ? `${m.target.name} “${name}”` : m.target.name);
        return photo ? e : { ...e, run: () => startThing(m.target, name) };
      });
    // Openen: de dingen die je typte.
    const opens: Entry[] = things.slice(0, PER_GROUP).map((t) => {
      const list = listOf(t.list_id);
      return { key: `d${t.id}`, group: "Openen", label: t.name, hint: scope ? undefined : list?.name, icon: (t.icon ?? (list ? listIcon(list) : "folder")) as IconName, to: `/dingen/${t.id}` };
    });

    if (scope) return scope.thing && !withThing.length ? [...news, ...logs, ...opens] : [...logs, ...news, ...opens];
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

  // ---------- stap voor stap (zie shared/steps.ts) ----------

  const refresh = () => window.dispatchEvent(new Event(REFRESH_EVENT));
  const peopleOf = (detail: ListDetail) => detail.people.filter((p) => p.direct !== "geen").map((p) => ({ id: p.person.id, name: p.person.name, role: p.role }));
  const rowsOf = (raw: unknown): Attributes[] => (Array.isArray(raw) ? raw : ((raw as { things?: unknown[] })?.things ?? [])).map((t) => ((t as { data?: Attributes }).data ?? {}) as Attributes);

  /** Loggen met een formulier over een ding ("Uit eten · Het Forum"): de stappen laden, met wat je eerder invulde. */
  function startEvent(form: Extract<Flow["target"], { kind: "event" }>["form"], thing: { id: string; name: string }, rest: string) {
    const target = { kind: "event" as const, form, thing: { ...thing, unit: null as string | null }, rest };
    setFlow({ title: `${form.label} · ${thing.name}`, icon: form.icon as IconName, query, steps: null, index: 0, values: {}, texts: {}, people: [], memory: {}, target });
    setQuery("");
    setActive(-1);
    Promise.all([
      api.get<ListDetail>(`/lists/${form.list_id}`),
      api.get<{ things: ThingRef[] }>(`/things?ids=${thing.id}`),
      api.get<EventPage>(`/lists/${form.list_id}/events?status=klaar&limit=40`).catch(() => null),
    ]).then(
      ([detail, refs, page]) => {
        const unit = refs.things[0]?.unit ?? null;
        const steps = eventSteps(form.kind, { unit });
        const rows = (page?.events ?? []).filter((e) => e.kind === form.kind.id).map((e) => (e.data ?? {}) as Attributes);
        // Een bedrag in je tekst ("chablis 54 euro") staat al bij Bedrag.
        const cents = hasPrice(rest) ? parseMoney(rest.match(/€?\s*\d+(?:[.,]\d{1,2})?/)?.[0] ?? "") : NaN;
        const priced = Number.isFinite(cents) && steps.some((x) => x.key === "$amount");
        setFlow((f) =>
          f && f.target === target
            ? {
                ...f,
                steps,
                people: peopleOf(detail),
                memory: Object.fromEntries(steps.map((x) => [x.key, memoryOf(rows, x.key)])),
                target: { ...target, thing: { ...target.thing, unit } },
                values: priced ? { $amount: cents } : {},
                texts: priced ? { $amount: String(cents / 100).replace(".", ",") } : {},
              }
            : f,
        );
      },
      () => (onClose(), navigate(logPath(form, thing.id, rest))),
    );
  }

  /** Een nieuw ding (Restaurant “Foru”): de naam als je die nog niet typte, dan de velden die als kolom in de lijst staan. */
  function startThing(t: Target, name: string) {
    const target = { kind: "thing" as const, list: t.list_id, name };
    setFlow({ title: name ? `${t.name} “${name}”` : t.name, icon: t.icon as IconName, query, steps: null, index: 0, values: {}, texts: {}, people: [], memory: {}, target });
    setQuery("");
    setActive(-1);
    Promise.all([api.get<ListDetail>(`/lists/${t.list_id}`), api.get<unknown>(`/lists/${t.list_id}/things`).catch(() => [])]).then(
      ([detail, things]) => {
        const steps = thingSteps(detail.list.fields, Boolean(name));
        const rows = rowsOf(things);
        setFlow((f) => (f && f.target === target ? { ...f, steps, people: peopleOf(detail), memory: Object.fromEntries(steps.map((x) => [x.key, memoryOf(rows, x.key)])) } : f));
      },
      () => (onClose(), navigate(targetPath(t, name))),
    );
  }

  const flowStep = flow?.steps?.[flow.index];
  const flowSuggestions = (step: Step | undefined, text: string) =>
    flow && step
      ? stepSuggestions(step, { people: flow.people, memory: flow.memory[step.key] ?? [] })
          .filter((x) => !text.trim() || fold(x.label).includes(fold(text)) || fold(x.text).startsWith(fold(text)))
          .slice(0, 8)
      : [];

  /** Bewaren: de gebeurtenis zoals het formulier ze zou bewaren, of het nieuwe ding; met Ongedaan maken. */
  async function saveFlow(values: StepValues) {
    if (!flow?.steps || flow.busy) return;
    const steps = flow.steps;
    const t = flow.target;
    setFlow({ ...flow, busy: true, error: undefined });
    try {
      if (t.kind === "event") {
        const body = eventBody(t.form.kind, steps, values, { thing: t.thing, me: person.id, people: flow.people, today: brusselsNow().slice(0, 10), planned: scope?.planned });
        const done = body.status === "gepland" ? "gepland" : "bewaard";
        try {
          const { id } = await api.post<{ id: string }>(`/lists/${t.form.list_id}/events`, body);
          onClose();
          refresh();
          toast(`${t.form.kind.name} ${done}`, "check", {
            label: "Ongedaan maken",
            run: async () => {
              await api.delete(`/events/${id}`);
              refresh();
            },
          });
        } catch (err) {
          if (!isOffline(err)) throw err;
          await enqueue("event", t.form.list_id, `${t.form.kind.name} · ${t.thing.name}`, body);
          onClose();
          toast(`${t.form.kind.name} wacht op internet`);
        }
      } else {
        const body = thingBody(t.name, steps, values);
        if (!body.name) throw new Error("Geef het een naam");
        try {
          const { id } = await api.post<{ id: string }>(`/lists/${t.list}/things`, body);
          onClose();
          refresh();
          toast(`${body.name} bewaard`, "check", {
            label: "Ongedaan maken",
            run: async () => {
              await api.delete(`/things/${id}`);
              refresh();
            },
          });
        } catch (err) {
          if (!isOffline(err)) throw err;
          await enqueue("thing", t.list, body.name, body);
          onClose();
          toast(`${body.name} wacht op internet`);
        }
      }
    } catch (err) {
      setFlow((f) => f && { ...f, busy: false, error: (err as Error).message });
    }
  }

  /** Wat je in deze stap typte, lezen; leeg is overslaan. Null als het niet klopt (de fout staat er dan). */
  function readCurrent(text: string): { values: StepValues; texts: Record<string, string> } | null {
    if (!flow?.steps) return null;
    const step = flow.steps[flow.index];
    if (!step) return { values: flow.values, texts: flow.texts };
    const read = readStep(step, text, { today: brusselsNow().slice(0, 10), people: flow.people });
    if ("error" in read) {
      setFlow({ ...flow, error: read.error });
      return null;
    }
    const values = { ...flow.values };
    if ("skip" in read) delete values[step.key];
    else values[step.key] = read.value;
    return { values, texts: { ...flow.texts, [step.key]: text } };
  }

  /** Naar de volgende stap (met wat je typte of koos); na de laatste: bewaren. */
  function nextStep(text: string) {
    if (!flow?.steps) return;
    const read = readCurrent(text);
    if (!read) return;
    const index = flow.index + 1;
    if (index >= flow.steps.length) return void saveFlow(read.values);
    const following = read.texts[flow.steps[index].key] ?? "";
    setFlow({ ...flow, ...read, index, error: undefined });
    setQuery(following);
    setActive(following.trim() && flowSuggestions(flow.steps[index], following).length ? 0 : -1);
  }

  /** Een stap terug; op de eerste terug naar wat je zocht. */
  function previousStep() {
    if (!flow) return;
    if (flow.index === 0 || !flow.steps) {
      setQuery(flow.query);
      setFlow(null);
      setActive(0);
      return;
    }
    const index = flow.index - 1;
    setFlow({ ...flow, index, error: undefined });
    setQuery(flow.texts[flow.steps[index].key] ?? "");
    setActive(-1);
  }

  /** Alles invullen: het volledige formulier, met wat je al invulde. */
  function openFull() {
    if (!flow) return;
    const read = readCurrent(query) ?? { values: flow.values, texts: flow.texts };
    const pre = prefillOf(flow.steps ?? [], read.values);
    const vooraf = Object.keys(pre).length ? `vooraf=${encodeURIComponent(JSON.stringify(pre))}` : "";
    const t = flow.target;
    let path: string;
    if (t.kind === "event") {
      path = logPath(t.form, t.thing.id, vooraf ? "" : t.rest);
      path = withExtras(vooraf ? `${path}&${vooraf}` : path, { planned: Boolean(scope?.planned), photo: null });
    } else {
      const name = typeof read.values.$name === "string" ? read.values.$name : t.name;
      path = `/lijsten/${t.list}/nieuw?tekst=${encodeURIComponent(name)}${vooraf ? `&${vooraf}` : ""}`;
    }
    onClose();
    navigate(path);
  }

  const flowEntries: Entry[] = flow
    ? [
        ...flowSuggestions(flowStep, query).map((x, i) => ({ key: `s${i}`, group: flowStep!.label, label: x.label, run: () => nextStep(x.text) })),
        ...(flow.steps
          ? [
              {
                key: "save",
                group: "",
                label: "Bewaren",
                icon: "check" as IconName,
                run: () => {
                  const read = readCurrent(query);
                  if (read) void saveFlow(read.values);
                },
              },
              { key: "full", group: "", label: "Alles invullen…", icon: "sliders" as IconName, run: openFull },
            ]
          : []),
      ]
    : [];
  const shownEntries = flow ? flowEntries : results;
  const current = flow ? Math.min(active, shownEntries.length - 1) : Math.min(active, results.length - 1);

  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el) return setHighlight(undefined);
    setHighlight({ top: el.offsetTop, height: el.offsetHeight });
    el.scrollIntoView({ block: "nearest" });
  }, [current, results, open, flow]);

  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    if (entry.run) return entry.run();
    if (!entry.to) return;
    onClose();
    navigate(entry.to);
  };
  // Dicht zonder te kiezen: de klaargezette foto mag weg.
  const dismiss = () => {
    if (photo) clearShared();
    onClose();
  };

  const label = mode === "add" ? "Toevoegen" : "Zoeken";
  const lastStep = Boolean(flow?.steps && flow.index >= flow.steps.length - 1);
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
        {flow ? (
          <button type="button" className="btn btn-ghost btn-icon palette-back" aria-label="Terug" onClick={previousStep}>
            <Icon name="back" size={16} />
          </button>
        ) : (
          <Icon name={mode === "add" ? "plus" : "search"} size={16} />
        )}
        {flow ? <span className="palette-scope is-flow">{flow.title}</span> : scopeList && <span className="palette-scope">{scopeList.name}</span>}
        <input
          autoFocus
          value={query}
          placeholder={flow ? (flowStep ? placeholderOf(flowStep) : "") : mode === "add" ? "Wat gebeurde er?" : "Zoek of voeg toe…"}
          aria-label={flow ? (flowStep?.label ?? flow.title) : label}
          aria-controls="palette-list"
          aria-activedescendant={shownEntries[current] ? `palette-${shownEntries[current].key}` : undefined}
          inputMode={flowStep && numeric(flowStep) ? "decimal" : undefined}
          enterKeyHint={flow ? (lastStep ? "done" : "next") : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            if (flow) {
              setFlow({ ...flow, error: undefined });
              setActive(e.target.value.trim() && flowSuggestions(flowStep, e.target.value).length ? 0 : -1);
            } else setActive(0);
          }}
          onKeyDown={(e) => {
            const n = shownEntries.length;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive(flow ? Math.min(current + 1, n - 1) : (current + 1) % Math.max(n, 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive(flow ? Math.max(current - 1, -1) : (current - 1 + n) % Math.max(n, 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (flow && (current < 0 || !shownEntries[current])) nextStep(query);
              else go(shownEntries[current]);
            } else if (e.key === "Backspace" && flow && !query) {
              e.preventDefault();
              previousStep();
            }
          }}
        />
        {flow?.steps && flow.steps.length > 0 && (
          <span className="palette-step">
            {Math.min(flow.index + 1, flow.steps.length)}/{flow.steps.length}
          </span>
        )}
        {mode === "add" && !flow && (
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
        {flow?.error && <p className="palette-error">{flow.error}</p>}
        {flow && !flow.steps && <p className="palette-empty">…</p>}
        {!flow && results.length === 0 && <p className="palette-empty">{query.trim() ? `Niets gevonden voor “${query.trim()}”` : "Niets om toe te voegen"}</p>}
        {shownEntries.map((entry, i) => (
          <div key={entry.key} className="palette-entry">
            {entry.group !== shownEntries[i - 1]?.group && (entry.group ? <p className="palette-group">{entry.group}</p> : i > 0 && <hr className="palette-divider" />)}
            <div
              id={`palette-${entry.key}`}
              role="option"
              aria-selected={i === current}
              className="palette-option"
              onPointerMove={() => i !== current && setActive(i)}
              onClick={() => go(entry)}
            >
              {entry.icon && <Icon name={entry.icon} size={16} />}
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

/**
 * Het pad van een plek, met plannen en de foto erbij (`foto=gedeeld`, `lezen=1` als de AI ze moet lezen) en waar iets
 * nieuws in een lijn komt (`nieuw=`, zie `logPath`).
 */
function withExtras(path: string, extra: { planned: boolean; photo: { read: boolean } | null; newIn?: string }): string {
  const q = new URLSearchParams();
  if (extra.newIn) q.set("nieuw", extra.newIn);
  if (extra.planned) q.set("gepland", "1");
  if (extra.photo) q.set("foto", "gedeeld");
  if (extra.photo?.read) q.set("lezen", "1");
  const more = q.toString();
  return more ? `${path}${path.includes("?") ? "&" : "?"}${more}` : path;
}
