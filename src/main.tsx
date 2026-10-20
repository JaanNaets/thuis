import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/geist-mono/wght.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { isKiosk, registerServiceWorker } from "./device";
import { routes } from "./routes";
import "./styles.css";

if (isKiosk) document.documentElement.dataset.kiosk = "";
registerServiceWorker();

// Een data-router: enkel die kan schermwissels in een View Transition gieten (zie src/router.tsx).
const router = createBrowserRouter(routes);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
