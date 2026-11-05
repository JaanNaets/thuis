import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import {
  formatFieldValue,
  rangeStatus,
  refLists,
  type Attributes,
  type ChecklistEntry,
  type FieldDef,
  type FieldType,
  type FieldValue,
  type Names,
} from "../../shared/fields";
import type { Item, ItemList, ItemTypeView, ProjectDetail } from "../../shared/types";
import { canSum, EMPTY_VIEW, groupItems, kindOf, matchesView, NAME, orderItems, sumOf, TAGS, viewFields, type SavedView, type ViewDef } from "../../shared/views";
import { api, apiUrl, useApi } from "../api";
import { today } from "../format";
import { useSession } from "../session";
import { Link, useNavigate } from "../router";
import { occurrences } from "../../shared/agenda";
import { CalendarMonth, gridRange, type CalendarEntry } from "./Calendar";
import { FilterSelect, FilterToggle, Switch } from "./Controls";
import { ConditionPills, ViewChips, ViewEditor, type Choices } from "./Filters";
import { namesFrom, ScoreStars } from "./Fields";
import { Icon, type IconName } from "./Icon";
import { SkeletonRows, stagger } from "./Motion";
import { EmptyState } from "./Page";
import { Sheet } from "./Sheet";
import { Barcode } from "./Barcode";
import { addPath } from "../../shared/quickadd";
import { appPath, sameDestination, type AppSettings, type Destination } from "../../shared/apps";
import { sharedFile } from "../shared-file";
import { adjust, ReceiptToStock, RowStepper, StockScanner } from "./Stock";
import { measureOf } from "../../shared/units";
import { useToast } from "./Toast";

/** Zoeken zonder op hoofdletters of accenten te letten ("creme" vindt "Crème"). */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Wat een waarde is als tekst (om op te zoeken en te filteren); bij meerdere waarden elk apart. */
function valueTexts(def: FieldDef, value: FieldValue | undefined, names: Names): string[] {
  if (value === undefined) return [];
  if (def.type === "multi" && Array.isArray(value)) return value as string[];
  if (def.type === "people" && Array.isArray(value)) return (value as string[]).map(names.person);
  if (def.type === "items" && Array.isArray(value)) return (value as string[]).map(names.item);
  if (def.type === "checklist" && Array.isArray(value)) return [formatFieldValue(def, value), ...(value as ChecklistEntry[]).map((e) => e.text)];
  return [formatFieldValue(def, value, names)];
}

const NUMERIC: FieldType[] = ["money", "number", "score", "year", "duration"];
/** Getallen staan rechts in een kolom (ook de uitkomst van een berekening). */
const isNumeric = (def: FieldDef) => NUMERIC.includes(def.type) || (def.type === "calc" && NUMERIC.includes(def.result!));
const isRange = (def: FieldDef) => def.type === "year_range" || def.type === "date_range";

/**
 * De items van één lijst in een project: zoeken, filters uit de velden (en tags), en een tabel met de velden die
 * als kolom staan. Een periode met filter wordt "nu" (bv. een wijn die nu drinkklaar is).
 */
