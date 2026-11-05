// De blokken van je overzicht (zie shared/overview.ts): een project, een lijst, snel toevoegen, een totaal of de
// waarde van één item. Elk blok haalt op wat het toont met jouw rechten; wat je niet (meer) ziet, blijft weg.

import { useState, type CSSProperties } from "react";
import type { BoardPeriod, ChartDef } from "../../shared/charts";
import { formatFieldValue } from "../../shared/fields";
import { BLOCK_ITEMS, BLOCK_KINDS, blockKey, type Block, type BlockKind } from "../../shared/overview";
import { totalLabel } from "../../shared/totals";
import type { ItemDetail, ItemList, Overview, OverviewType, ProjectDetail, ProjectNode } from "../../shared/types";
import { groupItems, viewFields, type SavedView } from "../../shared/views";
import { useApi } from "../api";
import { projectTree } from "../projects";
import { Link } from "../router";
import { useSession } from "../session";
import { CardHead, FilterSelect, Segmented } from "./Controls";
import { namesFrom } from "./Fields";
import { QuickAdd } from "./QuickAdd";
import { ChartBlock, ChartBuilder, chartTitle, newChart, TextBlock, TextBuilder } from "./ChartBlock";
import { TimerBlock } from "./Timer";
import { BalanceCard } from "./Balance";
import { Icon, type IconName } from "./Icon";
import { ItemPicker } from "./ItemPicker";
import { ItemRow } from "./ItemsView";
import { Num, stagger } from "./Motion";
import { Sheet } from "./Sheet";
import { projectIcon } from "./Sidebar";
import { useSortable } from "./Sortable";
import { adjust, RowStepper } from "./Stock";
import { formatAmount, measureOf } from "../../shared/units";
import { useToast } from "./Toast";
import { shownTotals, TotalsCards } from "./Totals";

type Lists = Map<string, OverviewType[]>;

/** Eén lijst als rij: openen, en + om meteen iets toe te voegen. `title`/`href`: een weergave van die lijst. */
function ListRow({ project, type, meta, title, href }: { project: string; type: OverviewType; meta?: string; title?: string; href?: string }) {
  const to = href ?? `/projecten/${project}?lijst=${type.id}`;
  const main = (
    <>
      <span className="cell-main">
        <span className="row-media">
          <Icon name={(type.icon ?? "folder") as IconName} size={16} />
        </span>
        <span className="row-main">
          <span className="row-title">{title ?? type.plural}</span>
          {meta && (
            <span className="row-meta">
              <span>{meta}</span>
            </span>
          )}
        </span>
      </span>
      <span className="row-end">
        <Num value={type.count} />
      </span>
    </>
  );
  const row = type.can_create ? (
    <div className="row">
      <Link to={to} className="row-link">
        {main}
      </Link>
      <Link to={`/projecten/${project}/nieuw?lijst=${type.id}`} className="btn btn-ghost btn-icon btn-sm" aria-label={`${type.name} toevoegen`}>
        <Icon name="plus" size={16} />
      </Link>
    </div>
  ) : (
    <Link to={to} className="row">
      {main}
    </Link>
  );
  return row;
}

/** Een project: de kop opent het project, elke rij een lijst (behalve wat je verborg). */
function ProjectBlock({
  project: p,
  above,
  types,
  hide,
  views,
}: {
  project: ProjectNode;
  above?: string;
  types?: OverviewType[];
  hide?: string[];
  views?: Record<string, string>;
}) {
  const shown = types?.filter((t) => !hide?.includes(t.id));
  return (
    <section className="card dash-card">
      <Link to={`/projecten/${p.id}`} className="dash-head">
        <span className={`row-media tone-${p.color ?? "sky"}`}>
          <Icon name={projectIcon(p)} size={16} />
        </span>
        <span className="row-main">
          <span className="row-title">{p.name}</span>
          {above && (
            <span className="row-meta">
              <span>{above}</span>
            </span>
          )}
        </span>
        <Icon name="next" size={16} className="row-chevron" />
      </Link>
      {!shown ? null : shown.length > 0 ? (
        <ul className="rows">
          {shown.map((t) => (
            <li key={t.id}>{views?.[t.id] ? <ViewCountRow project={p} type={t} view={views[t.id]} /> : <ListRow project={p.id} type={t} />}</li>
          ))}
        </ul>
      ) : (
        <p className="dash-empty">Nog niets om bij te houden</p>
      )}
    </section>
  );
}

