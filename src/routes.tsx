import type { RouteObject } from "react-router";
import { App } from "./App";
import { AgendaPage } from "./pages/AgendaPage";
import { EventFormPage } from "./pages/EventForm";
import { EventPage } from "./pages/EventPage";
import { FoodPage } from "./pages/FoodPage";
import { Home } from "./pages/Home";
import { ImportPage } from "./pages/ImportPage";
import { ListNew } from "./pages/ListNew";
import { ListPage } from "./pages/ListPage";
import { ListSettings } from "./pages/ListSettings";
import { MePage } from "./pages/MePage";
import { MoneyPage } from "./pages/MoneyPage";
import { AppPage, SharedPage, StickerPage } from "./pages/QuickLinks";
import { StockPage } from "./pages/StockPage";
import { TagPage } from "./pages/TagPage";
import { ThingFormPage } from "./pages/ThingForm";
import { ThingPage } from "./pages/ThingPage";
import { TodoPage } from "./pages/TodoPage";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <App />,
    HydrateFallback: () => null,
    children: [
      { index: true, element: <Home /> },
      { path: "lijsten/nieuw", element: <ListNew /> },
      { path: "lijsten/:id", element: <ListPage /> },
      { path: "lijsten/:id/instellingen", element: <ListSettings /> },
      { path: "lijsten/:id/nieuw", element: <ThingFormPage /> },
      { path: "lijsten/:id/loggen", element: <EventFormPage /> },
      { path: "lijsten/:id/importeren", element: <ImportPage /> },
      { path: "lijsten/:id/sticker", element: <StickerPage /> },
      { path: "dingen/:thingId", element: <ThingPage /> },
      { path: "dingen/:thingId/bewerken", element: <ThingFormPage /> },
      { path: "gebeurtenissen/:eventId", element: <EventPage /> },
      { path: "gebeurtenissen/:eventId/bewerken", element: <EventFormPage /> },
      { path: "tags/:tagId", element: <TagPage /> },
      { path: "geld", element: <MoneyPage /> },
      { path: "voorraad", element: <StockPage /> },
      { path: "eten", element: <FoodPage /> },
      { path: "te-doen", element: <TodoPage /> },
      { path: "agenda", element: <AgendaPage /> },
      { path: "delen", element: <SharedPage /> },
      { path: "app/:appId", element: <AppPage /> },
      { path: "ik", element: <MePage /> },
      { path: "*", element: <p className="page muted">Deze pagina bestaat niet.</p> },
    ],
  },
];
