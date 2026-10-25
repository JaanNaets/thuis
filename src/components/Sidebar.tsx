import { templateOf } from "../../shared/fields";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useLocation, useSearchParams } from "react-router";
import { descendantIds, flattenTree } from "../../shared/tree";
import type { HouseholdAccess, Location, Stats, Tone } from "../../shared/types";
import { api } from "../api";
import { isKiosk } from "../device";
import { Link, NavLink } from "../router";
import { useSession } from "../session";
import { useTaxonomy } from "../taxonomy";
import { SubmitButton } from "./Controls";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

export type MenuItem = { to: string; label: string; icon: IconName; /** Ook in de onderbalk op een gsm. */ tab?: boolean };

export const MENU: MenuItem[] = [
  { to: "/aankopen", label: "Aankopen", icon: "receipt", tab: true },
  { to: "/uitgaven", label: "Uitgaven", icon: "wallet", tab: true },
  { to: "/projecten", label: "Projecten", icon: "project" },
  { to: "/voorraad", label: "Voorraad", icon: "package", tab: true },
  { to: "/bezit", label: "Bezit", icon: "armchair" },
  { to: "/kaarten", label: "Kaarten", icon: "card", tab: true },
  { to: "/verkopers", label: "Verkopers", icon: "store" },
];

/** Een gast in een project ziet enkel zijn projecten. */
export const GUEST_MENU: MenuItem[] = [
  { to: "/projecten", label: "Projecten", icon: "project", tab: true },
  { to: "/gedeeld", label: "Gedeeld", icon: "transfer", tab: true },
];

export const SETTINGS = { to: "/meer", label: "Instellingen", short: "Meer", icon: "sliders" } as const;

/** ⌘K op een Mac, Ctrl K elders. */
export const SEARCH_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K";

function countFor(stats: Stats | undefined, to: string): { value: number; warn?: boolean } | undefined {
  if (!stats) return undefined;
  switch (to) {
    case "/aankopen":
      return { value: stats.purchases };
    case "/voorraad":
      return stats.low > 0 ? { value: stats.low, warn: true } : { value: stats.items };
    case "/bezit":
      return { value: stats.assets };
    case "/kaarten":
      return { value: stats.cards };
    case "/verkopers":
      return { value: stats.vendors };
    case "/projecten":
      return { value: stats.projects };
  }
}

/**
 * Zijbalk op het grijze canvas (zie STIJLBOEK.md → Zijbalk): het huishouden (om te wisselen), zoeken, menu,
 * de projecten en de plaatsen in huis als boom, en Instellingen onderaan.
 */
