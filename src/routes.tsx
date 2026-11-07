import { redirect, type RouteObject } from "react-router";
import { App } from "./App";
import { EventFormPage } from "./pages/EventForm";
import { EventPage } from "./pages/EventPage";
import { Home } from "./pages/Home";
import { ImportPage } from "./pages/ImportPage";
import { ListNew } from "./pages/ListNew";
import { ListPage } from "./pages/ListPage";
import { ListsPage } from "./pages/ListsPage";
import { ListSettings } from "./pages/ListSettings";
import { MePage } from "./pages/MePage";
import { AppPage, SharedPage, StickerPage } from "./pages/QuickLinks";
import { TagPage } from "./pages/TagPage";
import { ThingFormPage } from "./pages/ThingForm";
import { ThingPage } from "./pages/ThingPage";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <App />,
    HydrateFallback: () => null,
    children: [
      { index: true, element: <Home /> },
      { path: "bord/:boardId", element: <Home /> },
      { path: "lijsten", element: <ListsPage /> },
      { path: "lijsten/nieuw", element: <ListNew /> },
      // Verbanden staat nu op Lijsten zelf (Lijst of Kaart); de oude adressen sturen door.
      { path: "lijsten/verbanden", loader: ({ request }) => redirect(`/lijsten${new URL(request.url).search}`) },
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
      { path: "verbanden", loader: ({ request }) => redirect(`/lijsten${new URL(request.url).search}`) },
      { path: "delen", element: <SharedPage /> },
      { path: "app/:appId", element: <AppPage /> },
      { path: "ik", element: <MePage /> },
      { path: "*", element: <p className="page muted">Deze pagina bestaat niet.</p> },
    ],
  },
];
