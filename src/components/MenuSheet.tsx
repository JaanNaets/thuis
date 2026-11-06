import { useEffect } from "react";
import { useLocation } from "react-router";
import { Link, NavLink } from "../router";
import { useSession } from "../session";
import { Avatar } from "./Controls";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { currentList, PLACES, TagTree } from "./Sidebar";

/**
 * Het menublad (gsm, achter de tab Menu; zie STIJLBOEK.md → Gsm): zoeken, de vaste plekken, je lijsten per tag en
 * jij, op de schil. Een tik op een rij of een nieuwe pagina sluit het blad.
 */
export function MenuSheet({ open, onClose, onSearch }: { open: boolean; onClose: () => void; onSearch: () => void }) {
  const { lists, tags, person } = useSession();
  const { pathname } = useLocation();
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
          {PLACES.map((p) => (
            <NavLink key={p.to} to={p.to} end={p.to === "/"} className="menu-row">
              <Icon name={p.icon} size={18} />
              <span>{p.label}</span>
            </NavLink>
          ))}
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