/** Eén lijst in een projectblok, geteld volgens een weergave: Voorraad · Te kopen 3 (opent de lijst met die weergave). */
function ViewCountRow({ project, type, view }: { project: ProjectNode; type: OverviewType; view: string }) {
  const { data } = useApi<ItemList>(`/projects/${project.id}/items?type=${type.id}&view=${view}&limit=0`);
  const { data: views } = useViews(project.id, type.id);
  const name = views?.find((v) => v.id === view)?.name;
  return (
    <ListRow project={project.id} type={{ ...type, count: data?.count ?? 0 }} meta={name} href={`/projecten/${project.id}?lijst=${type.id}&weergave=${view}`} />
  );
}

/** De bewaarde weergaven van een lijst (gedeelde en de jouwe). */
const useViews = (project: string, list: string, on = true) => useApi<SavedView[]>(on && project && list ? `/projects/${project}/views?type=${list}` : null);

/**
 * Eén lijst: hoeveel erin zit (of in een weergave: "Te kopen 3"), of met `show: "items"` de eerste items als kleine
 * tabel, in de volgorde van de lijst, met − en + bij een voorraad. De kop opent de lijst (met die weergave).
 */
function ListBlock({ block, project, type }: { block: Extract<Block, { kind: "list" }>; project: ProjectNode; type: OverviewType }) {
  const toast = useToast();
  const asItems = block.show === "items";
  const query = `type=${type.id}${block.view ? `&view=${block.view}` : ""}&limit=${asItems ? BLOCK_ITEMS : 0}`;
  const { data } = useApi<ItemList>(asItems || block.view ? `/projects/${project.id}/items?${query}` : null);
  const { data: views } = useViews(project.id, type.id, Boolean(block.view));
  const { data: detail } = useApi<ProjectDetail>(asItems ? `/projects/${project.id}` : null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const view = views?.find((v) => v.id === block.view);
  const count = block.view ? data?.count : type.count;
  const href = `/projecten/${project.id}?lijst=${type.id}${block.view ? `&weergave=${block.view}` : ""}`;
  const meta = [view ? type.plural : null, project.name].filter(Boolean).join(" · ");

  if (!asItems) return <ListRow project={project.id} type={{ ...type, count: count ?? 0 }} meta={meta} href={href} title={view?.name} />;

  const full = detail?.types.find((t) => t.id === type.id);
  const counter = full?.fields.find((f) => f.type === "number" && f.counter && full.field_access[f.key] === "edit");
  const visible = full?.fields.filter((f) => full.field_access[f.key] !== "none" && f !== counter) ?? [];
  const keys = view?.def.columns?.length ? view.def.columns : visible.filter((f) => f.column).map((f) => f.key);
  const columns = keys.flatMap((k) => visible.filter((f) => f.key === k)).slice(0, block.wide ? 3 : 1);
  const names = namesFrom(data?.people ?? [], data?.refs ?? []);
  const items = data?.items ?? [];
  // Een gegroepeerde weergave: de groepen als stille kopjes (de API gaf de items al groep na groep).
  const groups =
    view?.def.group && full
      ? groupItems(
          items,
          view.def.group,
          viewFields(
            full.fields.filter((f) => full.field_access[f.key] !== "none"),
            full.name_label ?? "Naam",
          ),
          names,
        )
      : [{ key: "", label: "", items }];
  async function step(id: string, delta: number) {
    try {
      const value = await adjust(id, counter!.key, delta);
      setCounts((c) => ({ ...c, [id]: value }));
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  const cols = ["minmax(0, 1fr)", ...columns.map(() => "minmax(0, 120px)"), ...(counter ? ["auto"] : [])].join(" ");
  return (
    <section className={`card dash-card${block.wide ? " table" : ""}`} style={{ "--cols": cols } as CSSProperties}>
      <Link to={href} className="dash-head">
        <span className={`row-media tone-${project.color ?? "sky"}`}>
          <Icon name={(type.icon ?? "folder") as IconName} size={16} />
        </span>
        <span className="row-main">
          <span className="row-title">{view?.name ?? type.plural}</span>
          <span className="row-meta">
            <span>{meta}</span>
          </span>
        </span>
        <span className="row-end">{count !== undefined && <Num value={count} />}</span>
        <Icon name="next" size={16} className="row-chevron" />
      </Link>
      {data && !items.length && <p className="dash-empty">Leeg</p>}
      {items.length > 0 && (
        <ul className="rows">
          {groups.flatMap((g) => [
            ...(g.label
              ? [
                  <li key={`groep-${g.key}`} className="group-row">
                    {g.label}
                  </li>,
                ]
              : []),
            ...g.items.map((item) => (
              <li key={item.id}>
                <ItemRow
                  item={item}
                  icon={(type.icon ?? "folder") as IconName}
                  tone={project.color ?? "sky"}
                  columns={columns}
                  names={names}
                  tags={[]}
                  stepper={
                    counter ? (
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
            )),
          ])}
        </ul>
      )}
    </section>
  );
}

/** Een totaal van een lijst, zoals in de zijkolom van het project. */
function TotalBlock({ project, list, total }: { project: string; list: string; total: string }) {
  const { data } = useApi<ProjectDetail>(`/projects/${project}`);
  const type = data?.types.find((t) => t.id === list);
  return type ? <TotalsCards projectId={project} type={type} only={total} className="dash-card" /> : null;
}

/**
 * Eén veld van één item, groot (ook een berekening): Pellets · Aantal. Een getal met − en + (voorraad) pas je hier
 * meteen aan; een berekend ja/nee-veld dat aan staat (Kopen), staat erbij.
 */
function ValueBlock({ item, field }: { item: string; field: string }) {
  const toast = useToast();
  const { data: it } = useApi<ItemDetail>(`/items/${item}`);
  const { data: p } = useApi<ProjectDetail>(it ? `/projects/${it.project_id}` : null);
  const [value, setValue] = useState<number>();
  const type = it && p ? p.types.find((t) => t.id === it.type_id) : undefined;
  const def = type?.fields.find((f) => f.key === field);
  if (!it || !type || !def) return null;
  const names = { person: (id: string) => it.people.find((x) => x.id === id)?.name ?? "", item: (id: string) => it.refs.find((x) => x.id === id)?.name ?? "" };
  const raw = value ?? it.data[field];
  const counter = def.type === "number" && def.counter && type.field_access[def.key] === "edit";
  // Een voorraad in zijn eenheid (45 kg); − en + per verpakking (een zak van 15 kg).
  const measure = def.measure || def.unit ? measureOf(def, it.data) : undefined;
  const pack = measure?.pack ?? 1;
  const flags = type.fields.filter((f) => f.type === "calc" && f.result === "bool" && it.data[f.key] === true);
  async function step(delta: number) {
    try {
      setValue(await adjust(it!.id, def!.key, delta));
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  return (
    <section className="card dash-card">
      <CardHead title={it.name} description={def.label} />
      <div className="card-body dash-value-row">
        <Link to={`/items/${it.id}`} className="dash-value">
          {raw === undefined || raw === null ? "—" : measure?.unit && typeof raw === "number" ? formatAmount(raw, measure.unit) : formatFieldValue(def, raw, names)}
        </Link>
        {flags.map((f) => (
          <span key={f.key} className="badge">
            {f.label}
          </span>
        ))}
        {counter && (
          <span className="row-stepper">
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              aria-label={`${it.name}: één minder`}
              disabled={typeof raw !== "number" || raw <= 0}
              onClick={() => step(-1)}
            >
              <Icon name="minus" size={15} />
            </button>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${it.name}: één meer`} onClick={() => step(pack)}>
              <Icon name="plus" size={15} />
            </button>
          </span>
        )}
      </div>
    </section>
  );
}

/** Eén blok zoals het op je overzicht staat. */
export function BlockView({ block, lists, index, period }: { block: Block; lists: Lists; index: number; period?: BoardPeriod | null }) {
  const { projects } = useSession();
  const project = "project" in block ? projects.find((p) => p.id === block.project && !p.archived) : undefined;
  const above = project?.parent_id ? projects.find((p) => p.id === project.parent_id)?.name : undefined;
  const type = "list" in block ? lists.get(block.project)?.find((t) => t.id === block.list) : undefined;
  let body: React.ReactNode = null;
  if (block.kind === "project" && project)
    body = <ProjectBlock project={project} above={above} types={lists.get(project.id)} hide={block.hide} views={block.views} />;
  else if (block.kind === "list" && project && type)
    body =
      block.show === "items" ? (
        <ListBlock block={block} project={project} type={type} />
      ) : (
        <section className="card dash-card">
          <ul className="rows">
            <li>
              <ListBlock block={block} project={project} type={type} />
            </li>
          </ul>
        </section>
      );
  else if (block.kind === "add" && project && type?.can_create) body = <QuickAdd projectId={project.id} typeId={type.id} />;
  else if (block.kind === "total" && project) body = <TotalBlock project={project.id} list={block.list} total={block.total} />;
  else if (block.kind === "value") body = <ValueBlock item={block.item} field={block.field} />;
  else if (block.kind === "chart" && project) body = <ChartBlock block={block} type={type} period={period} />;
  else if (block.kind === "text") body = <TextBlock block={block} />;
  else if (block.kind === "timer" && project && type) body = <TimerBlock project={project.id} list={block.list} field={block.field} />;
  else if (block.kind === "balance" && project) body = <BalanceCard projectId={project.id} className="dash-card" />;
  return body ? (
    <div className={`dash-block${block.wide ? " is-wide" : ""}`} style={stagger(index)}>
      {body}
    </div>
  ) : null;
}

/** Hoe een blok heet in de lijst om te schikken. */
function BlockLabel({ block, lists }: { block: Block; lists: Lists }) {
  const { projects } = useSession();
  const { data: it } = useApi<ItemDetail>(block.kind === "value" ? `/items/${block.item}` : null);
  const view = block.kind === "list" ? block.view : undefined;
  const { data: views } = useViews(block.kind === "list" ? block.project : "", block.kind === "list" ? block.list : "", Boolean(view));
  const project = "project" in block ? projects.find((p) => p.id === block.project)?.name : undefined;
  const list = "list" in block ? lists.get(block.project)?.find((t) => t.id === block.list) : undefined;
  const viewName = views?.find((v) => v.id === view)?.name;
  const title =
    block.kind === "project" || block.kind === "balance"
      ? project
      : block.kind === "chart"
        ? (block.title ?? chartTitle(block.chart, list))
        : block.kind === "text"
          ? (block.title ?? block.text?.slice(0, 40) ?? "Tekst")
          : block.kind === "add"
        ? `${list?.name ?? "Item"} toevoegen`
        : block.kind === "value"
          ? (it?.name ?? "…")
          : viewName
            ? `${list?.plural ?? ""} · ${viewName}`
            : list?.plural;
  return (
    <span className="row-main">
      <span className="row-title">{title ?? "Verborgen"}</span>
      <span className="row-meta">
        <span>{block.kind === "list" && block.show === "items" ? "Items" : BLOCK_KINDS[block.kind]}</span>
        {block.kind !== "project" && block.kind !== "balance" && project && <span>{project}</span>}
      </span>
    </span>
  );
}

/**
 * Je overzicht schikken: slepen aan de greep, weghalen, bij een project lijsten verbergen, en blokken toevoegen.
 * Bewaart pas bij Klaar (in de paneelbalk).
 */
export function BlocksEditor({ blocks, onChange, overview }: { blocks: Block[]; onChange: (b: Block[]) => void; overview: Overview }) {
  const lists: Lists = new Map(overview.projects.map((p) => [p.id, p.types]));
  const keys = blocks.map(blockKey);
  const byKey = new Map(blocks.map((b) => [blockKey(b), b]));
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<Extract<Block, { kind: "chart" | "text" }> | null>(null);
  const sortable = useSortable(
    keys,
    (order) => onChange(order.map((k) => byKey.get(k)!)),
    (k) => BLOCK_KINDS[byKey.get(k)!.kind],
  );

  return (
    <>
      <div className="card">
        <ul className="sort-list">
          {keys.map((k) => {
            const b = byKey.get(k)!;
            return (
              <li key={k} {...sortable.itemProps(k)}>
                <div className="sort-row">
                  <button {...sortable.handleProps(k)}>
                    <Icon name="grip" size={16} />
                  </button>
                  <BlockLabel block={b} lists={lists} />
                  {(b.kind === "chart" || b.kind === "text") && (
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Aanpassen" onClick={() => setEdit(b)}>
                      <Icon name="edit" size={15} />
                    </button>
                  )}
                  {(b.kind === "project" || b.kind === "total" || b.kind === "chart" || b.kind === "text" || (b.kind === "list" && b.show === "items")) && (
                    <button
                      type="button"
                      className="filter wide-only"
                      aria-pressed={Boolean(b.wide)}
                      onClick={() => onChange(blocks.map((x) => (x === b ? (b.wide ? { ...b, wide: undefined } : { ...b, wide: true }) : x)))}
                    >
                      Breed
                    </button>
                  )}
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Weghalen" onClick={() => onChange(blocks.filter((x) => x !== b))}>
                    <Icon name="close" size={15} />
                  </button>
                </div>
                {b.kind === "project" && (lists.get(b.project)?.length ?? 0) > 0 && (
                  <ProjectListsEditor block={b} types={lists.get(b.project)!} onChange={(next) => onChange(blocks.map((x) => (x === b ? next : x)))} />
                )}
              </li>
            );
          })}
        </ul>
        {sortable.status}
      </div>
      <button type="button" className="btn btn-outline" style={{ justifySelf: "start" }} onClick={() => setAdding(true)}>
        <Icon name="plus" size={16} /> Toevoegen
      </button>
      <AddBlock open={adding} onClose={() => setAdding(false)} onAdd={(b) => onChange([...blocks.filter((x) => blockKey(x) !== blockKey(b)), b])} />
      <EditBlock block={edit} onClose={() => setEdit(null)} onSave={(b) => onChange(blocks.map((x) => (blockKey(x) === blockKey(b) ? { ...b, wide: x.wide } : x)))} />
    </>
  );
}

/**
 * De lijsten van een projectblok: een pil per lijst (aan = zichtbaar). Heeft een lijst bewaarde weergaven, dan kies je
 * er een om te tellen (Alles, Te kopen, …) of Verborgen.
 */
function ProjectListsEditor({ block, types, onChange }: { block: Extract<Block, { kind: "project" }>; types: OverviewType[]; onChange: (b: Block) => void }) {
  const { data: views } = useApi<SavedView[]>(`/projects/${block.project}/views`);
  const HIDDEN = "verborgen";
  const set = (listId: string, hidden: boolean, view: string | null) => {
    const hide = (block.hide ?? []).filter((x) => x !== listId).concat(hidden ? [listId] : []);
    const rest = Object.fromEntries(Object.entries(block.views ?? {}).filter(([k]) => k !== listId));
    const next = view ? { ...rest, [listId]: view } : rest;
    onChange({ ...block, hide: hide.length ? hide : undefined, views: Object.keys(next).length ? next : undefined });
  };
  return (
    <div className="dash-edit-lists" role="group" aria-label="Lijsten">
      {types.map((t) => {
        const own = views?.filter((v) => v.type_id === t.id) ?? [];
        const hidden = Boolean(block.hide?.includes(t.id));
        if (!own.length)
          return (
            <button key={t.id} type="button" className="filter" aria-pressed={!hidden} onClick={() => set(t.id, !hidden, block.views?.[t.id] ?? null)}>
              {t.plural}
            </button>
          );
        return (
          <FilterSelect
            key={t.id}
            label={t.plural}
            all="Alles"
            value={hidden ? HIDDEN : (block.views?.[t.id] ?? null)}
            options={[...own.map((v) => ({ value: v.id, label: v.name })), { value: HIDDEN, label: "Verborgen" }]}
            onChange={(v) => set(t.id, v === HIDDEN, v && v !== HIDDEN ? v : null)}
          />
        );
      })}
    </div>
  );
}

/** Een blok toevoegen: wat, uit welk project en welke lijst, en welk totaal of welk item en veld. */
function AddBlock({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (b: Block) => void }) {
  const { projects } = useSession();
  const [kind, setKind] = useState<BlockKind>("project");
  const [project, setProject] = useState("");
  const [list, setList] = useState("");
  const [total, setTotal] = useState("");
  const [item, setItem] = useState<string | null>(null);
  const [field, setField] = useState("");
  const [view, setView] = useState("");
  const [show, setShow] = useState<"count" | "items">("count");
  const [chart, setChart] = useState<ChartDef | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState({ title: "", text: "" });
  const { data: detail } = useApi<ProjectDetail>(project && kind !== "text" ? `/projects/${project}` : null);
  const { data: views } = useViews(project, list, kind === "list");
  const types = detail?.types ?? [];
  const type = types.find((t) => t.id === list);
  const nodes = projectTree(projects);

  const block: Block | null =
    kind === "project" || kind === "balance"
      ? project
        ? { kind, project }
        : null
      : kind === "list"
        ? project && list
          ? { kind, project, list, ...(view ? { view } : {}), ...(show === "items" ? { show: "items" as const } : {}) }
          : null
        : kind === "add"
          ? project && list
            ? { kind, project, list }
            : null
          : kind === "total"
            ? project && list && total
              ? { kind, project, list, total }
              : null
            : kind === "chart"
              ? project && list && chart
                ? { kind, id: crypto.randomUUID().slice(0, 8), project, list, chart, ...(title.trim() ? { title: title.trim() } : {}) }
                : null
              : kind === "timer"
                ? project && list && field
                  ? { kind, project, list, field }
                  : null
              : kind === "text"
                ? note.title.trim() || note.text.trim()
                  ? { kind, id: crypto.randomUUID().slice(0, 8), ...(note.title.trim() ? { title: note.title.trim() } : {}), ...(note.text.trim() ? { text: note.text.trim() } : {}) }
                  : null
                : item && field
                  ? { kind, item, field }
                  : null;
  const reset = () => {
    setProject("");
    setList("");
    setView("");
    setTotal("");
    setItem(null);
    setField("");
    setChart(null);
    setTitle("");
    setNote({ title: "", text: "" });
  };

  return (
    <Sheet open={open} title="Toevoegen aan je overzicht" onClose={onClose}>
      <div className="form">
        <label className="field">
          <span className="label">Wat</span>
          <select
            aria-label="Wat"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as BlockKind);
              setTotal("");
              setItem(null);
              setField("");
            }}
          >
            {Object.entries(BLOCK_KINDS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {kind !== "text" && (
        <label className="field">
          <span className="label">Project</span>
          <select
            aria-label="Project"
            value={project}
            onChange={(e) => {
              reset();
              setProject(e.target.value);
            }}
          >
            <option value="">Kies…</option>
            {nodes.map((p) => (
              <option key={p.id} value={p.id}>
                {"    ".repeat(p.depth) + p.name}
              </option>
            ))}
          </select>
        </label>
        )}
        {kind !== "project" && kind !== "balance" && kind !== "text" && project && (
          <label className="field">
            <span className="label">Lijst</span>
            <select
              aria-label="Lijst"
              value={list}
              onChange={(e) => {
                setList(e.target.value);
                setView("");
                setTotal("");
                setItem(null);
                setField("");
                const next = types.find((t) => t.id === e.target.value);
                setChart(next ? newChart(next.fields.filter((f) => next.field_access[f.key] !== "none")) : null);
              }}
            >
              <option value="">Kies…</option>
              {types
                .filter((t) =>
                  kind === "add" ? t.can_create : kind === "total" ? shownTotals(t).length > 0 : kind === "timer" ? t.fields.some((f) => f.type === "timer" && t.field_access[f.key] !== "none") : true,
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.plural}
                  </option>
                ))}
            </select>
          </label>
        )}
        {kind === "list" && type && (
          <>
            {(views?.length ?? 0) > 0 && (
              <label className="field">
                <span className="label">Weergave</span>
                <select aria-label="Weergave" value={view} onChange={(e) => setView(e.target.value)}>
                  <option value="">Alles</option>
                  {views!.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="field">
              <span className="label">Toon</span>
              <Segmented
                label="Toon"
                value={show}
                onChange={setShow}
                options={[
                  { value: "count", label: "Aantal" },
                  { value: "items", label: "Items" },
                ]}
              />
            </div>
          </>
        )}
        {kind === "total" && type && (
          <label className="field">
            <span className="label">Totaal</span>
            <select aria-label="Totaal" value={total} onChange={(e) => setTotal(e.target.value)}>
              <option value="">Kies…</option>
              {shownTotals(type).map((t) => (
                <option key={t.id} value={t.id}>
                  {totalLabel(t, type.fields)}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "chart" && type && chart && <ChartBuilder project={project} type={type} value={chart} onChange={setChart} title={title} onTitle={setTitle} />}
        {kind === "text" && <TextBuilder title={note.title} text={note.text} onChange={setNote} />}
        {kind === "timer" && type && (
          <label className="field">
            <span className="label">Timer</span>
            <select aria-label="Timer" value={field} onChange={(e) => setField(e.target.value)}>
              <option value="">Kies…</option>
              {type.fields
                .filter((f) => f.type === "timer" && type.field_access[f.key] !== "none")
                .map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
            </select>
          </label>
        )}
        {kind === "value" && type && (
          <>
            <div className="field">
              <span className="label">Item</span>
              <ItemPicker
                def={{ key: "item", label: "Item", type: "item", ref_type: type.id }}
                value={item}
                onChange={(v) => setItem(typeof v === "string" ? v : null)}
                disabled={false}
              />
            </div>
            <label className="field">
              <span className="label">Veld</span>
              <select aria-label="Veld" value={field} onChange={(e) => setField(e.target.value)}>
                <option value="">Kies…</option>
                {type.fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuleren
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!block}
            onClick={() => {
              if (!block) return;
              onAdd(block);
              reset();
              onClose();
            }}
          >
            Toevoegen
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** Een grafiek of tekst op je overzicht aanpassen (in Aanpassen). */
function EditBlock({ block, onClose, onSave }: { block: Extract<Block, { kind: "chart" | "text" }> | null; onClose: () => void; onSave: (b: Block) => void }) {
  return (
    <Sheet open={block !== null} title={block?.kind === "text" ? "Tekst" : "Grafiek"} onClose={onClose}>
      {block && <EditBlockBody key={block.id} block={block} onClose={onClose} onSave={onSave} />}
    </Sheet>
  );
}

function EditBlockBody({ block, onClose, onSave }: { block: Extract<Block, { kind: "chart" | "text" }>; onClose: () => void; onSave: (b: Block) => void }) {
  const { data: detail } = useApi<ProjectDetail>(block.kind === "chart" ? `/projects/${block.project}` : null);
  const [chart, setChart] = useState<ChartDef | null>(block.kind === "chart" ? block.chart : null);
  const [title, setTitle] = useState(block.title ?? "");
  const [note, setNote] = useState({ title: block.title ?? "", text: block.kind === "text" ? (block.text ?? "") : "" });
  const type = block.kind === "chart" ? detail?.types.find((t) => t.id === block.list) : undefined;
  const next: Block | null =
    block.kind === "chart"
      ? chart && { ...block, chart, title: title.trim() || undefined }
      : note.title.trim() || note.text.trim()
        ? { ...block, title: note.title.trim() || undefined, text: note.text.trim() || undefined }
        : null;
  return (
    <div className="form">
      {block.kind === "chart" && type && chart && <ChartBuilder project={block.project} type={type} value={chart} onChange={setChart} title={title} onTitle={setTitle} />}
      {block.kind === "text" && <TextBuilder title={note.title} text={note.text} onChange={setNote} />}
      <div className="sheet-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Annuleren
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!next}
          onClick={() => {
            if (!next) return;
            onSave(next);
            onClose();
          }}
        >
          Bewaren
        </button>
      </div>
    </div>
  );
}
