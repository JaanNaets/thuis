// De blokken van je overzicht (zie shared/overview.ts): een project, een lijst, snel toevoegen, een totaal of de
// waarde van één item. Elk blok haalt op wat het toont met jouw rechten; wat je niet (meer) ziet, blijft weg.

import { useState } from "react";
import { formatFieldValue } from "../../shared/fields";
import { BLOCK_KINDS, blockKey, type Block, type BlockKind } from "../../shared/overview";
import { totalLabel } from "../../shared/totals";
import type { ItemDetail, Overview, OverviewType, ProjectDetail, ProjectNode } from "../../shared/types";
import { useApi } from "../api";
import { projectTree } from "../projects";
import { Link } from "../router";
import { useSession } from "../session";
import { CardHead } from "./Controls";
import { Icon, type IconName } from "./Icon";
import { ItemPicker } from "./ItemPicker";
import { Num, stagger } from "./Motion";
import { Sheet } from "./Sheet";
import { projectIcon } from "./Sidebar";
import { useSortable } from "./Sortable";
import { shownTotals, TotalsCards } from "./Totals";

type Lists = Map<string, OverviewType[]>;

/** Eén lijst als rij: openen, en + om meteen iets toe te voegen. */
function ListRow({ project, type, meta }: { project: string; type: OverviewType; meta?: string }) {
  const main = (
    <>
      <span className="cell-main">
        <span className="row-media">
          <Icon name={(type.icon ?? "folder") as IconName} size={16} />
        </span>
        <span className="row-main">
          <span className="row-title">{type.plural}</span>
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
  return type.can_create ? (
    <div className="row">
      <Link to={`/projecten/${project}?lijst=${type.id}`} className="row-link">
        {main}
      </Link>
      <Link to={`/projecten/${project}/nieuw?lijst=${type.id}`} className="btn btn-ghost btn-icon btn-sm" aria-label={`${type.name} toevoegen`}>
        <Icon name="plus" size={16} />
      </Link>
    </div>
  ) : (
    <Link to={`/projecten/${project}?lijst=${type.id}`} className="row">
      {main}
    </Link>
  );
}

/** Een project: de kop opent het project, elke rij een lijst (behalve wat je verborg). */
function ProjectBlock({ project: p, above, types, hide }: { project: ProjectNode; above?: string; types?: OverviewType[]; hide?: string[] }) {
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
            <li key={t.id}>
              <ListRow project={p.id} type={t} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="dash-empty">Nog niets om bij te houden</p>
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

/** Eén veld van één item, groot (ook een berekening): Pellets · Aantal. */
function ValueBlock({ item, field }: { item: string; field: string }) {
  const { data: it } = useApi<ItemDetail>(`/items/${item}`);
  const { data: p } = useApi<ProjectDetail>(it ? `/projects/${it.project_id}` : null);
  const def = it && p ? p.types.find((t) => t.id === it.type_id)?.fields.find((f) => f.key === field) : undefined;
  if (!it || !def) return null;
  const names = { person: (id: string) => it.people.find((x) => x.id === id)?.name ?? "", item: (id: string) => it.refs.find((x) => x.id === id)?.name ?? "" };
  const value = it.data[field];
  return (
    <section className="card dash-card">
      <CardHead title={def.label} description={it.name} />
      <Link to={`/items/${it.id}`} className="card-body dash-value">
        {value === undefined || value === null ? "—" : formatFieldValue(def, value, names)}
      </Link>
    </section>
  );
}

/** Eén blok zoals het op je overzicht staat. */
export function BlockView({ block, lists, index }: { block: Block; lists: Lists; index: number }) {
  const { projects } = useSession();
  const project = "project" in block ? projects.find((p) => p.id === block.project && !p.archived) : undefined;
  const above = project?.parent_id ? projects.find((p) => p.id === project.parent_id)?.name : undefined;
  const type = "list" in block ? lists.get(block.project)?.find((t) => t.id === block.list) : undefined;
  let body: React.ReactNode = null;
  if (block.kind === "project" && project) body = <ProjectBlock project={project} above={above} types={lists.get(project.id)} hide={block.hide} />;
  else if (block.kind === "list" && project && type)
    body = (
      <section className="card dash-card">
        <ul className="rows">
          <li>
            <ListRow project={project.id} type={type} meta={project.name} />
          </li>
        </ul>
      </section>
    );
  else if (block.kind === "add" && project && type?.can_create)
    body = (
      <section className="card dash-card">
        <Link to={`/projecten/${project.id}/nieuw?lijst=${type.id}`} className="dash-head">
          <span className="row-media">
            <Icon name="plus" size={16} />
          </span>
          <span className="row-main">
            <span className="row-title">{type.name} toevoegen</span>
            <span className="row-meta">
              <span>{project.name}</span>
            </span>
          </span>
          <Icon name="next" size={16} className="row-chevron" />
        </Link>
      </section>
    );
  else if (block.kind === "total" && project) body = <TotalBlock project={project.id} list={block.list} total={block.total} />;
  else if (block.kind === "value") body = <ValueBlock item={block.item} field={block.field} />;
  return body ? (
    <div className="dash-block" style={stagger(index)}>
      {body}
    </div>
  ) : null;
}

/** Hoe een blok heet in de lijst om te schikken. */
function BlockLabel({ block, lists }: { block: Block; lists: Lists }) {
  const { projects } = useSession();
  const { data: it } = useApi<ItemDetail>(block.kind === "value" ? `/items/${block.item}` : null);
  const project = "project" in block ? projects.find((p) => p.id === block.project)?.name : undefined;
  const list = "list" in block ? lists.get(block.project)?.find((t) => t.id === block.list) : undefined;
  const title =
    block.kind === "project"
      ? project
      : block.kind === "add"
        ? `${list?.name ?? "Item"} toevoegen`
        : block.kind === "value"
          ? (it?.name ?? "…")
          : list?.plural;
  return (
    <span className="row-main">
      <span className="row-title">{title ?? "Verborgen"}</span>
      <span className="row-meta">
        <span>{BLOCK_KINDS[block.kind]}</span>
        {block.kind !== "project" && project && <span>{project}</span>}
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
  const sortable = useSortable(
    keys,
    (order) => onChange(order.map((k) => byKey.get(k)!)),
    (k) => BLOCK_KINDS[byKey.get(k)!.kind],
  );
  const toggle = (b: Extract<Block, { kind: "project" }>, listId: string) => {
    const hide = b.hide?.includes(listId) ? b.hide.filter((x) => x !== listId) : [...(b.hide ?? []), listId];
    onChange(blocks.map((x) => (x === b ? { ...b, hide } : x)));
  };

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
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Weghalen" onClick={() => onChange(blocks.filter((x) => x !== b))}>
                    <Icon name="close" size={15} />
                  </button>
                </div>
                {b.kind === "project" && (lists.get(b.project)?.length ?? 0) > 0 && (
                  <div className="dash-edit-lists" role="group" aria-label="Lijsten">
                    {lists.get(b.project)!.map((t) => (
                      <button key={t.id} type="button" className="filter" aria-pressed={!b.hide?.includes(t.id)} onClick={() => toggle(b, t.id)}>
                        {t.plural}
                      </button>
                    ))}
                  </div>
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
    </>
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
  const { data: detail } = useApi<ProjectDetail>(project ? `/projects/${project}` : null);
  const types = detail?.types ?? [];
  const type = types.find((t) => t.id === list);
  const nodes = projectTree(projects);

  const block: Block | null =
    kind === "project"
      ? project
        ? { kind, project }
        : null
      : kind === "list" || kind === "add"
        ? project && list
          ? { kind, project, list }
          : null
        : kind === "total"
          ? project && list && total
            ? { kind, project, list, total }
            : null
          : item && field
            ? { kind, item, field }
            : null;
  const reset = () => {
    setProject("");
    setList("");
    setTotal("");
    setItem(null);
    setField("");
  };

  return (
    <Sheet open={open} title="Toevoegen aan je overzicht" onClose={onClose}>
      <div className="form">
        <label className="field">
          <span className="label">Wat</span>
          <select aria-label="Wat"
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
        <label className="field">
          <span className="label">Project</span>
          <select aria-label="Project"
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
        {kind !== "project" && project && (
          <label className="field">
            <span className="label">Lijst</span>
            <select aria-label="Lijst"
              value={list}
              onChange={(e) => {
                setList(e.target.value);
                setTotal("");
                setItem(null);
                setField("");
              }}
            >
              <option value="">Kies…</option>
              {types
                .filter((t) => (kind === "add" ? t.can_create : kind === "total" ? shownTotals(t).length > 0 : true))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.plural}
                  </option>
                ))}
            </select>
          </label>
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
