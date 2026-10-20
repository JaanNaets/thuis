import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Outlet, useLocation, useNavigation } from "react-router";
import type { Me, Stats } from "../shared/types";
import { api, useApi } from "./api";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { Icon } from "./components/Icon";
import { MENU, SETTINGS, Sidebar } from "./components/Sidebar";
import { ToastProvider } from "./components/Toast";
import { isKiosk, useIdleReset, useOnline } from "./device";
import { NavLink } from "./router";
import { SessionContext } from "./session";

export const HOME = "/aankopen";
const KIOSK_IDLE_MS = 5 * 60 * 1000;

/** Het geraamte rond elk scherm: zijbalk (tablet), onderbalk (gsm), het witte paneel en het zoekpalet. */
export function App() {
  const { data: me } = useApi<Me>("/me");
  const { data: stats, reload: reloadStats } = useApi<Stats>("/stats");
  const online = useOnline();
  const { pathname } = useLocation();
  const navigation = useNavigation();
  const [searching, setSearching] = useState(false);
  useIdleReset(isKiosk, KIOSK_IDLE_MS, HOME);

  // Bij elke start de klantenkaarten ophalen, zodat de service worker altijd de recentste versie
  // bewaart, en het kaartscherm alvast laden: zo opent een kaart meteen, ook zonder internet.
  useEffect(() => {
    api.get("/loyalty-cards").catch(() => {});
    const timer = window.setTimeout(() => {
      import("./pages/CardDetail").catch(() => {});
    }, 2500);
    return () => window.clearTimeout(timer);
  }, []);

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

  // En de tellers in de zijbalk bijwerken.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else reloadStats();
  }, [pathname, reloadStats]);

  const session = useMemo(() => ({ me, stats, openSearch: () => setSearching(true) }), [me, stats]);
  const active = MENU.findIndex((n) => pathname.startsWith(n.to));
  const tabIndex = pathname.startsWith(SETTINGS.to) ? MENU.length : active;

  return (
    <SessionContext value={session}>
      <ToastProvider>
        <ConfirmProvider>
          <div className="app">
            <div className="nav-progress" data-active={navigation.state !== "idle"} aria-hidden="true" />

            <Sidebar stats={stats} onSearch={() => setSearching(true)} />

            <nav className="tabbar" aria-label="Hoofdmenu">
              <span className="tabbar-indicator" style={{ "--i": Math.max(tabIndex, 0), opacity: tabIndex < 0 ? 0 : 1 } as CSSProperties} />
              {[...MENU, { ...SETTINGS, label: SETTINGS.short }].map((item) => (
                <NavLink key={item.to} to={item.to}>
                  <Icon name={item.icon} size={21} />
                  <span>{item.label}</span>
                  {item.to === "/voorraad" && stats && stats.low > 0 && <span className="tab-dot" aria-label={`${stats.low} bijna op`} />}
                </NavLink>
              ))}
            </nav>

            <main>
              {!online && (
                <p className="offline-note" role="status">
                  Offline · je klantenkaarten blijven beschikbaar
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
