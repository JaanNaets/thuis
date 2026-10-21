import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Navigate, Outlet, useLocation, useNavigation } from "react-router";
import type { HouseholdAccess, Me, Stats } from "../shared/types";
import { api, useApi } from "./api";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { Icon } from "./components/Icon";
import { GUEST_MENU, MENU, SETTINGS, Sidebar } from "./components/Sidebar";
import { ToastProvider } from "./components/Toast";
import { isKiosk, useIdleReset, useOnline } from "./device";
import { setCurrentHousehold, useCurrentHousehold } from "./household";
import { NavLink, useNavigate } from "./router";
import { SessionContext, useSession } from "./session";

export const HOME = "/aankopen";
export const GUEST_HOME = "/projecten";
const KIOSK_IDLE_MS = 5 * 60 * 1000;

/** Wat een gast (enkel projecten) mag openen. Al de rest stuurt de app naar zijn projecten. */
const GUEST_PATHS = ["/projecten", "/aankopen/", "/uitgaven/terugkerend/", "/meer"];

/** Het geraamte rond elk scherm: zijbalk (tablet), onderbalk (gsm), het witte paneel en het zoekpalet. */
export function App() {
  const { data: me, error, reload: reloadMe } = useApi<Me>("/me");
  const current = useCurrentHousehold();

  // Het gekozen huishouden moet er een zijn waar je lid van bent; anders het eerste (liefst met volledige toegang).
  const membership = me?.households.find((h) => h.id === current);
  const fallback = me?.households.find((h) => h.member.access === "full") ?? me?.households[0];
  useLayoutEffect(() => {
    if (me && !membership && fallback) setCurrentHousehold(fallback.id);
  }, [me, membership, fallback]);

  if (error && !me) return <p className="error page">{error}</p>;
  if (!me) return null;
  if (me.households.length === 0) return <NoAccess email={me.email} />;
  if (!membership) return null;
  return <Shell me={me} membership={membership} reloadMe={reloadMe} />;
}

function Shell({ me, membership, reloadMe }: { me: Me; membership: HouseholdAccess; reloadMe: () => void }) {
  const full = membership.member.access === "full";
  const { data: stats, reload: reloadStats } = useApi<Stats>("/stats");
  const online = useOnline();
  const { pathname } = useLocation();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const [searching, setSearching] = useState(false);
  useIdleReset(isKiosk, KIOSK_IDLE_MS, HOME);

  // Bij elke start de klantenkaarten ophalen, zodat de service worker altijd de recentste versie
  // bewaart, en het kaartscherm alvast laden: zo opent een kaart meteen, ook zonder internet.
  useEffect(() => {
    if (!full) return;
    api.get("/loyalty-cards").catch(() => {});
    const timer = window.setTimeout(() => {
      import("./pages/CardDetail").catch(() => {});
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [full, membership.id]);

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

  const switchHousehold = useCallback(
    (id: string) => {
      setCurrentHousehold(id);
      const next = me.households.find((h) => h.id === id);
      navigate(next?.member.access === "full" ? HOME : GUEST_HOME, { replace: true });
    },
    [me.households, navigate],
  );

  const session = useMemo(
    () => ({ email: me.email, households: me.households, membership, full, stats, openSearch: () => setSearching(true), switchHousehold, reloadMe }),
    [me, membership, full, stats, switchHousehold, reloadMe],
  );

  const menu = full ? MENU : GUEST_MENU;
  const tabs = full ? [...MENU.filter((m) => m.tab), { ...SETTINGS, label: SETTINGS.short }] : [...GUEST_MENU, { ...SETTINGS, label: SETTINGS.short }];
  const tabIndex = tabs.findIndex((n) => pathname.startsWith(n.to));
  const blocked = !full && !GUEST_PATHS.some((p) => pathname.startsWith(p));

  return (
    <SessionContext value={session}>
      <ToastProvider>
        <ConfirmProvider>
          <div className="app">
            <div className="nav-progress" data-active={navigation.state !== "idle"} aria-hidden="true" />

            <Sidebar menu={menu} onSearch={() => setSearching(true)} />

            <nav className="tabbar" aria-label="Hoofdmenu" style={{ "--n": tabs.length } as CSSProperties}>
              <span className="tabbar-indicator" style={{ "--i": Math.max(tabIndex, 0), opacity: tabIndex < 0 ? 0 : 1 } as CSSProperties} />
              {tabs.map((item) => (
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
              {blocked ? <Navigate to={GUEST_HOME} replace /> : <Outlet />}
            </main>

            <CommandPalette open={searching} onClose={() => setSearching(false)} />
          </div>
        </ConfirmProvider>
      </ToastProvider>
    </SessionContext>
  );
}

/** Begin van de app: gewone leden naar hun aankopen, gasten naar hun projecten. */
export function Home() {
  const { full } = useSession();
  return <Navigate to={full ? HOME : GUEST_HOME} replace />;
}

/** Aangemeld, maar nog nergens lid van. */
function NoAccess({ email }: { email: string }) {
  return (
    <div className="no-access">
      <span className="brand-mark">
        <Icon name="home" size={18} />
      </span>
      <h1>Nog geen toegang</h1>
      <p>
        Je bent aangemeld als <strong>{email}</strong>, maar je bent nog geen lid van een huishouden. Vraag iemand van het huishouden om je toe te voegen bij
        Instellingen → Huishouden, met dit e-mailadres.
      </p>
    </div>
  );
}
