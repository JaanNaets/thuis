import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from "react";
import { Outlet, useLocation, useNavigation } from "react-router";
import { useApi } from "./api";
import { CommandPalette, PaletteContext, type PaletteMode } from "./components/CommandPalette";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { Icon } from "./components/Icon";
import { Sidebar } from "./components/Sidebar";
import { ToastProvider } from "./components/Toast";
import { isKiosk, useIdleReset, useOnline } from "./device";
import { useOutbox } from "./outbox";
import { NavLink, useNavigate } from "./router";
import { openingPath, startPath } from "./start";
import { SessionContext, type Me } from "./session";

const KIOSK_IDLE_MS = 5 * 60 * 1000;

/** Het geraamte rond elk scherm: zijbalk (tablet), onderbalk (gsm), het witte paneel en het zoekpalet. */
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

  // De onderbalk op een gsm: overzicht, agenda, geld en zoeken. Jouw gegevens: je letter bij de titel van het overzicht.
  const tabIndex = pathname.startsWith("/agenda") ? 1 : pathname.startsWith("/geld") ? 2 : 0;

  return (
    <SessionContext value={session}>
      <PaletteContext value={openPalette}>
      <ToastProvider>
        <ConfirmProvider>
          <div className="app">
            <div className="nav-progress" data-active={navigation.state !== "idle"} aria-hidden="true" />

            <Sidebar onSearch={() => openPalette("search")} />

            <nav className="tabbar" aria-label="Hoofdmenu" style={{ "--n": 4 } as CSSProperties}>
              <span className="tabbar-indicator" style={{ "--i": tabIndex } as CSSProperties} />
              <NavLink to="/" className={({ isActive }) => (isActive || !/^\/(agenda|geld)/.test(pathname) ? "active" : "")}>
                <Icon name="project" size={21} />
                <span>Overzicht</span>
              </NavLink>
              <NavLink to="/agenda">
                <Icon name="calendar" size={21} />
                <span>Agenda</span>
              </NavLink>
              <NavLink to="/geld">
                <Icon name="wallet" size={21} />
                <span>Geld</span>
              </NavLink>
              <button type="button" className="tab-button" onClick={() => openPalette("search")}>
                <Icon name="search" size={21} />
                <span>Zoeken</span>
              </button>
            </nav>

            <main>
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
      </PaletteContext>
    </SessionContext>
  );
}
