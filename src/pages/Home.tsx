import type { CSSProperties } from "react";
import { Icon } from "../components/Icon";
import { stagger } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { projectIcon } from "../components/Sidebar";
import { projectTree } from "../projects";
import { Link } from "../router";
import { useSession } from "../session";

/** Al je projecten als boom: wat bovenaan staat, met de subprojecten eronder ingesprongen. */
export function Home() {
  const { projects } = useSession();
  const tree = projectTree(projects, true);
  const active = tree.filter((p) => !p.archived);
  const archived = tree.filter((p) => p.archived);

  return (
    <div className="page">
      <PageHead
        title="Projecten"
        description={projects.length ? "Alles wat je bijhoudt, met wie en wat ze mogen" : undefined}
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
        <div className="card">
          <ul className="rows stagger">
            {active.map((p, i) => (
              <li key={p.id} style={stagger(i)}>
                <Link to={`/projecten/${p.id}`} className="row project-row" style={{ "--depth": p.depth } as CSSProperties}>
                  <span className="cell-main">
                    <span className={`row-media tone-${p.color ?? "sky"}`}>
                      <Icon name={projectIcon(p)} size={16} />
                    </span>
                    <span className="row-main">
                      <span className="row-title">{p.name}</span>
                      <span className="row-meta">
                        <span>{p.role_name}</span>
                        {p.description && <span>{p.description}</span>}
                      </span>
                    </span>
                  </span>
                  <Icon name="next" size={16} className="row-chevron" />
                </Link>
              </li>
            ))}
          </ul>
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
