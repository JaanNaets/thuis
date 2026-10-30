import type { Overview, OverviewType, ProjectNode } from "../../shared/types";
import { useApi } from "../api";
import { Icon, type IconName } from "../components/Icon";
import { Num, stagger } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { projectIcon } from "../components/Sidebar";
import { projectTree } from "../projects";
import { Link } from "../router";
import { useSession } from "../session";

/**
 * Je overzicht: per project een kaart met zijn lijsten en hoeveel erin zit, zodat je met één tik bij
 * je wijnen of klantenkaarten bent. De volgorde zet je bij Ik (je projecten) en Instellen (subprojecten).
 */
export function Home() {
  const { projects } = useSession();
  const { data: overview } = useApi<Overview>("/me/overview");
  const tree = projectTree(projects, true);
  const active = tree.filter((p) => !p.archived);
  const archived = tree.filter((p) => p.archived);
  const lists = new Map(overview?.projects.map((p) => [p.id, p.types]));
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <div className="page">
      <PageHead
        title="Overzicht"
        description={active.length ? "Je projecten en wat erin zit" : undefined}
        primary={
          <Link to="/projecten/nieuw" className="btn btn-primary">
            <Icon name="plus" size={16} /> Nieuw project
          </Link>
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
      ) : (
        <div className="dashboard stagger">
          {active.map((p, i) => (
            <ProjectCard key={p.id} project={p} above={p.parent_id ? nameOf.get(p.parent_id) : undefined} types={lists.get(p.id)} index={i} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
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

      <Link to="/projecten/nieuw" className="fab" aria-label="Nieuw project">
        <Icon name="plus" size={24} />
      </Link>
    </div>
  );
}

/** Eén project op het overzicht: de kop opent het project, elke rij opent een lijst; + voegt er meteen iets aan toe. */
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
          {types.map((t) => {
            const main = (
              <>
                <span className="cell-main">
                  <span className="row-media">
                    <Icon name={(t.icon ?? "folder") as IconName} size={16} />
                  </span>
                  <span className="row-title">{t.plural}</span>
                </span>
                <span className="row-end">
                  <Num value={t.count} />
                </span>
              </>
            );
            return (
              <li key={t.id}>
                {t.can_create ? (
                  <div className="row">
                    <Link to={`/projecten/${p.id}?lijst=${t.id}`} className="row-link">
                      {main}
                    </Link>
                    <Link to={`/projecten/${p.id}/nieuw?lijst=${t.id}`} className="btn btn-ghost btn-icon btn-sm" aria-label={`${t.name} toevoegen`}>
                      <Icon name="plus" size={16} />
                    </Link>
                  </div>
                ) : (
                  <Link to={`/projecten/${p.id}?lijst=${t.id}`} className="row">
                    {main}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="dash-empty">Nog niets om bij te houden</p>
      )}
    </section>
  );
}
