// Het overzicht: je borden (Overzicht, Keuken) met blokken die je zelf kiest (zie shared/board.ts). Elk blok haalt
// zijn inhoud op met de gewone routes, dus met jouw rechten. Zie STIJLBOEK.md → Patronen per scherm → Overzicht.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { BLOCK_ITEMS, BLOCK_KINDS, blockKey, type Block, type BoardInfo } from "../../shared/board";
import { CHART_AGGS, CHART_FORMS, CHART_STEPS, computeChart, isDateField, isGroupField, isNumberField, type ChartDef, type ChartForm, type ChartStep } from "../../shared/charts";
import type { Transfer } from "../../shared/ledger";
import { logFields, logItem } from "../../shared/logview";
import { brusselsNow, minutesBetween, type EventView, type ListDetail, type ThingRow } from "../../shared/model";
import type { Nutrition } from "../../shared/food";
import { formatDuration } from "../../shared/fields";
import { formatAmount } from "../../shared/units";
import { viewFields } from "../../shared/views";
import type { Person } from "../../shared/types";
import { api, useApi } from "../api";
import { formatCents, formatTotal, today } from "../format";
import { groupByTag, listIcon, listTone } from "../lists";
import { Link } from "../router";
import { useSession } from "../session";
import { ChartView } from "./Chart";
import { usePalette } from "./CommandPalette";
import { useConfirm } from "./ConfirmDialog";
import { CardHead, Segmented, Tabs } from "./Controls";
import { namesFrom } from "./Fields";
import { Icon, type IconName } from "./Icon";
import { Combo, useThingOptions } from "./ItemPicker";
import { EventRow, usePageNames, type EventPage } from "./Log";
import { stagger } from "./Motion";
import { EmptyState, PageHead } from "./Page";
import { Sheet } from "./Sheet";
import { useSortable } from "./Sortable";
import { useToast } from "./Toast";

export type Overview = { board: string; boards: BoardInfo[]; blocks: Block[]; custom: boolean };

/** Blokken zonder gaten (metselwerk): elk blok neemt zoveel rijen van 8px als het hoog is. */
function useMasonry() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const ROW = 8;
    const GAP = 16;
    const fit = (el: Element) => {
      (el as HTMLElement).style.gridRowEnd = `span ${Math.ceil((el.getBoundingClientRect().height + GAP) / ROW)}`;
    };
    // Na het tekenen aanpassen: anders meldt de browser een lus (ResizeObserver loop).
    let frame = 0;
    const sizes = new ResizeObserver((entries) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => entries.forEach((e) => fit(e.target)));
    });
    const watch = () => {
      for (const el of grid.children) {
        fit(el);
        sizes.observe(el);
      }
    };
    watch();
    grid.classList.add("masonry");
    const added = new MutationObserver(watch);
    added.observe(grid, { childList: true });
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      added.disconnect();
      grid.classList.remove("masonry");
    };
  });
  return ref;
}

const BOARD_KEY = "thuis.board";
const storedBoard = () => {
  try {
    return localStorage.getItem(BOARD_KEY);
  } catch {
    return null;
  }
};
const storeBoard = (id: string) => {
  try {
    localStorage.setItem(BOARD_KEY, id);
  } catch {
    // Zonder opslag begint dit toestel bij het eerste overzicht.
  }
};

