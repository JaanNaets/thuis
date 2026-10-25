import { useEffect, useState } from "react";
import type { Overview, OverviewType, ProjectNode } from "../../shared/types";
import { api, useApi } from "../api";
import { CardHead } from "../components/Controls";
import { Icon, type IconName } from "../components/Icon";
import { Num, stagger } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { projectIcon } from "../components/Sidebar";
import { useSortable } from "../components/Sortable";
import { useToast } from "../components/Toast";
import { childrenOf, projectTree } from "../projects";
import { Link } from "../router";
import { useSession } from "../session";

/**
 * Je overzicht: per project een kaart met zijn lijsten en hoeveel erin zit, zodat je met één tik bij
 * je wijnen of klantenkaarten bent. Met "Volgorde" zet je de projecten zoals jij ze wil.
 */
export function Home() {
  const { projects } = useSession();
  const { data: overview } = useApi<Overview>("/me/overview");
  const [arranging, setArranging] = useState(false);
  const tree = projectTree(projects, true);
  const active = tree.filter((p) => !p.archived);
  const archived = tree.filter((p) => p.archived);
  const live = projects.filter((p) => !p.archived);
  const tops = childrenOf(live, null);
  const canArrange = tops.length > 1 || live.some((p) => p.rights.manage && childrenOf(live, p.id).length > 1);
  const lists = new Map(overview?.projects.map((p) => [p.id, p.types]));
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <div className="page">
      <PageHead
        title="Overzicht"
        description={active.length ? "Je projecten en wat erin zit" : undefined}
        actions={
          canArrange && (
            <button type="button" className="btn btn-outline btn-sm" aria-pressed={arranging} onClick={() => setArranging((a) => !a)}>
              <Icon name={arranging ? "check" : "grip"} size={15} /> {arranging ? "Klaar" : "Volgorde"}
            </button>
          )
        }
        primary={
          !arranging && (
            <Link to="/projecten/nieuw" className="btn btn-primary">
              <Icon name="plus" size={16} /> Nieuw project
            </Link>
          )
        }
      />

      {active.length === 0 ? (
        <EmptyState
          icon="project"
          title="Nog geen projecten"
          action={
            <Link to="/projecten/nieuw" className="btn btn-outline btn-sm">
              <Icon name="plus" size={16} /> Eerste project
            </Link>
          }
        >
          Begin met een huishouden, een wijnkelder of een leeg project. Daarna kies je zelf wat je bijhoudt en wie wat mag.
        </EmptyState>
      ) : arranging ? (
        <section className="card">
          <CardHead
            icon="sliders"
            title="Volgorde"
            description="Sleep aan de greep. Je projecten bovenaan zet je voor jezelf; subprojecten voor iedereen in het project."
          />
          <ProjectOrder nodes={tops} all={live} parent={null} />
        </section>
      ) : (
        <div className="dashboard stagger">
          {active.map((p, i) => (
            <ProjectCard key={p.id} project={p} above={p.parent_id ? nameOf.get(p.parent_id) : undefined} types={lists.get(p.id)} index={i} />
          ))}
        </div>
      )}

      {!arranging && archived.length > 0 && (
        <>
          <h2 className="section-title">Gearchiveerd</h2>
          <div className="card">
            <ul className="rows">
              {archived.map((p) => (
                <li key={p.id}>
                  <Link to={`/projecten/${p.id}`} className="row">
                    <span className="cell-main">
                      <span className="row-media">
                        <Icon name={projectIcon(p)} size={16} />
                      </span>
                      <span className="row-main">
                        <span className="row-title">{p.name}</span>
                      </span>
                    </span>
                    <Icon name="next" size={16} className="row-chevron" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {!arranging && (
        <Link to="/projecten/nieuw" className="fab" aria-label="Nieuw project">
          <Icon name="plus" size={24} />
        </Link>
      )}
    </div>
  );
}

/** Eén project op het overzicht: de kop opent het project, elke rij opent een lijst. */
function ProjectCard({ project: p, above, types, index }: { project: ProjectNode; above?: string; types?: OverviewType[]; index: number }) {
  return (
    <section className="card dash-card" style={stagger(index)}>
      <Link to={`/projecten/${p.id}`} className="dash-head">
        <span className={`row-media tone-${p.color ?? "sky"}`}>
          <Icon name={projectIcon(p)} size={16} />
        </span>
        <span className="row-main">
          <span className="row-title">{p.name}</span>
          <span className="row-meta">
            {above && <span>{above}</span>}
            <span>{p.role_name}</span>
          </span>
        </span>
        <Icon name="next" size={16} className="row-chevron" />
      </Link>
      {!types ? null : types.length > 0 ? (
        <ul className="rows">
          {types.map((t) => (
            <li key={t.id}>
              <Link to={`/projecten/${p.id}?lijst=${t.id}`} className="row">
                <span className="cell-main">
                  <span className="row-media">
                    <Icon name={(t.icon ?? "folder") as IconName} size={16} />
                  </span>
                  <span className="row-title">{t.plural}</span>
                </span>
                <span className="row-end">
                  <Num value={t.count} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dash-empty">Nog niets om bij te houden</p>
      )}
    </section>
  );
}

/**
 * Eén niveau van de boom om te ordenen. Bovenaan is het jouw volgorde; subprojecten ordent wie het project
 * erboven instelt (dat geldt voor iedereen). Een niveau dat je niet mag ordenen, staat er zonder greep.
 */
function ProjectOrder({ nodes, all, parent }: { nodes: ProjectNode[]; all: ProjectNode[]; parent: ProjectNode | null }) {
  const { reloadMe } = useSession();
  const toast = useToast();
  const sorted = nodes.map((n) => n.id);
  const key = sorted.join(",");
  const [order, setOrder] = useState(sorted);
  useEffect(() => setOrder(key.split(",")), [key]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const canSort = nodes.length > 1 && (parent === null || parent.rights.manage);

  async function save(ids: string[]) {
    setOrder(ids);
    try {
      await api.put(parent ? `/projects/${parent.id}/children/order` : "/me/order", { ids });
      reloadMe();
    } catch (err) {
      toast((err as Error).message, "alert");
      setOrder(sorted);
    }
  }
  const sortable = useSortable(order, save, (id) => byId.get(id)?.name ?? "");

  return (
    <>
      <ul className={parent ? "sort-list sort-children" : "sort-list"}>
        {order.map((id) => {
          const n = byId.get(id);
          if (!n) return null;
          const kids = childrenOf(all, id);
          return (
            <li key={id} {...sortable.itemProps(id)}>
              <div className="sort-row">
                {canSort ? (
                  <button {...sortable.handleProps(id)}>
                    <Icon name="grip" size={16} />
                  </button>
                ) : (
                  <span className="drag-spacer" aria-hidden="true" />
                )}
                <span className={`row-media tone-${n.color ?? "sky"}`}>
                  <Icon name={projectIcon(n)} size={16} />
                </span>
                <span className="row-title">{n.name}</span>
              </div>
              {kids.length > 0 && <ProjectOrder nodes={kids} all={all} parent={n} />}
            </li>
          );
        })}
      </ul>
      {sortable.status}
    </>
  );
}
