import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/geist-mono/wght.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { isKiosk, registerServiceWorker } from "./device";
import "./styles.css";

if (isKiosk) document.documentElement.dataset.kiosk = "";
registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