export function BoardView({ overview: first, onChanged }: { overview: Overview; onChanged: () => void }) {
  const { lists, tags } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const palette = usePalette();
  const [params, setParams] = useSearchParams();
  const [boardId, setBoardId] = useState(() => params.get("bord") ?? storedBoard() ?? first.board);
  const { data: fetched, mutate } = useApi<Overview>(boardId !== first.board ? `/me/overview?board=${encodeURIComponent(boardId)}` : null);
  const overview = boardId === first.board ? first : (fetched ?? first);
  const [editing, setEditing] = useState<Block[] | null>(null);
  const [menu, setMenu] = useState<"menu" | "new" | "rename" | null>(null);
  const [boardName, setBoardName] = useState("");
  const [busy, setBusy] = useState(false);
  const masonry = useMasonry();
  const current = overview.boards.find((b) => b.id === overview.board);
  const blocks = editing ?? overview.blocks;

  // Toevoegen vanuit een snelkoppeling (?toevoegen=1, met ?tekst=).
  useEffect(() => {
    if (params.get("toevoegen") !== "1") return;
    palette("add", params.get("tekst") ?? "");
    setParams({}, { replace: true });
  }, []);

  function chooseBoard(id: string) {
    setEditing(null);
    setBoardId(id);
    storeBoard(id);
  }

  async function save(next: Block[] | null) {
    setBusy(true);
    try {
      await api.put("/me/overview", { board: overview.board, blocks: next });
      setEditing(null);
      toast("Overzicht bewaard");
      if (boardId === first.board) onChanged();
      else mutate(await api.get<Overview>(`/me/overview?board=${encodeURIComponent(boardId)}`));
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }

  async function saveBoards(next: { id?: string; name: string }[], go?: (saved: BoardInfo[]) => string) {
    setBusy(true);
    try {
      const { boards } = await api.put<{ boards: BoardInfo[] }>("/me/boards", { boards: next });
      setMenu(null);
      const to = go?.(boards);
      onChanged();
      if (to) chooseBoard(to);
      return true;
    } catch (err) {
      toast((err as Error).message, "alert");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removeBoard() {
    if (!current || !(await confirm({ title: `${current.name} verwijderen?`, confirmLabel: "Verwijderen", danger: true }))) return;
    if (await saveBoards(overview.boards.filter((b) => b.id !== current.id), (saved) => saved[0].id)) toast(`${current.name} verwijderd`);
  }

  const menuRow = (icon: IconName, label: string, run: () => void) => (
    <li key={label}>
      <button type="button" className="row" onClick={run}>
        <span className="cell-main">
          <span className="row-media">
            <Icon name={icon} size={16} />
          </span>
          <span className="row-title">{label}</span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="page">
      <PageHead
        title={current?.name ?? "Overzicht"}
        actions={
          editing ? (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(null)}>
              Standaard
            </button>
          ) : (
            <button type="button" className="btn btn-outline btn-icon" aria-label="Meer opties" aria-haspopup="dialog" onClick={() => setMenu("menu")}>
              <Icon name="dots" size={16} />
            </button>
          )
        }
        primary={
          !editing && (
            <button type="button" className="btn btn-primary" onClick={() => palette("add")}>
              <Icon name="plus" size={16} /> Toevoegen
            </button>
          )
        }
      />
      {overview.boards.length > 1 && !editing && (
        <Tabs label="Overzicht" value={overview.board} tabs={overview.boards.map((b) => ({ value: b.id, label: b.name }))} onChange={chooseBoard} />
      )}

      {editing ? (
        <div className="form">
          <BlocksEditor blocks={editing} onChange={setEditing} />
          <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => save(editing)}>
            Klaar
          </button>
        </div>
      ) : blocks.length === 0 ? (
        <EmptyState
          icon="sliders"
          title="Leeg overzicht"
          action={
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing([])}>
              <Icon name="sliders" size={15} /> Aanpassen
            </button>
          }
        />
      ) : (
        <div className="dashboard stagger" ref={masonry}>
          {blocks.map((b, i) => (
            <BlockView key={blockKey(b)} block={b} index={i} />
          ))}
        </div>
      )}

      {/* Zonder zijbalk met lijsten (gsm, tablet): je lijsten per tag onder het overzicht. */}
      {!editing && (
        <section className="home-projects">
          {groupByTag(lists, tags).map((g) => (
            <div key={g.tag?.id ?? "zonder"}>
              <h2 className="section-title">{g.tag?.name ?? "Zonder tag"}</h2>
              <div className="card">
                <ul className="rows">
                  {g.lists.map((l) => (
                    <li key={l.id}>
                      <Link to={`/lijsten/${l.id}`} className="row">
                        <span className="cell-main">
                          <span className={`row-media tone-${listTone(l)}`}>
                            <Icon name={listIcon(l)} size={16} />
                          </span>
                          <span className="row-title">{l.name}</span>
                        </span>
                        <Icon name="next" size={16} className="row-chevron" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
          <Link to="/lijsten/nieuw" className="btn btn-outline btn-sm" style={{ justifySelf: "start" }}>
            <Icon name="plus" size={15} /> Lijst
          </Link>
        </section>
      )}

      {!editing && (
        <button type="button" className="fab" aria-label="Toevoegen" onClick={() => palette("add")}>
          <Icon name="plus" size={24} />
        </button>
      )}

      <Sheet open={menu !== null} title={menu === "new" ? "Nieuw overzicht" : (current?.name ?? "Overzicht")} onClose={() => setMenu(null)}>
        {menu === "menu" ? (
          <ul className="rows sheet-menu">
            {menuRow("sliders", "Aanpassen", () => {
              setMenu(null);
              setEditing(blocks);
            })}
            {menuRow("plus", "Nieuw overzicht", () => {
              setBoardName("");
              setMenu("new");
            })}
            {menuRow("edit", "Hernoemen", () => {
              setBoardName(current?.name ?? "");
              setMenu("rename");
            })}
            {overview.boards.length > 1 && menuRow("trash", "Verwijderen", removeBoard)}
          </ul>
        ) : (
          menu && (
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                const name = boardName.trim();
                if (!name) return;
                if (menu === "new") {
                  const before = new Set(overview.boards.map((b) => b.id));
                  if (await saveBoards([...overview.boards, { name }], (saved) => saved.find((b) => !before.has(b.id))?.id ?? saved[0].id)) toast(`${name} gemaakt`);
                } else if (current && (await saveBoards(overview.boards.map((b) => (b.id === current.id ? { ...b, name } : b))))) toast("Hernoemd");
              }}
            >
              <label className="field">
                <span className="label">Naam</span>
                <input autoFocus required maxLength={30} value={boardName} placeholder="bv. Keuken" onChange={(e) => setBoardName(e.target.value)} />
              </label>
              <button type="submit" className="btn btn-primary" disabled={busy || !boardName.trim()}>
                {menu === "new" ? "Maken" : "Bewaren"}
              </button>
            </form>
          )
        )}
      </Sheet>
    </div>
  );
}

// ---------- blokken ----------

function BlockView({ block, index }: { block: Block; index: number }) {
  const wide = block.wide ? " is-wide" : "";
  const body = (() => {
    switch (block.kind) {
      case "list":
        return <ListBlock block={block} />;
      case "money":
        return <MoneyBlock />;
      case "balance":
        return <BalanceBlock />;
      case "todo":
        return <TodoBlock />;
      case "stock":
        return <StockBlock />;
      case "food":
        return <FoodBlock />;
      case "timers":
        return <TimersBlock />;
      case "quick":
        return <QuickBlock block={block} />;
      case "thing":
        return <ThingBlock id={block.thing} />;
      case "chart":
        return <ChartBlock block={block} />;
    }
  })();
  return (
    <div className={`dash-block${wide}`} style={stagger(index)}>
      {body}
    </div>
  );
}

/** Een lijst: als rij met het aantal, met haar eerste dingen, of met haar laatste gebeurtenissen. */
function ListBlock({ block }: { block: Extract<Block, { kind: "list" }> }) {
  const { data: detail } = useApi<ListDetail>(`/lists/${block.list}`);
  const { data: things } = useApi<{ things: ThingRow[] }>(block.show === "things" ? `/lists/${block.list}/things` : null);
  const { data: log } = useApi<EventPage>(block.show === "log" ? `/lists/${block.list}/events?status=klaar&limit=${BLOCK_ITEMS}` : null);
  const names = usePageNames(log);
  if (!detail) return null;
  const { list, counts } = detail;
  const head = (
    <Link to={`/lijsten/${list.id}`} className="dash-head">
      <span className={`row-media tone-${listTone(list)}`}>
        <Icon name={listIcon(list)} size={16} />
      </span>
      <span className="row-title">{list.name}</span>
      <span className="dash-count">{list.one ? counts.things : counts.events}</span>
    </Link>
  );
  return (
    <section className="card dash-card">
      {head}
      {block.show === "things" && things && (
        <ul className="rows">
          {things.things.slice(0, BLOCK_ITEMS).map((t) => (
            <li key={t.id}>
              <Link to={`/dingen/${t.id}`} className="row">
                <span className="cell-main">
                  <span className="row-title">{t.name}</span>
                </span>
                {t.stock && <span className={`row-end${t.stock.low ? " is-low" : ""}`}>{formatAmount(t.stock.amount, t.stock.unit)}</span>}
              </Link>
            </li>
          ))}
          {!things.things.length && <li className="dash-empty">Leeg</li>}
        </ul>
      )}
      {block.show === "log" && log && (
        <ul className="rows">
          {log.events.map((e) => (
            <li key={e.id}>
              <EventRow e={e} names={names} home={list.id} withDay />
            </li>
          ))}
          {!log.events.length && <li className="dash-empty">Nog niets gelogd</li>}
        </ul>
      )}
    </section>
  );
}

function MoneyBlock() {
  const { data } = useApi<{ total: number; mine: number }>("/insights/money");
  if (!data) return null;
  return (
    <Link to="/geld" className="card dash-card dash-link">
      <CardHead title="Uitgaven deze maand" />
      <div className="card-body money-total">
        <span className="total-value">{formatCents(data.total)}</span>
        {data.mine !== data.total && <span className="muted">Jouw deel {formatCents(data.mine)}</span>}
      </div>
    </Link>
  );
}

function BalanceBlock() {
  const { person } = useSession();
  const { data } = useApi<{ transfers: Transfer[]; people: Person[] }>("/insights/balance");
  if (!data || !data.transfers.length) return null;
  const name = (id: string) => (id === person.id ? "Jij" : (data.people.find((p) => p.id === id)?.name ?? "Iemand"));
  return (
    <Link to="/geld" className="card dash-card dash-link">
      <CardHead title="Wie moet wie" />
      <ul className="rows">
        {data.transfers.map((t, i) => (
          <li key={i} className="row">
            <span className="cell-main">
              <span className="row-title">
                {name(t.from)} → {name(t.to)}
              </span>
            </span>
            <span className="row-end">{formatCents(t.amount)}</span>
          </li>
        ))}
      </ul>
    </Link>
  );
}

function TodoBlock() {
  const { data, reload } = useApi<EventPage>("/insights/todo");
  const names = usePageNames(data);
  const toast = useToast();
  if (!data) return null;
  async function tick(e: EventView) {
    try {
      await api.post(`/events/${e.id}/tick`, e.status === "gepland" ? {} : { undo: true });
      reload();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  return (
    <section className="card dash-card">
      <Link to="/te-doen" className="dash-head">
        <span className="row-title">Te doen</span>
        {data.events.length > 0 && <span className="dash-count">{data.events.length}</span>}
      </Link>
      <ul className="rows">
        {data.events.slice(0, BLOCK_ITEMS).map((e) => (
          <li key={e.id}>
            <EventRow e={e} names={names} home={null} onTick={tick} withDay />
          </li>
        ))}
        {!data.events.length && <li className="dash-empty">Niets te doen</li>}
      </ul>
    </section>
  );
}

type StockItem = { id: string; name: string; list: string; amount: number; unit: string | null; low: boolean; expires: string | null };

function StockBlock() {
  const { data } = useApi<{ things: StockItem[] }>("/insights/stock");
  if (!data) return null;
  const low = data.things.filter((t) => t.low);
  return (
    <section className="card dash-card">
      <Link to="/voorraad" className="dash-head">
        <span className="row-title">Bijna op</span>
        {low.length > 0 && <span className="dash-count">{low.length}</span>}
      </Link>
      <ul className="rows">
        {low.slice(0, BLOCK_ITEMS + 1).map((t) => (
          <li key={t.id}>
            <Link to={`/dingen/${t.id}`} className="row">
              <span className="cell-main">
                <span className="row-main">
                  <span className="row-title">{t.name}</span>
                  <span className="row-meta">
                    <span>{t.list}</span>
                  </span>
                </span>
              </span>
              <span className="row-end is-low">{formatAmount(t.amount, t.unit)}</span>
            </Link>
          </li>
        ))}
        {!low.length && <li className="dash-empty">Alles is er</li>}
      </ul>
    </section>
  );
}

function FoodBlock() {
  const { person } = useSession();
  const day = today();
  const { data } = useApi<{ days: { day: string; people: Record<string, Nutrition> }[]; eaters: Person[] }>(`/insights/food?from=${day}&to=${day}`);
  if (!data) return null;
  const todayPer = data.days.find((d) => d.day === day)?.people ?? {};
  const ids = Object.keys(todayPer);
  return (
    <Link to="/eten" className="card dash-card dash-link">
      <CardHead title="Eten vandaag" />
      <ul className="rows">
        {ids.map((id) => (
          <li key={id} className="row">
            <span className="cell-main">
              <span className="row-title">{id === person.id ? "Jij" : (data.eaters.find((p) => p.id === id)?.name ?? "Iemand")}</span>
            </span>
            <span className="row-end">{formatTotal(todayPer[id].kcal ?? 0)} kcal</span>
          </li>
        ))}
        {!ids.length && <li className="dash-empty">Nog niets gegeten</li>}
      </ul>
    </Link>
  );
}

/** Wat nu loopt (een timer), met de duur tot nu en Stoppen. */
function TimersBlock() {
  const { data, reload } = useApi<EventPage>("/insights/timers");
  const names = usePageNames(data);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!data || !data.events.length) return null;
  const now = brusselsNow();
  return (
    <section className="card dash-card">
      <CardHead title="Loopt nu" />
      <ul className="rows">
        {data.events.map((e) => (
          <li key={e.id} className="row">
            <Link to={`/gebeurtenissen/${e.id}`} className="row-link">
              <span className="cell-main">
                <span className="row-main">
                  <span className="row-title">{names.title(e)}</span>
                  <span className="row-meta">
                    <span>{formatDuration(Math.max(0, minutesBetween(e.at, now) ?? 0))}</span>
                  </span>
                </span>
              </span>
            </Link>
            <button type="button" className="btn btn-outline btn-sm" onClick={async () => (await api.post(`/events/${e.id}/stop`, {}), reload())}>
              Stoppen
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Snel loggen in een lijst: de kop opent het formulier, het veld gaat met je tekst naar het formulier. */
function QuickBlock({ block }: { block: Extract<Block, { kind: "quick" }> }) {
  const { data: detail } = useApi<ListDetail>(`/lists/${block.list}`);
  const palette = usePalette();
  if (!detail) return null;
  const kind = detail.kinds.find((k) => k.id === block.type);
  const label = kind ? kind.name : `Loggen in ${detail.list.name}`;
  return (
    <section className="card dash-card quick-add">
      <Link to={`/lijsten/${block.list}/loggen${block.type ? `?soort=${block.type}` : ""}`} className="dash-head">
        <span className={`row-media tone-${listTone(detail.list)}`}>
          <Icon name={listIcon(detail.list)} size={16} />
        </span>
        <span className="row-title">{label}</span>
      </Link>
      <div className="card-body">
        <button type="button" className="sidebar-search quick-open" onClick={() => palette("add", kind ? `${kind.name} ` : `${detail.list.name} `)}>
          <Icon name="plus" size={15} />
          <span>Typ wat je weet…</span>
        </button>
      </div>
    </section>
  );
}

/** Eén ding: zijn naam en voorraad (de pellets op zolder). */
function ThingBlock({ id }: { id: string }) {
  const { data } = useApi<{ thing: { id: string; name: string }; stock: { amount: number; unit: string | null; low: boolean } | null; list: { name: string } }>(`/things/${id}`);
  if (!data) return null;
  return (
    <Link to={`/dingen/${id}`} className="card dash-card dash-link">
      <CardHead title={data.thing.name} description={data.list.name} />
      {data.stock && (
        <div className="card-body">
          <span className={`total-value${data.stock.low ? " is-low" : ""}`}>{formatAmount(data.stock.amount, data.stock.unit)}</span>
        </div>
      )}
    </Link>
  );
}

// ---------- grafieken ----------

/** De velden en rijen van de bron van een grafiek: het logboek (van een lijst of alles) of de dingen van een lijst. */
function useChartSource(list: string | null, source: "logboek" | "dingen") {
  const { person, lists } = useSession();
  const { data: detail } = useApi<ListDetail>(list ? `/lists/${list}` : null);
  const { data: log } = useApi<EventPage>(source === "logboek" ? `/insights/log${list ? `?list=${list}` : ""}` : null);
  const { data: things } = useApi<{ things: ThingRow[]; people: Person[]; refs: { id: string; name: string; list_id: string; list: string }[] }>(source === "dingen" && list ? `/lists/${list}/things` : null);
  const names = usePageNames(log);
  return useMemo(() => {
    if (source === "dingen") {
      if (!detail || !things) return null;
      const fields = detail.list.fields;
      const n = namesFrom(things.people, things.refs);
      return {
        fields,
        title: detail.list.name,
        items: things.things.map((t) => ({ name: t.name, data: t.data, tag_ids: [], created_at: t.created_at })),
        names: { people: things.people, item: (id: string) => n.item(id), tags: [] },
      };
    }
    if (!log) return null;
    const fields = logFields(log.kinds, log.lists.length ? log.lists : lists);
    return {
      fields,
      title: detail ? detail.list.name : "Alles",
      items: log.events.filter((e) => !e.partial).map((e) => logItem(e, { kind: names.kind(e).name, list: names.list(e.list_id), me: person.id, title: names.title(e) })),
      names: { people: log.people, item: (id: string) => names.thing(id)?.name, tags: [] },
    };
  }, [source, detail, things, log, names, lists, person.id]);
}

function ChartBlock({ block }: { block: Extract<Block, { kind: "chart" }> }) {
  const src = useChartSource(block.list, block.source);
  const [table, setTable] = useState(false);
  const data = useMemo(() => (src ? computeChart(block.chart, viewFields(src.fields), src.items, src.names, today()) : null), [src, block.chart]);
  if (!src || !data) return null;
  const field = block.chart.field ? src.fields.find((f) => f.key === block.chart.field)?.label : undefined;
  const title = [src.title, block.chart.agg === "count" ? "Aantal" : field].filter(Boolean).join(" · ");
  return (
    <section className="card dash-card">
      <CardHead
        title={title}
        description={data.window}
        action={
          <button type="button" className="btn btn-ghost btn-icon btn-sm chart-toggle" aria-pressed={table} aria-label={table ? "Als grafiek" : "Als tabel"} title={table ? "Als grafiek" : "Als tabel"} onClick={() => setTable(!table)}>
            <Icon name="table" size={15} />
          </button>
        }
      />
      <div className="card-body">
        <ChartView data={data} table={table} />
      </div>
    </section>
  );
}

/** Een grafiek samenstellen: bron, vorm, wat ze telt, per welke periode en hoeveel, apart per een keuze. */
function ChartBuilder({ value, onChange }: { value: Extract<Block, { kind: "chart" }>; onChange: (b: Extract<Block, { kind: "chart" }>) => void }) {
  const { lists } = useSession();
  const src = useChartSource(value.list, value.source);
  const fields = src?.fields ?? [];
  const numbers = fields.filter(isNumberField);
  const groups = fields.filter(isGroupField);
  const dates = fields.filter(isDateField);
  const c = value.chart;
  const set = (patch: Partial<ChartDef>) => onChange({ ...value, chart: { ...c, ...patch } });
  return (
    <div className="form">
      <div className="field-row">
        <label className="field">
          <span className="label">Uit</span>
          <select value={value.source} onChange={(e) => onChange({ ...value, source: e.target.value as "logboek" | "dingen", chart: { ...c, date: e.target.value === "logboek" ? "at" : "created", field: undefined, agg: "count", by: undefined } })}>
            <option value="logboek">Het logboek</option>
            <option value="dingen" disabled={!value.list}>
              De dingen
            </option>
          </select>
        </label>
        <label className="field">
          <span className="label">Van</span>
          <select value={value.list ?? ""} onChange={(e) => onChange({ ...value, list: e.target.value || null, source: e.target.value ? value.source : "logboek" })}>
            <option value="">Al je lijsten</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field">
        <span className="label">Als</span>
        <Segmented label="Als" value={c.form} onChange={(form: ChartForm) => set({ form, by: form === "ranked" || form === "parts" ? (c.by ?? groups[0]?.key) : c.by })} options={Object.entries(CHART_FORMS).map(([v, l]) => ({ value: v as ChartForm, label: l }))} />
      </div>
      <div className="field-row">
        <label className="field">
          <span className="label">Telt</span>
          <select value={c.agg === "count" ? "count" : `${c.agg}:${c.field}`} onChange={(e) => (e.target.value === "count" ? set({ agg: "count", field: undefined }) : set({ agg: e.target.value.split(":")[0] as ChartDef["agg"], field: e.target.value.split(":")[1] }))}>
            <option value="count">Aantal</option>
            {numbers.flatMap((f) =>
              (["sum", "avg", "max"] as const).map((agg) => (
                <option key={`${agg}:${f.key}`} value={`${agg}:${f.key}`}>
                  {agg === "sum" ? f.label : `${CHART_AGGS[agg]} ${f.label.toLowerCase()}`}
                </option>
              )),
            )}
          </select>
        </label>
        {dates.length > 0 && (
          <label className="field">
            <span className="label">Volgens</span>
            <select value={c.date} onChange={(e) => set({ date: e.target.value })}>
              {value.source === "dingen" && <option value="created">Toegevoegd op</option>}
              {dates.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="field-row">
        <label className="field">
          <span className="label">Periode</span>
          <select value={c.step} onChange={(e) => set({ step: e.target.value as ChartStep })}>
            {Object.entries(CHART_STEPS).map(([k, s]) => (
              <option key={k} value={k}>
                {s.per}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Hoeveel</span>
          <select value={c.count} onChange={(e) => set({ count: Number(e.target.value) })}>
            {[4, 6, 8, 12, 24, 0].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Alles" : `Laatste ${n} ${CHART_STEPS[c.step].many}`}
              </option>
            ))}
          </select>
        </label>
        {groups.length > 0 && (
          <label className="field">
            <span className="label">Apart per</span>
            <select value={c.by ?? ""} onChange={(e) => set({ by: e.target.value || undefined })}>
              {c.form !== "ranked" && c.form !== "parts" && <option value="">Niets</option>}
              {groups.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

// ---------- aanpassen ----------

function blockLabel(b: Block, lists: { id: string; name: string }[]): string {
  const list = "list" in b && b.list ? lists.find((l) => l.id === b.list)?.name : undefined;
  if (b.kind === "list") return `${list ?? "Lijst"}${b.show === "things" ? " · dingen" : b.show === "log" ? " · logboek" : ""}`;
  if (b.kind === "quick") return `Snel loggen · ${list ?? "lijst"}`;
  if (b.kind === "chart") return `Grafiek · ${list ?? "alles"}`;
  return BLOCK_KINDS[b.kind];
}

function BlocksEditor({ blocks, onChange }: { blocks: Block[]; onChange: (b: Block[]) => void }) {
  const { lists } = useSession();
  const [adding, setAdding] = useState(false);
  const [editingChart, setEditingChart] = useState<number | null>(null);
  const keys = blocks.map(blockKey);
  const sortable = useSortable(
    keys,
    (next) => onChange(next.map((k) => blocks[keys.indexOf(k)])),
    (k) => blockLabel(blocks[keys.indexOf(k)], lists),
  );
  return (
    <>
      <ul className="rows sort-list">
        {blocks.map((b, i) => (
          <li key={keys[i]} {...sortable.itemProps(keys[i])}>
            <div className="row">
              <button {...sortable.handleProps(keys[i])}>
                <Icon name="grip" size={16} />
              </button>
              <span className="cell-main">
                <span className="row-title">{blockLabel(b, lists)}</span>
              </span>
              {b.kind === "chart" && (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Grafiek aanpassen" onClick={() => setEditingChart(i)}>
                  <Icon name="edit" size={15} />
                </button>
              )}
              <button type="button" className="filter wide-only" aria-pressed={Boolean(b.wide)} onClick={() => onChange(blocks.map((x, k) => (k === i ? { ...x, wide: !x.wide || undefined } : x)))}>
                Breed
              </button>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${blockLabel(b, lists)} weghalen`} onClick={() => onChange(blocks.filter((_, k) => k !== i))}>
                <Icon name="close" size={15} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {sortable.status}
      <button type="button" className="btn btn-outline btn-sm" style={{ justifySelf: "start" }} onClick={() => setAdding(true)}>
        <Icon name="plus" size={15} /> Toevoegen
      </button>
      <Sheet open={adding} title="Blok toevoegen" onClose={() => setAdding(false)}>
        {adding && (
          <AddBlock
            onAdd={(b) => {
              onChange([...blocks, b]);
              setAdding(false);
            }}
          />
        )}
      </Sheet>
      <Sheet open={editingChart !== null} title="Grafiek" onClose={() => setEditingChart(null)}>
        {editingChart !== null && blocks[editingChart]?.kind === "chart" && (
          <>
            <ChartBuilder value={blocks[editingChart] as Extract<Block, { kind: "chart" }>} onChange={(b) => onChange(blocks.map((x, k) => (k === editingChart ? b : x)))} />
            <button type="button" className="btn btn-primary" onClick={() => setEditingChart(null)}>
              Klaar
            </button>
          </>
        )}
      </Sheet>
    </>
  );
}

function AddBlock({ onAdd }: { onAdd: (b: Block) => void }) {
  const { lists } = useSession();
  const [kind, setKind] = useState<Block["kind"]>("list");
  const [list, setList] = useState(lists[0]?.id ?? "");
  const [show, setShow] = useState<"count" | "things" | "log">("count");
  const [thing, setThing] = useState<{ id: string; name: string } | null>(null);
  const [text, setText] = useState("");
  const { options, placeOf } = useThingOptions([], text);
  const [chart, setChart] = useState<Extract<Block, { kind: "chart" }>>({ kind: "chart", list: null, source: "logboek", chart: { form: "bars", agg: "count", date: "at", step: "month", count: 6 } });
  const needsList = kind === "list" || kind === "quick";
  const ready = (!needsList || list) && (kind !== "thing" || thing);
  function add() {
    if (kind === "list") onAdd({ kind, list, show });
    else if (kind === "quick") onAdd({ kind, list });
    else if (kind === "thing" && thing) onAdd({ kind, thing: thing.id });
    else if (kind === "chart") onAdd(chart);
    else onAdd({ kind } as Block);
  }
  return (
    <div className="form">
      <label className="field">
        <span className="label">Blok</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as Block["kind"])}>
          {Object.entries(BLOCK_KINDS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {needsList && (
        <label className="field">
          <span className="label">Lijst</span>
          <select value={list} onChange={(e) => setList(e.target.value)}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === "list" && (
        <div className="field">
          <span className="label">Toon</span>
          <Segmented
            label="Toon"
            value={show}
            onChange={setShow}
            options={[
              { value: "count", label: "Aantal" },
              { value: "things", label: "Dingen" },
              { value: "log", label: "Logboek" },
            ]}
          />
        </div>
      )}
      {kind === "thing" && (
        <div className="field">
          <span className="label">Ding</span>
          <Combo
            label="Ding"
            text={thing && !text ? thing.name : text}
            options={options}
            placeOf={placeOf}
            disabled={false}
            placeholder="Zoek of kies…"
            onText={setText}
            onPick={(o) => {
              setThing(o);
              setText("");
            }}
          />
        </div>
      )}
      {kind === "chart" && <ChartBuilder value={chart} onChange={setChart} />}
      <button type="button" className="btn btn-primary" disabled={!ready} onClick={add}>
        Toevoegen
      </button>
    </div>
  );
}

export type { EventView };
