import "@fontsource-variable/fraunces/soft.css";
import "@fontsource-variable/instrument-sans/wght.css";
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
