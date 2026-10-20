import { lazy, Suspense, useEffect, useRef, type CSSProperties } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router";
import type { Me, Stats } from "../shared/types";
import { api, useApi } from "./api";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { Avatar } from "./components/Controls";
import { Icon } from "./components/Icon";
import { ToastProvider } from "./components/Toast";
import { isKiosk, useIdleReset, useOnline } from "./device";
import { CardList } from "./pages/CardList";
import { ExpensesPage } from "./pages/ExpensesPage";
import { InventoryList } from "./pages/InventoryList";
import { ItemDetail } from "./pages/ItemDetail";
import { ItemFormPage } from "./pages/ItemForm";
import { PurchaseDetail } from "./pages/PurchaseDetail";
import { PurchaseFormPage } from "./pages/PurchaseForm";
import { PurchaseList } from "./pages/PurchaseList";
import { SettingsPage } from "./pages/SettingsPage";

// De barcodebibliotheek is groot (±1 MB); die laden we pas wanneer je een kaart opent.
const CardDetail = lazy(() => import("./pages/CardDetail").then((m) => ({ default: m.CardDetail })));
const CardFormPage = lazy(() => import("./pages/CardForm").then((m) => ({ default: m.CardFormPage })));

const HOME = "/aankopen";
const KIOSK_IDLE_MS = 5 * 60 * 1000;

const MENU = [
  { to: "/aankopen", label: "Aankopen", icon: "receipt" },
  { to: "/uitgaven", label: "Uitgaven", icon: "wallet" },
  { to: "/voorraad", label: "Voorraad", icon: "package" },
  { to: "/kaarten", label: "Kaarten", icon: "card" },
] as const;

const SETTINGS = { to: "/meer", label: "Instellingen", short: "Meer", icon: "sliders" } as const;

export function App() {
  const { data: me } = useApi<Me>("/me");
  const { data: stats, reload: reloadStats } = useApi<Stats>("/stats");
  const online = useOnline();
  const { pathname } = useLocation();
  useIdleReset(isKiosk, KIOSK_IDLE_MS, HOME);

  // Bij elke start de klantenkaarten ophalen, zodat de service worker altijd de recentste versie
  // bewaart, ook als je het kaartenscherm nog niet geopend hebt.
  useEffect(() => {
    api.get("/loyalty-cards").catch(() => {});
  }, []);

  // Nieuw scherm: bovenaan beginnen (op tablet scrollt het paneel, op een gsm het venster),
  // en de tellers in de zijbalk bijwerken.
  const first = useRef(true);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.querySelector("main")?.scrollTo({ top: 0 });
    if (first.current) first.current = false;
    else reloadStats();
  }, [pathname, reloadStats]);

  const active = MENU.findIndex((n) => pathname.startsWith(n.to));
  const tabIndex = pathname.startsWith(SETTINGS.to) ? MENU.length : active;
  const counts: Record<string, { value: number; alert?: boolean } | undefined> = stats
    ? {
        "/aankopen": { value: stats.purchases },
        "/voorraad": stats.low > 0 ? { value: stats.low, alert: true } : { value: stats.items },
        "/kaarten": { value: stats.cards },
      }
    : {};

  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="app">
          <aside className="sidebar" aria-label="Hoofdmenu">
            <div className="workspace">
              <span className="brand-mark">
                <Icon name="home" size={16} />
              </span>
              <span className="nav-text">Thuis</span>
            </div>

            <p className="nav-section">Menu</p>
            <nav className="sidebar-nav">
              <span className="sidebar-indicator" style={{ "--i": Math.max(active, 0), opacity: active < 0 ? 0 : 1 } as CSSProperties} />
              {MENU.map((item) => {
                const count = counts[item.to];
                return (
                  <NavLink key={item.to} to={item.to} title={item.label}>
                    <Icon name={item.icon} />
                    <span className="nav-text">{item.label}</span>
                    {count && count.value > 0 && (
                      <span className={`nav-count ${count.alert ? "warn" : ""}`} title={count.alert ? "Bijna op" : undefined}>
                        {count.value.toLocaleString("nl-BE")}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </nav>

            <div className="sidebar-bottom">
              <NavLink to={SETTINGS.to} title={SETTINGS.label}>
                <Icon name={SETTINGS.icon} />
                <span className="nav-text">{SETTINGS.label}</span>
              </NavLink>
              {me && (
                <div className="user-card" title={me.email}>
                  <Avatar member={me.member} />
                  <span className="who">
                    <strong>{me.member.name}</strong>
                    <small>{isKiosk ? "Kioskmodus" : me.email}</small>
                  </span>
                </div>
              )}
            </div>
          </aside>

          <nav className="tabbar" aria-label="Hoofdmenu">
            <span className="tabbar-indicator" style={{ "--i": Math.max(tabIndex, 0), opacity: tabIndex < 0 ? 0 : 1 } as CSSProperties} />
            {[...MENU, { ...SETTINGS, label: SETTINGS.short }].map((item) => (
              <NavLink key={item.to} to={item.to}>
                <Icon name={item.icon} size={20} />
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
            <Suspense>
              <Routes>
                <Route path="/" element={<Navigate to={HOME} replace />} />
                <Route path="/aankopen" element={<PurchaseList />} />
                <Route path="/aankopen/nieuw" element={<PurchaseFormPage />} />
                <Route path="/aankopen/:id" element={<PurchaseDetail />} />
                <Route path="/aankopen/:id/bewerken" element={<PurchaseFormPage />} />
                <Route path="/uitgaven" element={<ExpensesPage />} />
                <Route path="/voorraad" element={<InventoryList />} />
                <Route path="/voorraad/nieuw" element={<ItemFormPage />} />
                <Route path="/voorraad/:id" element={<ItemDetail />} />
                <Route path="/voorraad/:id/bewerken" element={<ItemFormPage />} />
                <Route path="/meer" element={<SettingsPage />} />
                <Route path="/kaarten" element={<CardList />} />
                <Route path="/kaarten/nieuw" element={<CardFormPage />} />
                <Route path="/kaarten/:id" element={<CardDetail />} />
                <Route path="/kaarten/:id/bewerken" element={<CardFormPage />} />
                <Route path="*" element={<p className="page muted">Deze pagina bestaat niet.</p>} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
