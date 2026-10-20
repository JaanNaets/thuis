import { useState, type CSSProperties } from "react";
import { useLocation, useSearchParams } from "react-router";
import { descendantIds, flattenTree } from "../../shared/tree";
import type { Location, Stats, Tone } from "../../shared/types";
import { isKiosk } from "../device";
import { Link, NavLink } from "../router";
import { useTaxonomy } from "../taxonomy";
import { Icon, type IconName } from "./Icon";

export const MENU = [
  { to: "/aankopen", label: "Aankopen", icon: "receipt" },
  { to: "/uitgaven", label: "Uitgaven", icon: "wallet" },
  { to: "/voorraad", label: "Voorraad", icon: "package" },
  { to: "/kaarten", label: "Kaarten", icon: "card" },
] as const satisfies readonly { to: string; label: string; icon: IconName }[];

export const SETTINGS = { to: "/meer", label: "Instellingen", short: "Meer", icon: "sliders" } as const;

/** ⌘K op een Mac, Ctrl K elders. */
export const SEARCH_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K";

/**
 * Zijbalk op het grijze canvas (zie STIJLBOEK.md → Zijbalk): werkplek, zoeken, menu,
 * de plaatsen in huis als boom, en Instellingen onderaan.
 */
export function Sidebar({ stats, onSearch }: { stats?: Stats; onSearch: () => void }) {
  const { pathname } = useLocation();
  const active = MENU.findIndex((n) => pathname.startsWith(n.to));
  const counts: Record<string, { value: number; warn?: boolean } | undefined> = stats
    ? {
        "/aankopen": { value: stats.purchases },
        "/voorraad": stats.low > 0 ? { value: stats.low, warn: true } : { value: stats.items },
        "/kaarten": { value: stats.cards },
      }
    : {};

  return (
    <aside className="sidebar" aria-label="Hoofdmenu">
      <Link to="/" className="workspace" title="Thuis">
        <span className="brand-mark">
          <Icon name="home" size={15} />
        </span>
        <span className="nav-text">Thuis</span>
        {isKiosk && <span className="nav-text workspace-note">Kiosk</span>}
      </Link>

      <button type="button" className="sidebar-search" onClick={onSearch} title={`Zoeken (${SEARCH_SHORTCUT})`}>
        <Icon name="search" size={15} />
        <span className="nav-text">Zoeken…</span>
        <kbd className="nav-text">{SEARCH_SHORTCUT}</kbd>
      </button>

      <div className="sidebar-scroll">
        <p className="nav-section">Menu</p>
        <nav className="sidebar-nav">
          <span className="sidebar-indicator" style={{ "--i": Math.max(active, 0), opacity: active < 0 ? 0 : 1 } as CSSProperties} />
          {MENU.map((item) => {
            const count = counts[item.to];
            return (
              <NavLink key={item.to} to={item.to} title={item.label}>
                <Icon name={item.icon} size={17} />
                <span className="nav-text">{item.label}</span>
                {count && count.value > 0 && (
                  <span className={`nav-count ${count.warn ? "warn" : ""}`} title={count.warn ? "Bijna op" : undefined}>
                    {count.value.toLocaleString("nl-BE")}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <PlaceTree />
      </div>

      <div className="sidebar-bottom">
        <NavLink to={SETTINGS.to} title={SETTINGS.label}>
          <Icon name={SETTINGS.icon} size={17} />
          <span className="nav-text">{SETTINGS.label}</span>
        </NavLink>
      </div>
    </aside>
  );
}

/**
 * De plaatsen in huis, zoals de collecties in de referentie: een hoofdplaats klapt open
 * en toont wat erin zit. Een klik toont de voorraad op die plek.
 */
function PlaceTree() {
  const { data: taxonomy } = useTaxonomy();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  if (!taxonomy) return null;

  const current = pathname === "/voorraad" ? params.get("plaats") : null;
  const flat = flattenTree(taxonomy.locations);
  const roots = flat.filter((l) => l.depth === 0);

  return (
    <div className="sidebar-places">
      <p className="nav-section">Plaatsen</p>
      <ul className="place-tree">
        {roots.map((root, index) => {
          const below = descendantIds(taxonomy.locations, root.id);
          const children = flat.filter((l) => l.id !== root.id && below.has(l.id));
          // Open als je erop klikte, of als je nu deze plaats (of iets erin) bekijkt.
          const open = toggled[root.id] ?? (current !== null && below.has(current));
          return (
            <li key={root.id}>
              <div className="place-row">
                <PlaceLink place={root} current={current} tone={PLACE_TONES[index % PLACE_TONES.length]} />
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
                      <li key={child.id} style={{ "--depth": child.depth - 1, "--k": k } as CSSProperties}>
                        <PlaceLink place={child} current={current} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
        <li>
          <Link to="/meer?tab=plaatsen" className="place-add">
            <Icon name="plus" size={14} />
            <span>Plaats toevoegen</span>
          </Link>
        </li>
      </ul>
    </div>
  );
}

// Elke hoofdplaats een eigen kleur, in een vaste volgorde die mooi afwisselt.
const PLACE_TONES: Tone[] = ["peach", "sky", "sage", "lilac", "butter", "rose", "mint"];

function PlaceLink({ place, current, tone }: { place: Location & { depth: number }; current: string | null; tone?: Tone }) {
  const root = place.depth === 0;
  return (
    <Link to={`/voorraad?plaats=${place.id}`} className={`place-link ${root ? "root" : "child"}`} aria-current={current === place.id ? "page" : undefined}>
      {tone && (
        <span className={`place-icon tone-${tone}`}>
          <Icon name="pin" size={15} />
        </span>
      )}
      <span className="place-name">{place.name}</span>
    </Link>
  );
}
