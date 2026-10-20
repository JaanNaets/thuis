import { lazy, Suspense, useEffect } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router";
import { api, useApi } from "./api";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { Icon } from "./components/Icon";
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

const NAV = [
  { to: "/aankopen", label: "Aankopen", icon: "receipt", tone: "peach" },
  { to: "/uitgaven", label: "Uitgaven", icon: "wallet", tone: "sage" },
  { to: "/voorraad", label: "Voorraad", icon: "package", tone: "sky" },
  { to: "/kaarten", label: "Kaarten", icon: "card", tone: "lilac" },
  { to: "/meer", label: "Meer", icon: "sliders", tone: "butter" },
] as const;
const KIOSK_IDLE_MS = 5 * 60 * 1000;

export function App() {
  const { data: me } = useApi<{ email: string }>("/me");
  const online = useOnline();
  useIdleReset(isKiosk, KIOSK_IDLE_MS, HOME);

  // Bij elke start de klantenkaarten ophalen, zodat de service worker altijd de recentste versie
  // bewaart, ook als je het kaartenscherm nog niet geopend hebt.
  useEffect(() => {
    api.get("/loyalty-cards").catch(() => {});
  }, []);

  return (
    <ConfirmProvider>
      <div className="app">
        <nav className="nav" aria-label="Hoofdmenu">
          <span className="nav-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path d="M12 3.2 3.5 10v9.3c0 .9.7 1.7 1.7 1.7H9.6v-5.6h4.8V21h4.4c1 0 1.7-.8 1.7-1.7V10Z" fill="currentColor" />
            </svg>
          </span>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={`nav-item tone-${item.tone}`}>
              <Icon name={item.icon} size={22} />
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
              <Route path="*" element={<p className="page empty">Deze pagina bestaat niet.</p>} />
            </Routes>
          </Suspense>
          {me && !isKiosk && <p className="signed-in">Aangemeld als {me.email}</p>}
        </main>
      </div>
    </ConfirmProvider>
  );
}
