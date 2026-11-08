// De dingen van een lijst: zoeken, filters uit de velden, bewaarde weergaven (filters, sortering, kolommen, groeperen,
// als agenda), en een tabel met de velden die als kolom staan. Telt de lijst voorraad, dan staat rechts hoeveel er
// is, met − en + om te tellen (een telling in het logboek). Zie STIJLBOEK.md → Een lijst tonen.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { occurrences } from "../../shared/agenda";
import { csvFilename, exportValue, toCsv } from "../../shared/csv";
import { formatFieldValue, rangeStatus, refLists, type ChecklistEntry, type FieldDef, type FieldType, type FieldValue, type Names } from "../../shared/fields";
import { brusselsNow, canEdit, type List, type Role, type ThingRef, type ThingRow } from "../../shared/model";
import { measureFor } from "../../shared/stock";
import { formatAmount } from "../../shared/units";
import { canSum, EMPTY_VIEW, groupItems, kindOf, matchesView, NAME, orderItems, sumOf, TAGS, viewFields, type SavedView, type ViewDef } from "../../shared/views";
import type { Person } from "../../shared/types";
import { api, apiUrl, useApi } from "../api";
import { formatNumber, today } from "../format";
import { listIcon, listTone } from "../lists";
import { Link, useNavigate } from "../router";
import { useSession } from "../session";
import { CalendarMonth, gridRange, type CalendarEntry } from "./Calendar";
import { FilterSelect, FilterToggle } from "./Controls";
import { ConditionPills, ViewChips, ViewEditor, type Choices } from "./Filters";
import { namesFrom, ScoreStars } from "./Fields";
import { Icon } from "./Icon";
import { SkeletonRows, stagger } from "./Motion";
import { EmptyState } from "./Page";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

type ThingList = { things: ThingRow[]; people: Person[]; refs: ThingRef[] };

/** Zoeken zonder op hoofdletters of accenten te letten ("creme" vindt "Crème"). */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function valueTexts(def: FieldDef, value: FieldValue | undefined, names: Names): string[] {
  if (value === undefined) return [];
  if (def.type === "multi" && Array.isArray(value)) return value as string[];
  if (def.type === "people" && Array.isArray(value)) return (value as string[]).map(names.person);
  if (def.type === "items" && Array.isArray(value)) return (value as string[]).map(names.item);
  if (def.type === "checklist" && Array.isArray(value)) return [formatFieldValue(def, value), ...(value as ChecklistEntry[]).map((e) => e.text)];
  return [formatFieldValue(def, value, names)];
}

const NUMERIC: FieldType[] = ["money", "number", "score", "year", "duration"];
const isNumeric = (def: FieldDef) => NUMERIC.includes(def.type) || (def.type === "calc" && NUMERIC.includes(def.result!));
const isRange = (def: FieldDef) => def.type === "year_range" || def.type === "date_range";

