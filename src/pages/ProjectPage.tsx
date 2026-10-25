import { useParams, useSearchParams } from "react-router";
import type { ProjectDetail } from "../../shared/types";
import { useApi } from "../api";
import { Avatar, CardHead, Tabs } from "../components/Controls";
import { Icon } from "../components/Icon";
import { ItemsView } from "../components/ItemsView";
import { EmptyState, PageHead } from "../components/Page";
import { projectIcon } from "../components/Sidebar";
import { Link } from "../router";
import { useSession } from "../session";

/**
 * Een project: per lijst een tab; in de zijkolom de subprojecten en wie erin zit.
 * De hoofdactie voegt iets toe aan de lijst die openstaat.
 */
export function ProjectPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: p, error } = useApi<ProjectDetail>(`/projects/${id}`);
  const { person } = useSession();

  if (error) return <p className="error page">{error}</p>;
  if (!p) return null;

  const { project, counts } = p;
  const rights = project.rights;
  // Tabs: de lijsten van dit project, en lijsten van erboven waar hier al iets in zit (zonder eigen lijsten: alle).
  const own = p.types.filter((t) => t.project_id === project.id || counts[t.id]);
  const types = own.length ? own : p.types;
  const wanted = params.get("lijst");
  const type = p.types.find((t) => t.id === wanted) ?? types.find((t) => counts[t.id]) ?? types[0];
  const parent = p.path[p.path.length - 1];
  const settings = rights.manage || rights.members;
  const roleName = (roleId: string) => p.roles.find((r) => r.id === roleId)?.name ?? "";
  const newItem = type && `/projecten/${project.id}/nieuw?lijst=${type.id}`;
  const canAdd = Boolean(type?.can_create && !project.archived);

  return (
    <article className="page">
      <PageHead
        title={project.name}
        badge={project.archived ? <span className="badge">Gearchiveerd</span> : undefined}
        description={project.description ?? undefined}
        back={parent ? { to: `/projecten/${parent.id}`, label: parent.name } : { to: "/", label: "Overzicht" }}
        actions={
          settings && (
            <Link to={`/projecten/${project.id}/instellingen`} className="btn btn-outline btn-sm">
              <Icon name="sliders" size={15} /> Instellen
            </Link>
          )
        }
        primary={
          canAdd &&
          type && (
            <Link to={newItem!} className="btn btn-primary">
              <Icon name="plus" size={16} /> {type.name} toevoegen
            </Link>
          )
        }
      />

      {types.length > 1 && type && (
        <Tabs
          label="Lijsten"
          value={type.id}
          onChange={(t) => setParams({ lijst: t }, { replace: true })}
          tabs={(types.includes(type) ? types : [...types, type]).map((t) => ({ value: t.id, label: t.plural, count: counts[t.id] ?? 0 }))}
        />
      )}

      <div className="split split-main-first">
        <aside className="split-aside">
          <section className="card">
            <CardHead
              icon="project"
              title="Subprojecten"
              description={p.children.length === 0 ? "Een deel van dit project, met eigen lijsten en mensen" : undefined}
              action={
                rights.manage &&
                !project.archived && (
                  <Link to={`/projecten/nieuw?parent=${project.id}`} className="btn btn-outline btn-sm">
                    <Icon name="plus" size={15} /> Subproject
                  </Link>
                )
              }
            />
            {p.children.length > 0 && (
              <ul className="rows">
                {p.children.map((child) => (
                  <li key={child.id}>
                    <Link to={`/projecten/${child.id}`} className="row" style={{ minHeight: 52 }}>
                      <span className="cell-main">
                        <span className={`row-media tone-${child.color ?? "sky"}`}>
                          <Icon name={projectIcon(child)} size={16} />
                        </span>
                        <span className="row-main">
                          <span className="row-title">{child.name}</span>
                          <span className="row-meta">
                            <span>{child.item_count === 1 ? "1 item" : `${child.item_count} items`}</span>
                            {child.archived === 1 && <span className="badge">Gearchiveerd</span>}
                          </span>
                        </span>
                      </span>
                      <Icon name="next" size={16} className="row-chevron" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <CardHead
              icon="users"
              title="Wie"
              action={
                rights.members && (
                  <Link to={`/projecten/${project.id}/instellingen?tab=mensen`} className="btn btn-outline btn-sm">
                    <Icon name="userPlus" size={15} /> Mensen
                  </Link>
                )
              }
            />
            <ul className="rows">
              {p.members.map((m) => (
                <li key={m.person.id}>
                  <div className="row" style={{ minHeight: 52 }}>
                    <span className="cell-main">
                      <Avatar member={m.person} />
                      <span className="row-main">
                        <span className="row-title">{m.person.id === person.id ? `${m.person.name} (ik)` : m.person.name}</span>
                        <span className="row-meta">
                          <span>{roleName(m.role_id)}</span>
                          {m.inherited && <span>via {p.path.find((x) => x.id === m.project_id)?.name ?? "erboven"}</span>}
                        </span>
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <div className="split-main">
          {type ? (
            <ItemsView key={type.id} project={p} type={type} />
          ) : (
            <EmptyState
              icon="folder"
              title="Nog niets om bij te houden"
              action={
                rights.manage && (
                  <Link to={`/projecten/${project.id}/lijsten/nieuw`} className="btn btn-outline btn-sm">
                    <Icon name="plus" size={16} /> Lijst maken
                  </Link>
                )
              }
            >
              {rights.manage
                ? "Maak een lijst met de velden die je wil bijhouden (bv. Wijnen met jaargang en druiven)."
                : "Wie dit project instelt, kan hier lijsten maken."}
            </EmptyState>
          )}
        </div>
      </div>

      {canAdd && newItem && (
        <Link to={newItem} className="fab" aria-label={`${type!.name} toevoegen`}>
          <Icon name="plus" size={24} />
        </Link>
      )}
    </article>
  );
}