export function ItemsView({ project, type }: { project: ProjectDetail; type: ItemTypeView }) {
  const [archived, setArchived] = useState(false);
  const toast = useToast();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sheet, setSheet] = useState<"scan" | "receipt" | "more" | "shortcut">();
  // Een foto gedeeld vanuit een andere app als kasticket (?kasticket=gedeeld, zie /delen).
  const [sharedReceipt, setSharedReceipt] = useState<File | null>(null);
  const [shortcutText, setShortcutText] = useState("");

  /**
   * Op je beginscherm: een app (Jouw gegevens → App) naar het formulier van deze lijst, of de app die er al heen gaat,
   * en die openen in de browser (daar zet je ze op je beginscherm).
   */
  async function homeScreen() {
    // Het venster meteen openen (anders houdt de browser het tegen), het adres zodra de app er is.
    const opened = window.open("", "_blank");
    try {
      const to: Destination = { kind: "form", project: project.project.id, list: type.id, ...(shortcutText.trim() ? { text: shortcutText.trim() } : {}) };
      let settings = await api.get<AppSettings>("/me/app");
      if (!settings.apps.some((a) => sameDestination(a.to, to))) {
        settings = await api.put<AppSettings>("/me/app", { settings: { ...settings, apps: [...settings.apps, { name: type.name, to }] } });
      }
      const app = settings.apps.find((a) => sameDestination(a.to, to));
      if (!app) throw new Error("Die app kon niet gemaakt worden.");
      const url = `${window.location.origin}${appPath(app.id)}`;
      if (opened) opened.location.href = url;
      else window.location.href = url;
    } catch (err) {
      opened?.close();
      toast((err as Error).message, "alert");
    }
  }
  async function step(id: string, delta: number) {
    try {
      const value = await adjust(id, counter!.key, delta);
      setCounts((c) => ({ ...c, [id]: value }));
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  const { person, projects } = useSession();
  // Op een breed scherm passen meer kolommen (op gsm staan ze toch in de grijze regel).
  const wideScreen = typeof window !== "undefined" && window.matchMedia("(min-width: 1100px)").matches;
  // Weergaven: filters, sortering en kolommen (shared/views.ts); wat je koos, blijft staan zolang de app openstaat.
  const { data: savedViews, reload: reloadViews } = useApi<SavedView[]>(`/projects/${project.project.id}/views?type=${type.id}`);
  const storeKey = `thuis:weergave:${project.project.id}:${type.id}`;
  const [{ activeId, def }, setView] = useState<{ activeId: string | null; def: ViewDef }>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storeKey) ?? "") as { activeId: string | null; def: ViewDef };
    } catch {
      return { activeId: null, def: EMPTY_VIEW };
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(storeKey, JSON.stringify({ activeId, def }));
    } catch {
      // Geen opslag (privévenster): dan enkel zolang je hier bent.
    }
  }, [storeKey, activeId, def]);
  const setDef = (next: ViewDef) => setView((v) => ({ ...v, def: next }));
  // Een weergave uit het adres (?weergave=, bv. vanaf een blok op het overzicht): één keer kiezen als ze er is.
  const [params] = useSearchParams();
  const wanted = params.get("weergave");
  const sharedAsked = useRef(false);
  useEffect(() => {
    if (params.get("kasticket") !== "gedeeld" || sharedAsked.current || !counter || !type.can_create) return;
    sharedAsked.current = true;
    sharedFile().then((file) => {
      if (!file) return;
      setSharedReceipt(file);
      setSheet("receipt");
    });
  }, [params]);
  const applied = useRef<string | null>(null);
  useEffect(() => {
    const view = wanted && savedViews?.find((v) => v.id === wanted);
    if (!view || applied.current === wanted) return;
    applied.current = wanted;
    setView({ activeId: view.id, def: view.def });
  }, [wanted, savedViews]);
  // Met subprojecten: ook de items die eronder in deze lijst staan (elk met jouw rechten daar), met hun project erbij.
  const tree = Boolean(def.tree && project.children.length);
  const listQuery = `type=${type.id}${archived ? "&archived=1" : ""}${tree ? "&sub=1" : ""}`;
  const { data, error, loading, reload } = useApi<ItemList>(`/projects/${project.project.id}/items?${listQuery}`);
  const placeOf = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const elsewhere = (item: Item) => (item.project_id !== project.project.id ? placeOf.get(item.project_id) : undefined);
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const active = savedViews?.find((v) => v.id === activeId) ?? null;
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string | null>>({});
  const [now, setNow] = useState<Record<string, boolean>>({});
  const [tag, setTag] = useState<string | null>(null);

  // Een voorraad: een getal met − en + dat je mag wijzigen, eventueel met een barcode om te scannen.
  const counter = type.fields.find((f) => f.type === "number" && f.counter && type.field_access[f.key] === "edit");
  const codeField = type.fields.find((f) => f.type === "code");
  const names = useMemo(() => namesFrom(data?.people ?? [], data?.refs ?? []), [data]);
  const fields = type.fields;
  // Het getal met − en + staat al rechts in de rij; dat hoeft geen kolom meer te zijn.
  const visibleFields = fields.filter((f) => type.field_access[f.key] !== "none");
  const vfields = useMemo(() => viewFields(visibleFields, type.name_label ?? "Naam"), [fields, type]);
  const columns = def.columns?.length
    ? def.columns.flatMap((k) => visibleFields.filter((f) => f.key === k && !(f === counter && !archived)))
    : fields.filter((f) => f.column && !(f === counter && !archived)).slice(0, wideScreen ? 4 : 2);
  const filterFields = fields.filter((f) => f.filter && !isRange(f));
  const rangeFields = fields.filter((f) => f.filter && isRange(f));
  const items = useMemo(() => data?.items ?? [], [data]);
  const year = new Date().getFullYear();

  const options = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const def of filterFields) {
      const values = new Set<string>();
      for (const item of items) valueTexts(def, item.data[def.key], names).forEach((v) => v && values.add(v));
      out[def.key] = [...values].sort((a, b) => (def.type === "year" ? b.localeCompare(a) : a.localeCompare(b, "nl", { numeric: true })));
    }
    return out;
  }, [items, filterFields, names]);
  const usedTags = project.tags.filter((t) => items.some((i) => i.tag_ids.includes(t.id)));

  const shown = useMemo(() => {
    const q = fold(query.trim());
    const list = items.filter((item) => {
      for (const def of filterFields) {
        const want = filters[def.key];
        if (want && !valueTexts(def, item.data[def.key], names).includes(want)) return false;
      }
      for (const def of rangeFields) if (now[def.key] && rangeStatus(item.data[def.key], year) !== "now") return false;
      if (tag && !item.tag_ids.includes(tag)) return false;
      if (q) {
        const haystack = [
          item.name,
          ...fields.flatMap((f) => valueTexts(f, item.data[f.key], names)),
          ...project.tags.filter((t) => item.tag_ids.includes(t.id)).map((t) => t.name),
        ];
        if (!haystack.some((h) => h && fold(h).includes(q))) return false;
      }
      return true;
    });
    const context = { today: today(), me: person.id, names };
    // Een logboek het nieuwste eerst, of zoals de weergave sorteert (dezelfde regel als op het overzicht).
    return orderItems(
      list.filter((item) => matchesView(item, def, vfields, context)),
      def,
      vfields,
      names,
    );
  }, [items, query, filters, now, tag, fields, filterFields, rangeFields, names, project.tags, year, def, vfields, person.id]);

  const filtered = Boolean(query.trim() || tag || def.conditions.length || Object.values(filters).some(Boolean) || Object.values(now).some(Boolean));

  // Waaruit je kiest bij "is een van": de keuzes, de mensen van het project (met jij), de verwijzingen in de lijst, de tags.
  const choices: Choices = (f) => {
    if (f.key === TAGS) return project.tags.map((t) => ({ value: t.id, label: t.name }));
    const kind = kindOf(f);
    if (kind === "select" || kind === "multi") {
      const seen = f.options ?? [...new Set(items.flatMap((i) => (Array.isArray(i.data[f.key]) ? (i.data[f.key] as string[]) : [])))];
      return seen.map((o) => ({ value: o, label: o }));
    }
    if (kind === "person" || kind === "people")
      return [{ value: "me", label: "Jij" }, ...project.members.filter((m) => m.person.id !== person.id).map((m) => ({ value: m.person.id, label: m.person.name }))];
    if (kind === "item" || kind === "items") return (data?.refs ?? []).filter((r) => refLists(f).includes(r.type_id)).map((r) => ({ value: r.id, label: r.name }));
    return [];
  };
  const exportFilter = def.conditions.length || def.sort ? `&filter=${encodeURIComponent(JSON.stringify(def))}` : "";

  // Als agenda: elk item op zijn datum (de weergave kiest welk datumveld).
  const agendaField = def.mode === "agenda" ? visibleFields.find((f) => f.key === def.date) : undefined;
  const agendaEntries: CalendarEntry[] = useMemo(() => {
    if (!agendaField) return [];
    const [from, to] = gridRange(month);
    return shown.flatMap((item) =>
      occurrences(agendaField, item.data[agendaField.key], from, to).map((o, i) => ({
        key: `${item.id}-${i}`,
        title: item.name,
        ...o,
        href: `/items/${item.id}`,
        tone: elsewhere(item)?.color ?? project.project.color ?? "sky",
        icon: (type.icon ?? "calendar") as IconName,
        meta: [
          elsewhere(item)?.name,
          ...columns.filter((c) => c.key !== agendaField.key).map((c) => formatFieldValue(c, item.data[c.key], names)),
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    );
  }, [agendaField, month, shown, project.project.color, type.icon, columns, names, placeOf]);
  const cols = ["minmax(0, 1fr)", ...columns.map((c) => (isNumeric(c) ? "110px" : "minmax(0, 160px)")), ...(counter && !archived ? ["auto"] : [])].join(" ");
  const icon = (type.icon ?? "folder") as IconName;
  const live = !project.project.archived;
  // Wat bij Meer staat: zelden nodig, dus niet als knoppen naast het zoekveld.
  const actions: { icon: IconName; label: string; run?: () => void; to?: string; href?: string }[] = [
    ...(counter && codeField && !archived ? [{ icon: "scan" as const, label: "Scannen", run: () => setSheet("scan") }] : []),
    ...(counter && type.can_create && live ? [{ icon: "receipt" as const, label: "Kasticket bijtellen", run: () => setSheet("receipt") }] : []),
    ...(type.can_create && live ? [{ icon: "table" as const, label: "Importeren", to: `/projecten/${project.project.id}/importeren?lijst=${type.id}` }] : []),
    ...(type.can_create && live ? [{ icon: "share" as const, label: "Snelkoppeling", run: () => setSheet("shortcut") }] : []),
    ...(items.length > 0 ? [{ icon: "download" as const, label: "Exporteren", href: apiUrl(`/projects/${project.project.id}/items/export?${listQuery}${exportFilter}`) }] : []),
  ];

  // Groeperen (een weergave met `group`) met per groep het aantal en de som, en onderaan het totaal van wat je ziet.
  const groups = def.group ? groupItems(shown, def.group, vfields, names) : [{ key: "", label: "", items: shown }];
  const summed = columns.filter(canSum);
  const sumText = (list: Item[]) =>
    summed
      .flatMap((c) => {
        const total = sumOf(list, c.key);
        return total === null ? [] : [formatFieldValue(c, total, names)];
      })
      .join(" · ");
  const sumCells = (list: Item[]) => (
    <>
      {columns.map((c) => {
        const total = canSum(c) ? sumOf(list, c.key) : null;
        return (
          <span key={c.key} className="col col-end">
            {total !== null && <span>{formatFieldValue(c, total, names)}</span>}
          </span>
        );
      })}
      {counter && !archived && <span className="col" />}
    </>
  );
  let index = 0;
  const row = (item: Item) => (
    <li key={item.id} style={stagger(index++)}>
      <ItemRow
        item={item}
        icon={icon}
        tone={elsewhere(item)?.color ?? project.project.color ?? "sky"}
        place={elsewhere(item)?.name}
        columns={columns}
        names={names}
        tags={project.tags.filter((t) => item.tag_ids.includes(t.id)).map((t) => t.name)}
        stepper={
          counter && !archived ? (
            <RowStepper
              value={counts[item.id] ?? (typeof item.data[counter.key] === "number" ? (item.data[counter.key] as number) : 0)}
              label={item.name}
              onStep={(d) => step(item.id, d)}
              measure={counter.measure || counter.unit ? measureOf(counter, item.data) : undefined}
            />
          ) : undefined
        }
      />
    </li>
  );

  return (
    <>
      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder={`Zoek in ${type.plural.toLowerCase()}…`}
            aria-label={`Zoek in ${type.plural.toLowerCase()}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button type="button" className="btn btn-outline btn-icon" aria-label="Meer opties" aria-haspopup="dialog" onClick={() => setSheet("more")}>
          <Icon name="dots" />
        </button>
      </div>

      {savedViews && (
        <ViewChips
          views={savedViews}
          active={activeId}
          onPick={(view) => setView({ activeId: view?.id ?? null, def: view?.def ?? EMPTY_VIEW })}
        />
      )}

      <div className="filters">
        <button
          type="button"
          className={`filter ${def.conditions.length || def.sort || def.columns ? "active" : ""}`}
          aria-haspopup="dialog"
          onClick={() => setEditing(true)}
        >
          <Icon name="sliders" size={14} /> Filters{def.conditions.length ? ` · ${def.conditions.length}` : ""}
        </button>
        <ConditionPills
          def={def}
          fields={vfields}
          names={names}
          tags={project.tags}
          onRemove={(i) => setDef({ ...def, conditions: def.conditions.filter((_, k) => k !== i) })}
        />
        {rangeFields.map((def) => (
          <FilterToggle key={def.key} on={now[def.key] ?? false} onChange={(on) => setNow((n) => ({ ...n, [def.key]: on }))}>
            <Icon name="clock" size={14} /> {def.label}: nu
          </FilterToggle>
        ))}
        {filterFields
          .filter((def) => options[def.key]?.length)
          .map((def) => (
            <FilterSelect
              key={def.key}
              label={def.label}
              all="Alle"
              value={filters[def.key] ?? null}
              onChange={(v) => setFilters((f) => ({ ...f, [def.key]: v }))}
              options={options[def.key].map((v) => ({ value: v, label: v }))}
            />
          ))}
        {usedTags.length > 0 && (
          <FilterSelect label="Tag" all="Alle" value={tag} onChange={setTag} options={usedTags.map((t) => ({ value: t.id, label: t.name }))} />
        )}
        {/* Aan te zetten bij Meer; staat het aan, dan hier, om met één tik uit te zetten. */}
        {tree && (
          <FilterToggle on onChange={() => setDef({ ...def, tree: undefined })}>
            <Icon name="project" size={14} /> Met subprojecten
          </FilterToggle>
        )}
        {archived && (
          <FilterToggle on onChange={() => setArchived(false)}>
            <Icon name="archive" size={14} /> Archief
          </FilterToggle>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {!data && loading && <SkeletonRows rows={5} />}
      {data && !agendaField && shown.length === 0 && (
        <EmptyState
          icon={icon}
          title={filtered || archived ? "Niets gevonden" : `Nog geen ${type.plural.toLowerCase()}`}
          action={
            type.can_create &&
            !filtered &&
            !archived && (
              <Link to={`/projecten/${project.project.id}/nieuw?lijst=${type.id}`} className="btn btn-outline btn-sm">
                <Icon name="plus" size={16} /> {type.name} toevoegen
              </Link>
            )
          }
        />
      )}

      {agendaField && data && (
        <CalendarMonth
          month={month}
          onMonth={setMonth}
          entries={agendaEntries}
          addLabel={`${type.name} toevoegen`}
          onAdd={
            type.can_create && !project.project.archived
              ? (day) => navigate(`/projecten/${project.project.id}/nieuw?lijst=${type.id}&veld=${agendaField.key}&op=${day}`)
              : undefined
          }
        />
      )}

      {!agendaField && shown.length > 0 && (
        <div className="card table table-items" style={{ "--cols": cols } as CSSProperties}>
          <div className="table-head">
            <span>
              <SortButton field={NAME} label={type.name_label ?? type.name} def={def} onSort={setDef} />
            </span>
            {columns.map((c, k) => (
              <span key={c.key} className={isNumeric(c) || (k === columns.length - 1 && !counter) ? "end" : undefined}>
                <SortButton field={c.key} label={c.label} def={def} onSort={setDef} />
              </span>
            ))}
            {counter && !archived && <span className="end">{counter.label}</span>}
          </div>
          <ul className="rows stagger">
            {groups.flatMap((g) => [
              ...(g.label
                ? [
                    <li key={`groep-${g.key}`} className="group-row table-sum">
                      <span className="cell-main">
                        {g.label} <span className="group-count">{g.items.length}</span>
                      </span>
                      {sumText(g.items) && <span className="sum-text">{sumText(g.items)}</span>}
                      {sumCells(g.items)}
                    </li>,
                  ]
                : []),
              ...g.items.map((item) => row(item)),
            ])}
            {summed.length > 0 && shown.length > 1 && (
              <li className="table-sum table-total">
                <span className="cell-main">Totaal</span>
                <span className="sum-text">{sumText(shown)}</span>
                {sumCells(shown)}
              </li>
            )}
          </ul>
        </div>
      )}

      <Sheet open={sheet === "more"} title={type.plural} onClose={() => setSheet(undefined)}>
        {actions.length > 0 && (
          <ul className="rows sheet-menu">
            {actions.map((a) => {
              const body = (
                <span className="cell-main">
                  <span className="row-media">
                    <Icon name={a.icon} size={16} />
                  </span>
                  <span className="row-title">{a.label}</span>
                </span>
              );
              return (
                <li key={a.label}>
                  {a.to ? (
                    <Link to={a.to} className="row">
                      {body}
                    </Link>
                  ) : a.href ? (
                    // Een bestand, geen ander scherm: een gewone link met `download`.
                    <a href={a.href} download className="row" onClick={() => setSheet(undefined)}>
                      {body}
                    </a>
                  ) : (
                    <button type="button" className="row" onClick={a.run}>
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="form">
          {project.children.length > 0 && <Switch label="Met subprojecten" checked={tree} onChange={(on) => setDef({ ...def, tree: on || undefined })} />}
          <Switch label="Archief" checked={archived} onChange={setArchived} />
        </div>
      </Sheet>

      <Sheet open={sheet === "shortcut"} title={`${type.name} toevoegen`} onClose={() => setSheet(undefined)}>
        {sheet === "shortcut" && (
          <div className="form">
            <label className="field">
              <span className="label">Met tekst</span>
              <input value={shortcutText} maxLength={120} placeholder="bv. pellets" onChange={(e) => setShortcutText(e.target.value)} />
            </label>
            <div className="sticker">
              <Barcode format="qr_code" value={`${window.location.origin}${addPath({ project_id: project.project.id, type_id: type.id }, shortcutText)}`} />
            </div>
            <div className="btn-row">
              <Link
                to={`/projecten/${project.project.id}/sticker?lijst=${type.id}${shortcutText.trim() ? `&tekst=${encodeURIComponent(shortcutText.trim())}` : ""}`}
                className="btn btn-outline"
              >
                <Icon name="download" size={16} /> QR-sticker
              </Link>
              <button type="button" className="btn btn-outline" onClick={homeScreen}>
                <Icon name="home" size={16} /> Op je beginscherm
              </button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={editing} title={active ? active.name : "Filters"} onClose={() => setEditing(false)}>
        {editing && (
          <ViewEditor
            fields={vfields}
            columnsFrom={visibleFields}
            initial={def}
            active={active}
            choices={choices}
            canShare={project.project.rights.manage}
            projectId={project.project.id}
            typeId={type.id}
            onApply={(next) => {
              setDef(next);
              setEditing(false);
            }}
            onSaved={(view) => {
              reloadViews();
              setView({ activeId: view.id, def: view.def });
              setEditing(false);
            }}
            onDeleted={() => {
              reloadViews();
              setView({ activeId: null, def: EMPTY_VIEW });
              setEditing(false);
            }}
          />
        )}
      </Sheet>

      {counter && (
        <>
          <Sheet open={sheet === "scan"} title="Scannen" onClose={() => setSheet(undefined)}>
            {sheet === "scan" && codeField && (
              <StockScanner
                items={items}
                code={codeField}
                counter={counter}
                onChanged={(id, value) => setCounts((c) => ({ ...c, [id]: value }))}
                onClose={() => setSheet(undefined)}
              />
            )}
          </Sheet>
          <Sheet open={sheet === "receipt"} title="Kasticket bijtellen" onClose={() => setSheet(undefined)}>
            {sheet === "receipt" && (
              <ReceiptToStock
                projectId={project.project.id}
                typeId={type.id}
                counter={counter}
                initial={sharedReceipt}
                onDone={() => {
                  setSheet(undefined);
                  setCounts({});
                  reload();
                }}
              />
            )}
          </Sheet>
        </>
      )}
    </>
  );
}

/** Een kolomkop sorteert: eerst oplopend, dan aflopend, dan weer zoals de lijst het doet. */
function SortButton({ field, label, def, onSort }: { field: string; label: string; def: ViewDef; onSort: (def: ViewDef) => void }) {
  const current = def.sort?.[0]?.field === field ? def.sort[0].dir : undefined;
  return (
    <button
      type="button"
      className="table-sort"
      aria-label={`Sorteren op ${label.toLowerCase()}`}
      aria-sort={current === "asc" ? "ascending" : current === "desc" ? "descending" : undefined}
      onClick={() => onSort({ ...def, sort: current === "asc" ? [{ field, dir: "desc" }] : current === "desc" ? undefined : [{ field, dir: "asc" }] })}
    >
      {label}
      {current && <Icon name={current === "asc" ? "up" : "down"} size={13} />}
    </button>
  );
}

export function ItemRow({
  item,
  icon,
  tone,
  place,
  columns,
  names,
  tags,
  stepper,
}: {
  item: { id: string; name: string; data: Attributes; photo_version: number | null };
  icon: IconName;
  tone: string;
  /** Het subproject waar het item staat (met subprojecten). */
  place?: string;
  columns: FieldDef[];
  names: Names;
  tags: string[];
  /** Een voorraad: − en + rechts; de rij is dan geen link, enkel het deel met de naam. */
  stepper?: ReactNode;
}) {
  const meta = [place, ...columns.map((c) => formatFieldValue(c, item.data[c.key], names)), ...tags].filter(Boolean).join(" · ");
  const wide = [place, ...tags].filter(Boolean).join(" · ");
  const main = (
    <>
      {item.photo_version ? (
        <span className="row-media">
          <img src={apiUrl(`/items/${item.id}/photo?v=${item.photo_version}`)} alt="" loading="lazy" />
        </span>
      ) : (
        <span className={`row-media tone-${tone}`}>
          <Icon name={icon} size={16} />
        </span>
      )}
      <span className="row-main">
        <span className="row-title">{item.name}</span>
        {meta && (
          <span className="row-meta narrow-only">
            <span>{meta}</span>
          </span>
        )}
        {wide && (
          <span className="row-meta wide-only">
            <span>{wide}</span>
          </span>
        )}
      </span>
    </>
  );
  const values = (
    <>
      {columns.map((c) => {
        const v = item.data[c.key];
        const end = isNumeric(c) ? "col col-end" : "col";
        return (
          <span key={c.key} className={end}>
            {v === undefined ? (
              <span className="muted">—</span>
            ) : c.type === "score" || (c.type === "calc" && c.result === "score") ? (
              <ScoreStars value={v as number} />
            ) : (
              <span>{formatFieldValue(c, v, names)}</span>
            )}
          </span>
        );
      })}
    </>
  );
  if (!stepper)
    return (
      <Link to={`/items/${item.id}`} className="row">
        <span className="cell-main">{main}</span>
        {values}
      </Link>
    );
  return (
    <div className="row">
      <Link to={`/items/${item.id}`} className="row-link">
        {main}
      </Link>
      {values}
      {stepper}
    </div>
  );
}