export function ThingsView({ list, role, onChanged }: { list: List; role: Role; onChanged?: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { person } = useSession();
  const [archived, setArchived] = useState(false);
  const [sheet, setSheet] = useState<"more" | "filters">();
  const edit = canEdit(role) && !list.archived;
  const wideScreen = typeof window !== "undefined" && window.matchMedia("(min-width: 1100px)").matches;
  const { data, error, loading, reload } = useApi<ThingList>(`/lists/${list.id}/things${archived ? "?archived=1" : ""}`);
  const { data: savedViews, reload: reloadViews } = useApi<SavedView[]>(`/views?list=${list.id}&target=dingen`);
  const storeKey = `thuis:weergave:${list.id}`;
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
  const wanted = new URLSearchParams(window.location.search).get("weergave");
  const applied = useRef<string | null>(null);
  useEffect(() => {
    const view = wanted && savedViews?.find((v) => v.id === wanted);
    if (!view || applied.current === wanted) return;
    applied.current = wanted;
    setView({ activeId: view.id, def: view.def });
  }, [wanted, savedViews]);

  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string | null>>({});
  const [now, setNow] = useState<Record<string, boolean>>({});
  const active = savedViews?.find((v) => v.id === activeId) ?? null;
  const names = useMemo(() => namesFrom(data?.people ?? [], data?.refs ?? []), [data]);
  const fields = list.fields;
  const vfields = useMemo(() => viewFields(fields, list.one ?? "Naam"), [fields, list.one]);
  // Vanzelf geen kolom met de eenheid of de verpakking van de voorraad: die staan al bij het aantal.
  const stockKeys = new Set([list.stock?.unit, list.stock?.piece, list.stock?.pack, list.stock?.pack_name, list.stock?.min]);
  const columns = def.columns?.length
    ? def.columns.flatMap((k) => fields.filter((f) => f.key === k))
    : fields.filter((f) => f.column && !stockKeys.has(f.key)).slice(0, (wideScreen ? 3 : 2) - (list.stock ? 1 : 0));
  const filterFields = fields.filter((f) => f.filter && !isRange(f));
  const rangeFields = fields.filter((f) => f.filter && isRange(f));
  const things = useMemo(() => (data?.things ?? []).map((t) => ({ ...t, tag_ids: [] as string[] })), [data]);
  const year = new Date().getFullYear();

  const options = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of filterFields) {
      const values = new Set<string>();
      for (const t of things) valueTexts(f, t.data[f.key], names).forEach((v) => v && values.add(v));
      out[f.key] = [...values].sort((a, b) => (f.type === "year" ? b.localeCompare(a) : a.localeCompare(b, "nl", { numeric: true })));
    }
    return out;
  }, [things, filterFields, names]);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    const out = things.filter((t) => {
      for (const f of filterFields) {
        const want = filters[f.key];
        if (want && !valueTexts(f, t.data[f.key], names).includes(want)) return false;
      }
      for (const f of rangeFields) if (now[f.key] && rangeStatus(t.data[f.key], year) !== "now") return false;
      if (q && ![t.name, ...fields.flatMap((f) => valueTexts(f, t.data[f.key], names))].some((h) => h && fold(h).includes(q))) return false;
      return true;
    });
    const context = { today: today(), me: person.id, names };
    return orderItems(
      out.filter((t) => matchesView(t, def, vfields, context)),
      def,
      vfields,
      names,
    );
  }, [things, query, filters, now, fields, filterFields, rangeFields, names, year, def, vfields, person.id]);

  const filtered = Boolean(query.trim() || def.conditions.length || Object.values(filters).some(Boolean) || Object.values(now).some(Boolean));

  const choices: Choices = (f) => {
    if (f.key === TAGS) return [];
    const kind = kindOf(f);
    if (kind === "select" || kind === "multi") {
      const seen = f.options ?? [...new Set(things.flatMap((t) => (Array.isArray(t.data[f.key]) ? (t.data[f.key] as string[]) : [])))];
      return seen.map((o) => ({ value: o, label: o }));
    }
    if (kind === "person" || kind === "people") return [{ value: "me", label: "Jij" }, ...(data?.people ?? []).filter((p) => p.id !== person.id).map((p) => ({ value: p.id, label: p.name }))];
    if (kind === "item" || kind === "items") return (data?.refs ?? []).filter((r) => refLists(f).includes(r.list_id)).map((r) => ({ value: r.id, label: r.name }));
    return [];
  };

  // Als agenda: elk ding op zijn datum (de weergave kiest welk datumveld).
  const agendaField = def.mode === "agenda" ? fields.find((f) => f.key === def.date) : undefined;
  const agendaEntries: CalendarEntry[] = useMemo(() => {
    if (!agendaField) return [];
    const [from, to] = gridRange(month);
    return shown.flatMap((t) =>
      occurrences(agendaField, t.data[agendaField.key], from, to).map((o, i) => ({
        key: `${t.id}-${i}`,
        title: t.name,
        ...o,
        href: `/dingen/${t.id}`,
        tone: listTone(list),
        icon: listIcon(list),
        meta: columns
          .filter((c) => c.key !== agendaField.key)
          .map((c) => formatFieldValue(c, t.data[c.key], names))
          .filter(Boolean)
          .join(" · "),
      })),
    );
  }, [agendaField, month, shown, list, columns, names]);

  // Voorraad: hoeveel er is, met − en + (een telling na een korte pauze, zodat drie tikken één telling zijn).
  const [counts, setCounts] = useState<Record<string, number>>({});
  const pending = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  function step(t: ThingRow, delta: number) {
    if (!list.stock || !t.stock) return;
    const measure = measureFor(list.stock, t.data);
    const next = Math.max(0, Math.round(((counts[t.id] ?? t.stock.amount) + delta * (measure.pack ?? 1)) * 1000) / 1000);
    setCounts((c) => ({ ...c, [t.id]: next }));
    clearTimeout(pending.current[t.id]);
    pending.current[t.id] = setTimeout(async () => {
      try {
        await api.post(`/lists/${list.id}/events`, {
          kind: "meting",
          name: "Telling",
          status: "gebeurd",
          at: brusselsNow(),
          lines: [{ role: "voor", thing_id: t.id, amount: next, unit: measure.unit }],
        });
        onChanged?.();
      } catch (err) {
        toast((err as Error).message, "alert");
        setCounts((c) => ({ ...c, [t.id]: t.stock!.amount }));
      }
    }, 1200);
  }

  // Exporteren als CSV (wat je nu ziet, met alle velden).
  function exportCsv() {
    const header = [list.one ?? "Naam", ...fields.map((f) => f.label), ...(list.stock ? ["Voorraad", "Eenheid"] : [])];
    const rows = shown.map((t) => [
      t.name,
      ...fields.map((f) => exportValue(f, t.data[f.key], names)),
      ...(list.stock ? [t.stock ? formatNumber(t.stock.amount) : "", t.stock?.unit ?? ""] : []),
    ]);
    const blob = new Blob([toCsv([header, ...rows])], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = csvFilename(list.name, today());
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setSheet(undefined);
  }

  const stockCol = Boolean(list.stock) && !archived;
  const cols = ["minmax(0, 1fr)", ...columns.map((c) => (isNumeric(c) ? "110px" : "minmax(0, 160px)")), ...(stockCol ? ["auto"] : [])].join(" ");
  const groups = def.group ? groupItems(shown, def.group, vfields, names) : [{ key: "", label: "", items: shown }];
  const summed = columns.filter(canSum);
  const sumText = (items: typeof shown) =>
    summed
      .flatMap((c) => {
        const total = sumOf(items, c.key);
        return total === null ? [] : [formatFieldValue(c, total, names)];
      })
      .join(" · ");
  const sumCells = (items: typeof shown) => (
    <>
      {columns.map((c) => {
        const total = canSum(c) ? sumOf(items, c.key) : null;
        return (
          <span key={c.key} className="col col-end">
            {total !== null && <span>{formatFieldValue(c, total, names)}</span>}
          </span>
        );
      })}
      {stockCol && <span className="col" />}
    </>
  );
  let index = 0;
  const row = (t: (typeof shown)[number]) => (
    <li key={t.id} style={stagger(index++)}>
      <ThingRowView
        thing={t}
        list={list}
        columns={columns}
        names={names}
        stepper={
          stockCol && t.stock ? (
            <StockStepper
              amount={counts[t.id] ?? t.stock.amount}
              unit={t.stock.unit}
              low={t.stock.low || (counts[t.id] ?? t.stock.amount) < 0}
              label={t.name}
              edit={edit}
              onStep={(d) => step(t, d)}
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
          <input type="search" placeholder={`Zoek in ${list.name.toLowerCase()}…`} aria-label={`Zoek in ${list.name.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button type="button" className="btn btn-outline btn-icon" aria-label="Meer opties" aria-haspopup="dialog" onClick={() => setSheet("more")}>
          <Icon name="dots" />
        </button>
      </div>

      {savedViews && <ViewChips views={savedViews} active={activeId} onPick={(view) => setView({ activeId: view?.id ?? null, def: view?.def ?? EMPTY_VIEW })} />}

      <div className="filters">
        <button type="button" className={`filter ${def.conditions.length || def.sort || def.columns ? "active" : ""}`} aria-haspopup="dialog" onClick={() => setSheet("filters")}>
          <Icon name="sliders" size={14} /> Filters{def.conditions.length ? ` · ${def.conditions.length}` : ""}
        </button>
        <ConditionPills def={def} fields={vfields} names={names} tags={[]} onRemove={(i) => setDef({ ...def, conditions: def.conditions.filter((_, k) => k !== i) })} />
        {rangeFields.map((f) => (
          <FilterToggle key={f.key} on={now[f.key] ?? false} onChange={(on) => setNow((n) => ({ ...n, [f.key]: on }))}>
            <Icon name="clock" size={14} /> {f.label}: nu
          </FilterToggle>
        ))}
        {filterFields
          .filter((f) => options[f.key]?.length)
          .map((f) => (
            <FilterSelect
              key={f.key}
              label={f.label}
              all="Alle"
              value={filters[f.key] ?? null}
              onChange={(v) => setFilters((x) => ({ ...x, [f.key]: v }))}
              options={options[f.key].map((v) => ({ value: v, label: v }))}
            />
          ))}
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
          icon={listIcon(list)}
          title={filtered || archived ? "Niets gevonden" : `Nog geen ${list.name.toLowerCase()}`}
          action={
            edit &&
            !filtered &&
            !archived && (
              <Link to={`/lijsten/${list.id}/nieuw`} className="btn btn-outline btn-sm">
                <Icon name="plus" size={16} /> {list.one} toevoegen
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
          addLabel={`${list.one} toevoegen`}
          onAdd={edit ? (day) => navigate(`/lijsten/${list.id}/nieuw?veld=${agendaField.key}&op=${day}`) : undefined}
        />
      )}

      {!agendaField && shown.length > 0 && (
        <div className="card table table-items" style={{ "--cols": cols } as CSSProperties}>
          <div className="table-head">
            <span>
              <SortButton field={NAME} label={list.one ?? "Naam"} def={def} onSort={setDef} />
            </span>
            {columns.map((c, k) => (
              <span key={c.key} className={isNumeric(c) || (k === columns.length - 1 && !stockCol) ? "end" : undefined}>
                <SortButton field={c.key} label={c.label} def={def} onSort={setDef} />
              </span>
            ))}
            {stockCol && <span className="end">Voorraad</span>}
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
              ...g.items.map((t) => row(t)),
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

      <Sheet open={sheet === "filters"} title="Filters" onClose={() => setSheet(undefined)}>
        {sheet === "filters" && (
          <ViewEditor
            fields={vfields}
            columnsFrom={fields}
            initial={def}
            active={active}
            choices={choices}
            canShare={edit}
            listId={list.id}
            target="dingen"
            onApply={(next) => {
              setDef(next);
              setSheet(undefined);
            }}
            onSaved={(view) => {
              reloadViews();
              setView({ activeId: view.id, def: view.def });
              setSheet(undefined);
            }}
            onDeleted={() => {
              reloadViews();
              setView({ activeId: null, def: EMPTY_VIEW });
              setSheet(undefined);
            }}
          />
        )}
      </Sheet>

      <Sheet open={sheet === "more"} title={list.name} onClose={() => setSheet(undefined)}>
        <ul className="rows sheet-menu">
          {edit && (
            <li>
              <Link to={`/lijsten/${list.id}/importeren`} className="row">
                <span className="cell-main">
                  <span className="row-media">
                    <Icon name="table" size={16} />
                  </span>
                  <span className="row-title">Importeren</span>
                </span>
              </Link>
            </li>
          )}
          {edit && (
            <li>
              <Link to={`/lijsten/${list.id}/uit-lijst`} className="row">
                <span className="cell-main">
                  <span className="row-media">
                    <Icon name="copy" size={16} />
                  </span>
                  <span className="row-title">Toevoegen uit andere lijst</span>
                </span>
              </Link>
            </li>
          )}
          {shown.length > 0 && (
            <li>
              <button type="button" className="row" onClick={exportCsv}>
                <span className="cell-main">
                  <span className="row-media">
                    <Icon name="download" size={16} />
                  </span>
                  <span className="row-title">Exporteren</span>
                </span>
              </button>
            </li>
          )}
          <li>
            <button
              type="button"
              className="row"
              onClick={() => {
                setArchived(!archived);
                setSheet(undefined);
                reload();
              }}
            >
              <span className="cell-main">
                <span className="row-media">
                  <Icon name="archive" size={16} />
                </span>
                <span className="row-title">{archived ? "Terug naar de lijst" : "Archief"}</span>
              </span>
            </button>
          </li>
        </ul>
      </Sheet>
    </>
  );
}

/** Een kolomkop die sorteert: oplopend, aflopend, weer zoals het was. */
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

/** Eén ding als rij: foto of icoon, naam, de kolommen (op gsm in de grijze regel), en rechts de voorraad. */
export function ThingRowView({ thing, list, columns, names, stepper }: { thing: ThingRow; list: Pick<List, "icon" | "one" | "id" | "color">; columns: FieldDef[]; names: Names; stepper?: ReactNode }) {
  const meta = columns.map((c) => formatFieldValue(c, thing.data[c.key], names)).filter(Boolean);
  return (
    <div className="row">
      <Link to={`/dingen/${thing.id}`} className="row-link">
        <span className="cell-main">
          {thing.photo_version ? (
            <span className="row-media">
              <img src={apiUrl(`/things/${thing.id}/photo?v=${thing.photo_version}`)} alt="" loading="lazy" />
            </span>
          ) : (
            <span className={`row-media tone-${listTone({ ...list, color: list.color ?? null })}`}>
              <Icon name={listIcon(list)} size={17} />
            </span>
          )}
          <span className="row-main">
            <span className="row-title">{thing.name}</span>
            {meta.length > 0 && (
              <span className="row-meta narrow-only">
                <span>{meta.join(" · ")}</span>
              </span>
            )}
          </span>
        </span>
        {columns.map((c) => {
          const v = thing.data[c.key];
          return (
            <span key={c.key} className={`col${isNumeric(c) ? " col-end" : ""}`}>
              {v === undefined ? <span className="muted">—</span> : c.type === "score" && typeof v === "number" ? <ScoreStars value={v} /> : <span>{formatFieldValue(c, v, names)}</span>}
            </span>
          );
        })}
      </Link>
      {stepper}
    </div>
  );
}

/** − en + rechts in een rij: hoeveel er is (in de eenheid van het ding), rood als het op of bijna op is. */
function StockStepper({ amount, unit, low, label, edit, onStep }: { amount: number; unit: string | null; low: boolean; label: string; edit: boolean; onStep: (delta: number) => void }) {
  const shown = unit ? formatAmount(amount, unit) : formatNumber(amount);
  return (
    <span className="row-stepper">
      {edit && (
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${label}: één minder`} disabled={amount <= 0} onClick={() => onStep(-1)}>
          <Icon name="minus" size={15} />
        </button>
      )}
      <span className={`row-stepper-value${low ? " is-low" : ""}`}>{shown}</span>
      {edit && (
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${label}: één meer`} onClick={() => onStep(1)}>
          <Icon name="plus" size={15} />
        </button>
      )}
    </span>
  );
}
