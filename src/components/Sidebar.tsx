import { useState, type CSSProperties } from "react";
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
 * Zijbalk op het grijze canvas (zie STIJLBOEK.md → Zijbalk): de app, zoeken, al je projecten als boom (een project
 * klapt open en toont zijn subprojecten), en jouw gegevens onderaan.
 */
export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const { projects, person } = useSession();
  const { pathname } = useLocation();
  const current = currentProject(pathname);

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
        <kbd className="nav-text">{SEARCH_SHORTCUT}</kbd>
      </button>

      <div className="sidebar-scroll">
        <nav className="sidebar-nav">
          <span className="sidebar-indicator" style={{ "--i": 0, opacity: pathname === "/" ? 1 : 0 } as CSSProperties} />
          <NavLink to="/" end title="Overzicht">
            <Icon name="project" size={17} />
            <span className="nav-text">Overzicht</span>
            {projects.length > 0 && <span className="nav-count">{projects.filter((p) => !p.archived).length}</span>}
          </NavLink>
        </nav>

        <ProjectTree projects={projects} current={current} />
      </div>

      <div className="sidebar-bottom">
        <NavLink to="/ik" title={person.name}>
          <Icon name="user" size={17} />
          <span className="nav-text">{person.name || "Jouw gegevens"}</span>
        </NavLink>
      </div>
    </aside>
  );
}

/** De projecten bovenaan, elk met een gekleurd icoon; een project met subprojecten klapt open. */
function ProjectTree({ projects, current }: { projects: ProjectNode[]; current: string | null }) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const live = projects.filter((p) => !p.archived);
  const flat = projectTree(live);
  const roots = childrenOf(live, null);

  return (
    <div className="sidebar-places">
      <p className="nav-section">Projecten</p>
      <ul className="place-tree">
        {roots.map((root, index) => {
          const below = descendantIds(live, root.id);
          const children = flat.filter((p) => p.id !== root.id && below.has(p.id));
          const rootDepth = flat.find((p) => p.id === root.id)?.depth ?? 0;
          // Open als je erop klikte, of als je nu dit project (of iets erin) bekijkt.
          const open = toggled[root.id] ?? (current !== null && below.has(current));
          return (
            <li key={root.id}>
              <div className="place-row">
                <Link to={`/projecten/${root.id}`} className="place-link root" aria-current={current === root.id ? "page" : undefined}>
                  <span className={`place-icon tone-${root.color ?? TONES[index % TONES.length]}`}>
                    <Icon name={projectIcon(root)} size={15} />
                  </span>
                  <span className="place-name">{root.name}</span>
                </Link>
                {children.length > 0 && (
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
              {children.length > 0 && (
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
