import type { RouteObject } from "react-router";
import { App } from "./App";
import { Home } from "./pages/Home";
import { ImportPage } from "./pages/ImportPage";
import { ItemFormPage } from "./pages/ItemForm";
import { ItemPage } from "./pages/ItemPage";
import { MePage } from "./pages/MePage";
import { ProjectNew } from "./pages/ProjectNew";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectSettings } from "./pages/ProjectSettings";
import { RoleFormPage } from "./pages/RoleForm";
import { TypeFormPage } from "./pages/TypeForm";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <App />,
    HydrateFallback: () => null,
    children: [
      { index: true, element: <Home /> },
      { path: "projecten/nieuw", element: <ProjectNew /> },
      { path: "projecten/:id", element: <ProjectPage /> },
      { path: "projecten/:id/instellingen", element: <ProjectSettings /> },
      { path: "projecten/:id/soorten/nieuw", element: <TypeFormPage /> },
      { path: "projecten/:id/soorten/:typeId", element: <TypeFormPage /> },
      { path: "projecten/:id/rollen/nieuw", element: <RoleFormPage /> },
      { path: "projecten/:id/rollen/:roleId", element: <RoleFormPage /> },
      { path: "projecten/:id/nieuw", element: <ItemFormPage /> },
      { path: "projecten/:id/importeren", element: <ImportPage /> },
      { path: "items/:itemId", element: <ItemPage /> },
      { path: "items/:itemId/bewerken", element: <ItemFormPage /> },
      { path: "ik", element: <MePage /> },
      { path: "*", element: <p className="page muted">Deze pagina bestaat niet.</p> },
    ],
  },
];
