import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { KIND_ORDER, LINK_KINDS, type LinkKind, type LinkMap } from "../../shared/links";
import { useApi } from "../api";
import { FilterToggle, Tabs } from "../components/Controls";
import { Icon } from "../components/Icon";
import { kindClass, LinkDetail, LinkList, LinkMapView } from "../components/LinkMap";
import { SkeletonRows } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { Link, useNavigate } from "../router";
import { useSession } from "../session";

type View = "kaart" | "lijst";

/**
 * De verbanden van een project: wat de lijsten van het project en zijn subprojecten met elkaar en met andere projecten
 * doen. Als kaart (tablet) of als lijst (gsm); een gekozen lijst toont wat erop inwerkt en waar ze op inwerkt. De
 * weergave en de gekozen lijst staan in het adres (?weergave=lijst&punt=…), zodat terug ook echt terug is.
 */
export function LinksPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { projects } = useSession();
  const project = projects.find((p) => p.id === id);
  const parent = project?.parent_id ? projects.find((p) => p.id === project.parent_id) : undefined;
  // Zonder project: de verbanden tussen al je projecten.
  const all = !id;
  const { data: map, error } = useApi<LinkMap>(all ? "/links" : `/projects/${id}/links`);
  const [off, setOff] = useState<Set<LinkKind>>(new Set());

  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
  const view: View = params.get("weergave") === "lijst" || (!params.get("weergave") && !wide) ? "lijst" : "kaart";
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setParams(next, { replace: true });
  };

  const links = map?.links.filter((l) => !off.has(l.kind)) ?? [];
  const kinds = KIND_ORDER.filter((k) => map?.links.some((l) => l.kind === k));
  const selected = map?.nodes.find((n) => n.id === params.get("punt") && links.some((l) => l.from === n.id || l.to === n.id)) ?? null;
  const select = (nodeId: string | null) => set({ punt: nodeId });
  const openMap = (projectId: string) => navigate(`/projecten/${projectId}/verbanden${view === "lijst" ? "?weergave=lijst" : ""}`);
  const settings = project && (project.rights.manage || project.rights.members);

  return (
    <div className="page">
      <PageHead title="Verbanden" back={all ? undefined : project ? { to: `/projecten/${project.id}`, label: project.name } : { to: "/", label: "Overzicht" }} />
      {error && <p className="error">{error}</p>}
      {!map && !error && <SkeletonRows rows={4} />}
      {map && !map.links.length && (
        <EmptyState
          icon="links"
          title={all ? "Nog geen verbanden tussen je projecten" : "Nog geen verbanden"}
          action={
            settings && (
              <Link to={`/projecten/${id}/instellingen?tab=lijsten`} className="btn btn-outline btn-sm">
                Lijsten instellen
              </Link>
            )
          }
        />
      )}
      {map && map.links.length > 0 && (
        <>
          <Tabs<View>
            label="Weergave"
            value={view}
            onChange={(v) => set({ weergave: v === "lijst" ? "lijst" : "kaart" })}
            tabs={[
              { value: "kaart", label: "Kaart" },
              { value: "lijst", label: "Lijst" },
            ]}
          />
          {kinds.length > 1 && (
            <div className="filters" role="group" aria-label="Soorten verbanden">
              {kinds.map((k) => (
                <FilterToggle
                  key={k}
                  on={!off.has(k)}
                  onChange={(on) => setOff((cur) => new Set(on ? [...cur].filter((x) => x !== k) : [...cur, k]))}
                >
                  <span className={`lm-swatch ${kindClass(k)}`} aria-hidden="true" /> {LINK_KINDS[k].label}
                </FilterToggle>
              ))}
            </div>
          )}

          {view === "kaart" && (
            <>
              <LinkMapView map={map} current={id ?? ""} links={links} selected={selected?.id ?? null} onSelect={select} onColumn={openMap} />
              {selected && <LinkDetail map={map} node={selected} links={links} onSelect={select} />}
            </>
          )}
          {view === "lijst" &&
            (selected ? (
              <>
                <button type="button" className="btn btn-ghost btn-sm lm-back" onClick={() => select(null)}>
                  <Icon name="back" size={15} /> Alle lijsten
                </button>
                <LinkDetail map={map} node={selected} links={links} onSelect={select} />
              </>
            ) : (
              <LinkList map={map} links={links} onSelect={select} />
            ))}

          {(map.quiet.length > 0 || map.more.project_count > 0 || map.more.outside > 0) && (
            <div className="lm-more">
              {map.quiet.length > 0 && (
                <p>
                  Zonder verbanden:{" "}
                  {map.quiet.map((q, i) => (
                    <span key={q.id}>
                      {i > 0 && ", "}
                      <Link to={`/projecten/${q.id}`} className="link-quiet">
                        {q.name}
                      </Link>
                    </span>
                  ))}
                </p>
              )}
              {map.more.project_count > 0 && (
                <p>
                  Nog {map.more.project_count} {all ? "projecten" : "subprojecten"} met een eigen kaart:{" "}
                  {map.more.projects.map((q, i) => (
                    <span key={q.id}>
                      {i > 0 && ", "}
                      <Link to={`/projecten/${q.id}/verbanden`} className="link-quiet">
                        {q.name}
                      </Link>
                    </span>
                  ))}
                  {map.more.project_count > map.more.projects.length && ", …"}
                </p>
              )}
              {map.more.outside > 0 && <p>En {map.more.outside} lijsten in andere projecten die hier niet meer passen.</p>}
            </div>
          )}
          {!all && (
            <p className="lm-more">
              <Link to={parent ? `/projecten/${parent.id}/verbanden` : "/verbanden"} className="link-quiet">
                {parent ? `Kaart van ${parent.name}` : "Alle projecten"}
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
