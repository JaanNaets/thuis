import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from "react";
import { Outlet, useLocation, useNavigation } from "react-router";
import { useApi } from "./api";
import { CommandPalette, PaletteContext, type PaletteMode } from "./components/CommandPalette";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { Icon } from "./components/Icon";
import { MenuSheet } from "./components/MenuSheet";
import { Sidebar } from "./components/Sidebar";
import { ToastProvider } from "./components/Toast";
import { isKiosk, useIdleReset, useOnline } from "./device";
import { useOutbox } from "./outbox";
import { Link, NavLink, useNavigate } from "./router";
import { AddContext, type AddAction } from "./shell";
import { openingPath, startPath } from "./start";
import { SessionContext, type Me } from "./session";

const KIOSK_IDLE_MS = 5 * 60 * 1000;

/** Het geraamte rond elk scherm: zijbalk (tablet), onderbalk en menublad (gsm), het witte paneel en het zoekpalet. */
export function App() {
  const { data: me, error, reload: reloadMe } = useApi<Me>("/me");
  if (error && !me) return <p className="error page">{error}</p>;
  if (!me) return null;
  return <Shell me={me} reloadMe={reloadMe} />;
}

function Shell({ me, reloadMe }: { me: Me; reloadMe: () => void }) {
  const online = useOnline();
  const outbox = useOutbox(online);
  const { pathname } = useLocation();
  const navigation = useNavigation();
  // Het palet (zoeken en toevoegen): dicht, of open in een modus, eventueel met tekst.
  const [palette, setPalette] = useState<{ mode: PaletteMode; text: string } | null>(null);
  const openPalette = useCallback((mode: PaletteMode, text = "") => setPalette({ mode, text }), []);
  // De + in de onderbalk: wat het scherm vraagt, anders het palet om toe te voegen.
  const [add, setAdd] = useState<AddAction | null>(null);
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const navigate = useNavigate();
  const { search } = useLocation();
  // Waar de app opent op dit toestel (zie start.ts); de kiosk keert daar ook naar terug.
  const [home] = useState(startPath);
  useIdleReset(isKiosk, KIOSK_IDLE_MS, home);
  useEffect(() => {
    const to = openingPath(pathname, search);
    if (to) navigate(to, { replace: true });
  }, []);

  // ⌘K / Ctrl K opent het zoekpalet, overal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((s) => (s ? null : { mode: "search", text: "" }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Nieuw scherm: bovenaan beginnen (op tablet scrollt het paneel, op een gsm het venster).
  // Vóór het tekenen, zodat de schermovergang meteen het nieuwe begin toont.
  useLayoutEffect(() => {
    window.scrollTo({ top: 0 });
    document.querySelector("main")?.scrollTo({ top: 0 });
  }, [pathname]);

  const session = useMemo(() => ({ person: me.person, lists: me.lists, tags: me.tags, ai: me.ai !== false, reloadMe, openSearch: () => openPalette("search") }), [me, reloadMe]);

  // De onderbalk op een gsm: Overzicht, Agenda, de +, Geld en Menu. Menu licht op voor wat enkel in het menublad staat,
  // en zolang dat open is.
  const tabIndex = menu ? 4 : pathname === "/" ? 0 : pathname.startsWith("/agenda") ? 1 : pathname.startsWith("/geld") ? 3 : 4;

  return (
    <SessionContext value={session}>
      <PaletteContext value={openPalette}>
      <AddContext value={setAdd}>
      <ToastProvider>
        <ConfirmProvider>
          <div className="app">
            <a
              href="#inhoud"
              className="skiplink"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("inhoud")?.focus();
              }}
            >
              Naar de inhoud
            </a>
            <div className="nav-progress" data-active={navigation.state !== "idle"} aria-hidden="true" />

            <Sidebar onSearch={() => openPalette("search")} />

            <nav className="tabbar" aria-label="Hoofdmenu" style={{ "--n": 5 } as CSSProperties}>
              <span className="tabbar-indicator" style={{ "--i": tabIndex } as CSSProperties} />
              <NavLink to="/" end className={tabIndex === 0 ? "active" : ""}>
                <Icon name="project" size={20} />
                <span>Overzicht</span>
              </NavLink>
              <NavLink to="/agenda" className={tabIndex === 1 ? "active" : ""}>
                <Icon name="calendar" size={20} />
                <span>Agenda</span>
              </NavLink>
              {add?.to ? (
                <Link to={add.to} className="tab-add" aria-label={add.label}>
                  <span>
                    <Icon name="plus" size={20} />
                  </span>
                </Link>
              ) : (
                <button type="button" className="tab-add" aria-label={add?.label ?? "Toevoegen"} onClick={add?.onClick ?? (() => openPalette("add"))}>
                  <span>
                    <Icon name="plus" size={20} />
                  </span>
                </button>
              )}
              <NavLink to="/geld" className={tabIndex === 3 ? "active" : ""}>
                <Icon name="wallet" size={20} />
                <span>Geld</span>
              </NavLink>
              <button type="button" className={`tab-button${tabIndex === 4 ? " active" : ""}`} aria-expanded={menu} onClick={() => setMenu(true)}>
                <Icon name="menu" size={20} />
                <span>Menu</span>
              </button>
            </nav>

            <MenuSheet open={menu} onClose={closeMenu} onSearch={() => openPalette("search")} />

            <main id="inhoud" tabIndex={-1}>
              {!online && (
                <p className="offline-note" role="status">
                  {outbox
                    ? `Offline · ${outbox === 1 ? "1 ding wacht" : `${outbox} dingen wachten`} op internet`
                    : "Offline · wat je logt, wacht op dit toestel tot je internet hebt"}
                </p>
              )}
              <Outlet />
            </main>

            <CommandPalette open={palette !== null} mode={palette?.mode ?? "search"} text={palette?.text} onClose={() => setPalette(null)} />
          </div>
        </ConfirmProvider>
      </ToastProvider>
      </AddContext>
      </PaletteContext>
    </SessionContext>
  );
}
