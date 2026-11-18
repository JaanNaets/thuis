import { redirect, type RouteObject } from "react-router";
import { App } from "./App";
import { EventFormPage } from "./pages/EventForm";
import { EventPage } from "./pages/EventPage";
import { FormPage } from "./pages/FormPage";
import { FormNew, FormSettings } from "./pages/FormSettings";
import { Home } from "./pages/Home";
import { FromListPage } from "./pages/FromListPage";
import { ImportPage } from "./pages/ImportPage";
import { ListNew } from "./pages/ListNew";
import { ListPage } from "./pages/ListPage";
import { ListsPage } from "./pages/ListsPage";
import { ListSettings } from "./pages/ListSettings";
import { MePage } from "./pages/MePage";
import { AppPage, SharedPage, StickerPage } from "./pages/QuickLinks";
import { TagPage } from "./pages/TagPage";
import { ItemFormPage } from "./pages/ItemForm";
import { ItemPage } from "./pages/ItemPage";

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
      { path: "lijsten/:id/nieuw", element: <ItemFormPage /> },
      // Loggen hoort bij een formulier, niet meer bij een lijst: het oude adres stuurt door (`soort` → `formulier`, de
      // lijst als waar je vandaan komt).
      {
        path: "lijsten/:id/loggen",
        loader: ({ params, request }) => {
          const q = new URL(request.url).searchParams;
          const soort = q.get("soort");
          q.delete("soort");
          if (soort) q.set("formulier", soort);
          if (!q.has("nieuw")) q.set("nieuw", params.id!);
          return redirect(`/loggen?${q}`);
        },
      },
      { path: "loggen", element: <EventFormPage /> },
      { path: "formulieren/nieuw", element: <FormNew /> },
      { path: "formulieren/:id", element: <FormPage /> },
      { path: "formulieren/:id/instellingen", element: <FormSettings /> },
      { path: "lijsten/:id/importeren", element: <ImportPage /> },
      { path: "lijsten/:id/uit-lijst", element: <FromListPage /> },
      { path: "lijsten/:id/sticker", element: <StickerPage /> },
      { path: "items/:itemId", element: <ItemPage /> },
      { path: "items/:itemId/bewerken", element: <ItemFormPage /> },
      // Vroeger heetten items "dingen" (oude links en meldingen).
      { path: "dingen/:itemId/*", loader: ({ params, request }) => redirect(`/items/${params.itemId}${params["*"] ? `/${params["*"]}` : ""}${new URL(request.url).search}`) },
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
