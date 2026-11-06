import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate } from "./router";

const KIOSK_KEY = "huishouden:kiosk";

/**
 * Kioskmodus zet je per toestel aan door één keer /?kiosk=1 te openen (en uit met /?kiosk=0).
 * De keuze wordt op dat toestel onthouden.
 */
function readKioskMode(): boolean {
  const param = new URLSearchParams(location.search).get("kiosk");
  try {
    if (param === "1") localStorage.setItem(KIOSK_KEY, "1");
    if (param === "0") localStorage.removeItem(KIOSK_KEY);
    return localStorage.getItem(KIOSK_KEY) === "1";
  } catch {
    return param === "1";
  }
}

export const isKiosk = readKioskMode();

/**
 * Een toestel met een vinger als aanwijzer (gsm, tablet). Daar opent een knop die enkel foto's aanvaardt de fotokiezer
 * van het toestel (met je albums, ook uit Google Foto's); laat ze ook een PDF toe, dan krijg je enkel Camera en
 * Bestanden.
 */
export const isTouch = (): boolean => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** Breed genoeg voor de schil van een tablet (vanaf 768px, zoals in styles.css); volgt het als het scherm draait. */
export function useWide(): boolean {
  return useSyncExternalStore(
    (change) => {
      if (typeof matchMedia !== "function") return () => {};
      const query = matchMedia("(min-width: 768px)");
      query.addEventListener("change", change);
      return () => query.removeEventListener("change", change);
    },
    () => typeof matchMedia === "function" && matchMedia("(min-width: 768px)").matches,
    () => true,
  );
}

/** Event waarop useApi opnieuw ophaalt; de kiosk vuurt het af wanneer niemand de tablet gebruikt. */
export const REFRESH_EVENT = "huishouden:refresh";

/**
 * Op de kiosk: na een tijd zonder aanraking terug naar het startscherm en de gegevens verversen,
 * zodat de tablet nooit halverwege een formulier of op andermans kaart blijft hangen.
 */
export function useIdleReset(enabled: boolean, ms: number, home: string) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!enabled) return;
    let timer: number;
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        navigate(home, { replace: true });
        window.dispatchEvent(new Event(REFRESH_EVENT));
        reset();
      }, ms);
    };
    const events = ["pointerdown", "keydown", "wheel", "touchmove"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [enabled, ms, home, navigate]);
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Het event van Chrome en Edge (ook op Android) om de app te installeren; TypeScript kent het niet. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
}

let installPrompt: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();
const installChanged = () => installListeners.forEach((listener) => listener());

// Zo vroeg mogelijk opvangen: de browser vuurt het af kort na het laden, vaak voor er een scherm staat.
// preventDefault houdt de eigen balk van de browser weg; installeren gaat via de knop (of het menu van de browser).
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e as InstallPromptEvent;
  installChanged();
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installChanged();
});

function subscribeInstall(listener: () => void) {
  installListeners.add(listener);
  return () => {
    installListeners.delete(listener);
  };
}

/**
 * Kan deze browser de app installeren? Enkel waar de browser dat aanbiedt (Chrome, Edge, Android), niet als de
 * app al geïnstalleerd is of als app draait. Op een iPhone kan het niet: daar zet je ze via Deel op je beginscherm.
 */
export function useInstall(): { canInstall: boolean; install: () => Promise<void> } {
  const prompt = useSyncExternalStore(subscribeInstall, () => installPrompt);
  const standalone = matchMedia("(display-mode: standalone)").matches;

  async function install() {
    const event = installPrompt;
    if (!event) return;
    // Een prompt werkt maar één keer; de browser biedt het later opnieuw aan als je weigerde.
    installPrompt = null;
    installChanged();
    await event.prompt();
  }

  return { canInstall: Boolean(prompt) && !standalone, install };
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service worker niet geregistreerd", err));
  });
}
