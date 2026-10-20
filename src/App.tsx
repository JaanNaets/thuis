import { lazy, Suspense, useEffect, type CSSProperties } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router";
import type { Me } from "../shared/types";
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

const NAV = [
  { to: "/aankopen", label: "Aankopen", icon: "receipt" },
  { to: "/uitgaven", label: "Uitgaven", icon: "wallet" },
  { to: "/voorraad", label: "Voorraad", icon: "package" },
  { to: "/kaarten", label: "Kaarten", icon: "card" },
  { to: "/meer", label: "Meer", icon: "sliders" },
] as const;

export function App() {
  const { data: me } = useApi<Me>("/me");
  const online = useOnline();
  const { pathname } = useLocation();
  useIdleReset(isKiosk, KIOSK_IDLE_MS, HOME);

  // Bij elke start de klantenkaarten ophalen, zodat de service worker altijd de recentste versie
  // bewaart, ook als je het kaartenscherm nog niet geopend hebt.
  useEffect(() => {
    api.get("/loyalty-cards").catch(() => {});
  }, []);

  // Nieuw scherm: bovenaan beginnen.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  const active = NAV.findIndex((n) => pathname.startsWith(n.to));
  const indicator = { "--i": Math.max(active, 0), opacity: active < 0 ? 0 : 1 } as CSSProperties;

  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="app">
          <aside className="sidebar" aria-label="Hoofdmenu">
            <div className="brand">
              <span className="brand-mark">
                <Icon name="home" size={18} />
              </span>
              <span className="nav-text">Thuis</span>
            </div>
            <nav className="sidebar-nav">
              <span className="sidebar-indicator" style={indicator} />
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} title={item.label}>
                  <Icon name={item.icon} />
                  <span className="nav-text">{item.label}</span>
                </NavLink>
              ))}
            </nav>
            {me && (
              <div className="sidebar-foot" title={me.email}>
                <Avatar member={me.member} />
                <span className="nav-text">{isKiosk ? "Kioskmodus" : me.email}</span>
              </div>
            )}
          </aside>

          <nav className="tabbar" aria-label="Hoofdmenu">
            <span className="tabbar-indicator" style={indicator} />
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to}>
                <Icon name={item.icon} size={20} />
                <span>{item.label}</span>
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
