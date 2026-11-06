import { useState, type CSSProperties } from "react";
import { useLocation } from "react-router";
import { boardPath } from "../../shared/apps";
import type { BoardInfo } from "../../shared/board";
import { isKiosk } from "../device";
import { groupByTag, listIcon, listTone } from "../lists";
import { Link, NavLink } from "../router";
import { useSession } from "../session";
import { Icon, type IconName } from "./Icon";

/** ⌘K op een Mac, Ctrl K elders. */
export const SEARCH_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K";

export type Place = { to: string; label: string; icon: IconName };

/**
 * De plekken bovenaan het menu: je borden, in jouw volgorde (het eerste op /, je beginscherm). Geld, Agenda, Te doen, …
 * zijn gewone borden die je zelf samenstelt.
 */
export function placesOf(boards: BoardInfo[]): Place[] {
  return boards.map((b, i) => ({ to: i === 0 ? "/" : boardPath(b.id), label: b.name, icon: (b.icon || "project") as IconName }));
}

/** Verbanden: het overzicht van al je lijsten, dus bovenaan de lijsten in het menu en niet tussen de borden. */
export const LINKS_PLACE: Place = { to: "/verbanden", label: "Verbanden", icon: "links" };
export const onLinks = (pathname: string) => pathname === LINKS_PLACE.to || pathname.startsWith(`${LINKS_PLACE.to}/`);

/** Welke plek je nu bekijkt (-1: geen, bv. een lijst). */
export function placeIndex(places: Place[], pathname: string): number {
  const path = decodeURI(pathname);
  return places.findIndex((p) => (p.to === "/" ? path === "/" : path === decodeURI(p.to) || path.startsWith(`${decodeURI(p.to)}/`)));
}

/** De lijst die je nu bekijkt (uit het adres). */
export const currentList = (pathname: string) => pathname.match(/^\/lijsten\/([0-9a-f-]{36})/)?.[1] ?? null;

/**
 * Zijbalk op het grijze canvas (zie STIJLBOEK.md → Zijbalk): de app, zoeken, je borden, en onder Lijsten Verbanden en je
 * lijsten per tag (een tag klapt open). Smal (enkel iconen) blijft van de lijsten enkel Verbanden over, onder een
 * haarlijn. Jouw gegevens: je letter rechtsboven in de paneelbalk.
 */
export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const { lists, tags, boards } = useSession();
  const { pathname } = useLocation();
  const current = currentList(pathname);
  const places = placesOf(boards);
  const navIndex = placeIndex(places, pathname);

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
          {places.map((p, i) => (
            <NavLink key={p.to} to={p.to} end className={i === navIndex ? "active" : undefined} title={p.label}>
              <Icon name={p.icon} size={17} />
              <span className="nav-text">{p.label}</span>
            </NavLink>
          ))}
        </nav>

        <p className="nav-section">Lijsten</p>
        <nav className="sidebar-nav sidebar-lists" aria-label="Lijsten">
          <NavLink to={LINKS_PLACE.to} className={onLinks(pathname) ? "active" : undefined} title={LINKS_PLACE.label}>
            <Icon name={LINKS_PLACE.icon} size={17} />
            <span className="nav-text">{LINKS_PLACE.label}</span>
          </NavLink>
        </nav>
        <TagTree lists={lists} tags={tags} current={current} />
      </div>
    </aside>
  );
}

/** Je lijsten per tag: elke tag klapt open (open als je er een lijst van bekijkt); wat zonder tag is, onderaan. De kop
 * "Lijsten" en Verbanden staan erboven, bij wie de boom toont. */
export function TagTree({ lists, tags, current }: { lists: ReturnType<typeof useSession>["lists"]; tags: ReturnType<typeof useSession>["tags"]; current: string | null }) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const groups = groupByTag(lists, tags);
  return (
    <div className="sidebar-places">
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
