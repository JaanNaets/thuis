import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from "react";
import { Outlet, useLocation, useNavigation } from "react-router";
import type { Me } from "../shared/types";
import { useApi } from "./api";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { Icon } from "./components/Icon";
import { Sidebar } from "./components/Sidebar";
import { ToastProvider } from "./components/Toast";
import { isKiosk, useIdleReset, useOnline } from "./device";
import { NavLink } from "./router";
import { SessionContext } from "./session";

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
  const { pathname } = useLocation();
  const navigation = useNavigation();
  const [searching, setSearching] = useState(false);
  useIdleReset(isKiosk, KIOSK_IDLE_MS, "/");

  // ⌘K / Ctrl K opent het zoekpalet, overal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearching((s) => !s);
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

  const session = useMemo(() => ({ person: me.person, projects: me.projects, reloadMe, openSearch: () => setSearching(true) }), [me, reloadMe]);

  // De onderbalk op een gsm: projecten, zoeken en jij.
  const tabIndex = pathname.startsWith("/ik") ? 2 : 0;

  return (
    <SessionContext value={session}>
      <ToastProvider>
        <ConfirmProvider>
          <div className="app">
            <div className="nav-progress" data-active={navigation.state !== "idle"} aria-hidden="true" />

            <Sidebar onSearch={() => setSearching(true)} />

            <nav className="tabbar" aria-label="Hoofdmenu" style={{ "--n": 3 } as CSSProperties}>
              <span className="tabbar-indicator" style={{ "--i": tabIndex } as CSSProperties} />
              <NavLink to="/" className={({ isActive }) => (isActive || pathname.startsWith("/projecten") || pathname.startsWith("/items") ? "active" : "")}>
                <Icon name="project" size={21} />
                <span>Projecten</span>
              </NavLink>
              <button type="button" className="tab-button" onClick={() => setSearching(true)}>
                <Icon name="search" size={21} />
                <span>Zoeken</span>
              </button>
              <NavLink to="/ik">
                <Icon name="user" size={21} />
                <span>Ik</span>
              </NavLink>
            </nav>

            <main>
              {!online && (
                <p className="offline-note" role="status">
                  Offline · wat je bewaart, lukt pas weer met internet
                </p>
              )}
              <Outlet />
            </main>

            <CommandPalette open={searching} onClose={() => setSearching(false)} />
          </div>
        </ConfirmProvider>
      </ToastProvider>
    </SessionContext>
  );
}