export function Sidebar({ menu, onSearch }: { menu: MenuItem[]; onSearch: () => void }) {
  const { pathname } = useLocation();
  const { stats, full } = useSession();
  const active = menu.findIndex((n) => pathname.startsWith(n.to));

  return (
    <aside className="sidebar" aria-label="Hoofdmenu">
      <HouseholdSwitcher />

      <button type="button" className="sidebar-search" onClick={onSearch} title={`Zoeken (${SEARCH_SHORTCUT})`}>
        <Icon name="search" size={15} />
        <span className="nav-text">Zoeken…</span>
        <kbd className="nav-text">{SEARCH_SHORTCUT}</kbd>
      </button>

      <div className="sidebar-scroll">
        <p className="nav-section">Menu</p>
        <nav className="sidebar-nav">
          <span className="sidebar-indicator" style={{ "--i": Math.max(active, 0), opacity: active < 0 ? 0 : 1 } as CSSProperties} />
          {menu.map((item) => {
            const count = countFor(stats, item.to);
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

        <ProjectList />
        {full && <PlaceTree />}
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
 * Het blok bovenaan: het huidige huishouden. Een klik toont de andere huishoudens waar je lid van bent
 * (en een nieuw huishouden), zoals de werkplekken in de referentie.
 */
function HouseholdSwitcher() {
  const { households, membership, switchHousehold } = useSession();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const canCreate = households.some((h) => h.member.access === "full");

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="workspace-wrap" ref={ref}>
      <button type="button" className="workspace" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={membership?.name}>
        <span className="brand-mark">
          <Icon name="home" size={15} />
        </span>
        <span className="nav-text workspace-name">{membership?.name ?? "Thuis"}</span>
        {isKiosk && <span className="nav-text workspace-note">Kiosk</span>}
        <Icon name="chevrons" size={14} className="nav-text workspace-chevrons" />
      </button>

      <div className="workspace-menu" role="menu" data-open={open} inert={!open}>
        <p className="workspace-menu-label">Huishoudens</p>
        {households.map((h) => (
          <HouseholdItem
            key={h.id}
            household={h}
            current={h.id === membership?.id}
            onPick={() => {
              setOpen(false);
              if (h.id !== membership?.id) switchHousehold(h.id);
            }}
          />
        ))}
        {canCreate && (
          <button
            type="button"
            role="menuitem"
            className="workspace-item add"
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
          >
            <span className="workspace-item-icon">
              <Icon name="plus" size={14} />
            </span>
            Nieuw huishouden
          </button>
        )}
      </div>

      <Sheet open={creating} title="Nieuw huishouden" onClose={() => setCreating(false)}>
        {creating && <NewHousehold onDone={() => setCreating(false)} />}
      </Sheet>
    </div>
  );
}

function HouseholdItem({ household, current, onPick }: { household: HouseholdAccess; current: boolean; onPick: () => void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={current} className="workspace-item" onClick={onPick}>
      <span className="workspace-item-icon">
        <Icon name="home" size={13} />
      </span>
      <span className="workspace-item-name">
        {household.name}
        {household.member.access === "projects" && <small>enkel projecten</small>}
      </span>
      {current && <Icon name="check" size={15} className="workspace-check" />}
    </button>
  );
}

export function NewHousehold({ onDone }: { onDone: () => void }) {
  const { reloadMe, switchHousehold } = useSession();
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const created = await api.post<HouseholdAccess>("/households", { name });
      reloadMe();
      onDone();
      toast(`${created.name} aangemaakt`);
      switchHousehold(created.id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <p className="hint">Een apart huishouden met eigen leden, voorraad, kaarten en uitgaven. Je krijgt de gewone startindeling.</p>
      <label className="field">
        <span className="label">Naam</span>
        <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="bv. Huis aan zee" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <SubmitButton busy={busy}>Aanmaken</SubmitButton>
      </div>
    </form>
  );
}

/** De lopende projecten, met een gekleurd icoontje, zoals de collecties in de referentie. */
function ProjectList() {
  const { data: taxonomy } = useTaxonomy();
  const { full } = useSession();
  const { pathname } = useLocation();
  if (!taxonomy) return null;
  const projects = taxonomy.projects.filter((p) => !p.archived);
  if (projects.length === 0 && !full) return null;

  return (
    <div className="sidebar-places">
      <p className="nav-section">Projecten</p>
      <ul className="place-tree">
        {projects.map((p, i) => (
          <li key={p.id}>
            <Link to={`/projecten/${p.id}`} className="place-link root" aria-current={pathname === `/projecten/${p.id}` ? "page" : undefined}>
              <span className={`place-icon tone-${p.color ?? PLACE_TONES[i % PLACE_TONES.length]}`}>
                <Icon name={templateOf(p.template).icon} size={15} />
              </span>
              <span className="place-name">{p.name}</span>
            </Link>
          </li>
        ))}
        {full && (
          <li>
            <Link to="/projecten/nieuw" className="place-add">
              <Icon name="plus" size={14} />
              <span>Project</span>
            </Link>
          </li>
        )}
      </ul>
    </div>
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

// Elke hoofdplaats (en elk project zonder eigen kleur) een eigen kleur, in een vaste volgorde die mooi afwisselt.
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
