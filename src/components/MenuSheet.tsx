import { useEffect } from "react";
import { useLocation } from "react-router";
import { Link, NavLink } from "../router";
import { useSession } from "../session";
import { Avatar } from "./Controls";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { currentList, LINKS_PLACE, onLinks, placeIndex, placesOf, TagTree } from "./Sidebar";

/**
 * Het menublad (gsm, achter de tab Menu; zie STIJLBOEK.md → Gsm): zoeken, je borden, onder Lijsten Verbanden en je
 * lijsten per tag, en jij, op de schil. Een tik op een rij of een nieuwe pagina sluit het blad.
 */
export function MenuSheet({ open, onClose, onSearch }: { open: boolean; onClose: () => void; onSearch: () => void }) {
  const { lists, tags, person, boards } = useSession();
  const { pathname } = useLocation();
  const places = placesOf(boards);
  const here = placeIndex(places, pathname);
  useEffect(() => onClose(), [pathname]);

  return (
    <Sheet open={open} title="Menu" onClose={onClose} className="menu-sheet">
      <div className="menu-body" onClick={(e) => (e.target as HTMLElement).closest("a") && onClose()}>
        <button
          type="button"
          className="menu-search"
          onClick={() => {
            onClose();
            onSearch();
          }}
        >
          <Icon name="search" size={16} />
          <span>Zoeken…</span>
        </button>
        <nav className="menu-places" aria-label="Plekken">
          {places.map((p, i) => (
            <NavLink key={p.to} to={p.to} end className={`menu-row${i === here ? " active" : ""}`}>
              <Icon name={p.icon} size={18} />
              <span>{p.label}</span>
            </NavLink>
          ))}
        </nav>
        <p className="nav-section">Lijsten</p>
        <nav className="menu-places" aria-label="Lijsten">
          <NavLink to={LINKS_PLACE.to} className={`menu-row${onLinks(pathname) ? " active" : ""}`}>
            <Icon name={LINKS_PLACE.icon} size={18} />
            <span>{LINKS_PLACE.label}</span>
          </NavLink>
        </nav>
        <TagTree lists={lists} tags={tags} current={currentList(pathname)} />
        <Link to="/ik" className="menu-row menu-me">
          <Avatar member={person} />
          <span>Jouw gegevens</span>
        </Link>
      </div>
    </Sheet>
  );
}
