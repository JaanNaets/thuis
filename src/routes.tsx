import { Navigate, type RouteObject } from "react-router";
import { App, HOME } from "./App";
import { ExpensesPage } from "./pages/ExpensesPage";
import { InventoryList } from "./pages/InventoryList";
import { ItemDetail } from "./pages/ItemDetail";
import { ItemFormPage } from "./pages/ItemForm";
import { PurchaseDetail } from "./pages/PurchaseDetail";
import { PurchaseFormPage } from "./pages/PurchaseForm";
import { PurchaseList } from "./pages/PurchaseList";
import { SettingsPage } from "./pages/SettingsPage";
import { CardList } from "./pages/CardList";

// De barcodebibliotheek is groot (±1 MB); die laden we pas wanneer je een kaart opent.
// De router wacht tot het stuk geladen is, zodat de overgang naar het nieuwe scherm vloeiend blijft.
export const loadCardDetail = () => import("./pages/CardDetail").then((m) => ({ Component: m.CardDetail }));
export const loadCardForm = () => import("./pages/CardForm").then((m) => ({ Component: m.CardFormPage }));

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <App />,
    // Enkel te zien als je rechtstreeks een kaart opent en het stuk nog laadt.
    HydrateFallback: () => null,
    children: [
      { index: true, element: <Navigate to={HOME} replace /> },
      { path: "aankopen", element: <PurchaseList /> },
      { path: "aankopen/nieuw", element: <PurchaseFormPage /> },
      { path: "aankopen/:id", element: <PurchaseDetail /> },
      { path: "aankopen/:id/bewerken", element: <PurchaseFormPage /> },
      { path: "uitgaven", element: <ExpensesPage /> },
      { path: "voorraad", element: <InventoryList /> },
      { path: "voorraad/nieuw", element: <ItemFormPage /> },
      { path: "voorraad/:id", element: <ItemDetail /> },
      { path: "voorraad/:id/bewerken", element: <ItemFormPage /> },
      { path: "meer", element: <SettingsPage /> },
      { path: "kaarten", element: <CardList /> },
      { path: "kaarten/nieuw", lazy: loadCardForm },
      { path: "kaarten/:id", lazy: loadCardDetail },
      { path: "kaarten/:id/bewerken", lazy: loadCardForm },
      { path: "*", element: <p className="page muted">Deze pagina bestaat niet.</p> },
    ],
  },
];
