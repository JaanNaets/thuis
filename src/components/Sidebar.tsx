import { useEffect, useState, type CSSProperties } from "react";
import { useLocation } from "react-router";
import { descendantIds } from "../../shared/tree";
import type { ProjectNode, Tone } from "../../shared/types";
import { isKiosk } from "../device";
import { childrenOf, projectTree } from "../projects";
import { Link, NavLink } from "../router";
import { useSession } from "../session";
import { Icon, type IconName } from "./Icon";

/** ⌘K op een Mac, Ctrl K elders. */
export const SEARCH_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K";

/** Een project zonder eigen kleur krijgt er een, in een vaste volgorde die mooi afwisselt. */
const TONES: Tone[] = ["peach", "sky", "sage", "lilac", "butter", "rose", "mint"];

export function projectIcon(p: Pick<ProjectNode, "icon">): IconName {
  return (p.icon ?? "project") as IconName;
}

/** Het project dat je nu bekijkt (uit het adres). */
function currentProject(pathname: string): string | null {
  return pathname.match(/^\/projecten\/([0-9a-f-]{36})/)?.[1] ?? null;
}

/**
 * Zijbalk op het grijze canvas (zie STIJLBOEK.md → Zijbalk): de app, zoeken en al je projecten als boom (een project
 * klapt open en toont zijn subprojecten). Jouw gegevens: je letter rechtsboven in de paneelbalk.
 */
export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const { projects } = useSession();
  const { pathname } = useLocation();
  const current = currentProject(pathname);
  // Waar de glazen lens ligt: Overzicht, Agenda of Verbanden (anders onzichtbaar).
  const navIndex = pathname === "/" ? 0 : pathname.startsWith("/agenda") ? 1 : pathname === "/verbanden" ? 2 : -1;

  return (
    <aside className="sidebar" aria-label="Hoofdmenu">
      <Link to="/" className="workspace" title="Thuis">
        <span className="brand-mark">
          <Icon name="home" size={15} />
        </span>
        <span className="nav-text workspace-name">Thuis</span>
        {isKiosk && <span className="nav-text workspace-note">Kiosk</span>}
      </Link>

      <button type="button" className="sidebar-search" onClick={onSearch} title={`Zoeken (${SEARCH_SHORTCUT})`}>
        <Icon name="search" size={15} />
        <span className="nav-text">Zoeken…</span>
      </button>

      <div className="sidebar-scroll">
        <nav className="sidebar-nav">
          <span
            className="sidebar-indicator"
            style={{ "--i": navIndex, opacity: navIndex >= 0 ? 1 : 0 } as CSSProperties}
          />
          <NavLink to="/" end title="Overzicht">
            <Icon name="project" size={17} />
            <span className="nav-text">Overzicht</span>
          </NavLink>
          <NavLink to="/agenda" title="Agenda">
            <Icon name="calendar" size={17} />
            <span className="nav-text">Agenda</span>
          </NavLink>
          <NavLink to="/verbanden" title="Verbanden">
            <Icon name="links" size={17} />
            <span className="nav-text">Verbanden</span>
          </NavLink>
        </nav>

        <ProjectTree projects={projects} current={current} />
      </div>
    </aside>
  );
}

/** De projecten bovenaan, elk met een gekleurd icoon; een project met subprojecten klapt open. */
function ProjectTree({ projects, current }: { projects: ProjectNode[]; current: string | null }) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  // Een tak komt pas in de pagina als hij (ooit) open was: met 1000 projecten blijft de zijbalk zo licht.
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const live = projects.filter((p) => !p.archived);
  const flat = projectTree(live);
  const roots = childrenOf(live, null).map((root) => {
    const below = descendantIds(live, root.id);
    // Open als je erop klikte, of als je nu dit project (of iets erin) bekijkt.
    return { root, below, open: toggled[root.id] ?? (current !== null && below.has(current)) };
  });
  const openIds = roots.filter((r) => r.open).map((r) => r.root.id);
  const openKey = openIds.join(",");
  useEffect(() => {
    // Wat open was, blijft in de pagina (zodat dichtklappen nog beweegt).
    setSeen((s) => (openIds.every((id) => s.has(id)) ? s : new Set([...s, ...openIds])));
  }, [openKey]);

  return (
    <div className="sidebar-places">
      <p className="nav-section">Projecten</p>
      <ul className="place-tree">
        {roots.map(({ root, below, open }, index) => {
          const rootDepth = flat.find((p) => p.id === root.id)?.depth ?? 0;
          const children = open || seen.has(root.id) ? flat.filter((p) => p.id !== root.id && below.has(p.id)) : [];
          return (
            <li key={root.id}>
              <div className="place-row">
                <Link to={`/projecten/${root.id}`} className="place-link root" aria-current={current === root.id ? "page" : undefined}>
                  <span className={`place-icon tone-${root.color ?? TONES[index % TONES.length]}`}>
                    <Icon name={projectIcon(root)} size={15} />
                  </span>
                  <span className="place-name">{root.name}</span>
                </Link>
                {below.size > 1 && (
                  <button
                    type="button"
                    className="place-toggle"
                    aria-expanded={open}
                    aria-label={`${root.name} ${open ? "dichtklappen" : "openklappen"}`}
                    onClick={() => setToggled((t) => ({ ...t, [root.id]: !open }))}
                  >
                    <Icon name="down" size={14} />
                  </button>
                )}
              </div>
              {below.size > 1 && (
                <div className="place-children" data-open={open} inert={!open}>
                  <ul>
                    {children.map((child, k) => (
                      <li key={child.id} style={{ "--depth": child.depth - rootDepth - 1, "--k": k } as CSSProperties}>
                        <Link to={`/projecten/${child.id}`} className="place-link child" aria-current={current === child.id ? "page" : undefined}>
                          <span className="place-name">{child.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
        <li>
          <Link to="/projecten/nieuw" className="place-add">
            <Icon name="plus" size={14} />
            <span>Project</span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
