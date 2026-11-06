import { useState, type CSSProperties } from "react";
import { useLocation } from "react-router";
import { isKiosk } from "../device";
import { groupByTag, listIcon, listTone } from "../lists";
import { Link, NavLink } from "../router";
import { useSession } from "../session";
import { Icon, type IconName } from "./Icon";

/** ⌘K op een Mac, Ctrl K elders. */
export const SEARCH_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K";

/** De vaste plekken bovenaan: het overzicht, de agenda en de weergaven over al je lijsten. */
export const PLACES: { to: string; label: string; icon: IconName }[] = [
  { to: "/", label: "Overzicht", icon: "project" },
  { to: "/agenda", label: "Agenda", icon: "calendar" },
  { to: "/geld", label: "Geld", icon: "wallet" },
  { to: "/voorraad", label: "Voorraad", icon: "package" },
  { to: "/eten", label: "Eten", icon: "food" },
  { to: "/te-doen", label: "Te doen", icon: "check" },
];

/** De lijst die je nu bekijkt (uit het adres). */
const currentList = (pathname: string) => pathname.match(/^\/lijsten\/([0-9a-f-]{36})/)?.[1] ?? null;

/**
 * Zijbalk op het grijze canvas (zie STIJLBOEK.md → Zijbalk): de app, zoeken, de vaste plekken en je lijsten per tag
 * (een tag klapt open). Jouw gegevens: je letter rechtsboven in de paneelbalk.
 */
export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const { lists, tags } = useSession();
  const { pathname } = useLocation();
  const current = currentList(pathname);
  const navIndex = PLACES.findIndex((p) => (p.to === "/" ? pathname === "/" : pathname.startsWith(p.to)));

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
          <span className="sidebar-indicator" style={{ "--i": navIndex, opacity: navIndex >= 0 ? 1 : 0 } as CSSProperties} />
          {PLACES.map((p) => (
            <NavLink key={p.to} to={p.to} end={p.to === "/"} title={p.label}>
              <Icon name={p.icon} size={17} />
              <span className="nav-text">{p.label}</span>
            </NavLink>
          ))}
        </nav>

        <TagTree lists={lists} tags={tags} current={current} />
      </div>
    </aside>
  );
}

/** Je lijsten per tag: elke tag klapt open (open als je er een lijst van bekijkt); wat zonder tag is, onderaan. */
function TagTree({ lists, tags, current }: { lists: ReturnType<typeof useSession>["lists"]; tags: ReturnType<typeof useSession>["tags"]; current: string | null }) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const groups = groupByTag(lists, tags);
  return (
    <div className="sidebar-places">
      <p className="nav-section">Lijsten</p>
      <ul className="place-tree">
        {groups.map((g) => {
          const key = g.tag?.id ?? "zonder";
          const open = toggled[key] ?? (groups.length <= 2 || (current !== null && g.lists.some((l) => l.id === current)));
          const name = g.tag?.name ?? "Zonder tag";
          return (
            <li key={key}>
              <div className="place-row">
                {g.tag ? (
                  <Link to={`/tags/${g.tag.id}`} className="place-link root">
                    <span className={`place-icon tone-${g.tag.color ?? "sky"}`}>
                      <Icon name="tag" size={15} />
                    </span>
                    <span className="place-name">{name}</span>
                  </Link>
                ) : (
                  <span className="place-link root">
                    <span className="place-icon tone-sage">
                      <Icon name="folder" size={15} />
                    </span>
                    <span className="place-name">{name}</span>
                  </span>
                )}
                <button
                  type="button"
                  className="place-toggle"
                  aria-expanded={open}
                  aria-label={`${name} ${open ? "dichtklappen" : "openklappen"}`}
                  onClick={() => setToggled((t) => ({ ...t, [key]: !open }))}
                >
                  <Icon name="down" size={14} />
                </button>
              </div>
              <div className="place-children" data-open={open} inert={!open}>
                <ul>
                  {open &&
                    g.lists.map((l, k) => (
                      <li key={l.id} style={{ "--depth": 0, "--k": k } as CSSProperties}>
                        <Link to={`/lijsten/${l.id}`} className="place-link child" aria-current={current === l.id ? "page" : undefined}>
                          <span className={`place-dot tone-${listTone(l)}`} aria-hidden="true">
                            <Icon name={listIcon(l)} size={12} />
                          </span>
                          <span className="place-name">{l.name}</span>
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            </li>
          );
        })}
        <li>
          <Link to="/lijsten/nieuw" className="place-add">
            <Icon name="plus" size={14} />
            <span>Lijst</span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
