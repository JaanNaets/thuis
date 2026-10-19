import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

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

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service worker niet geregistreerd", err));
  });
}

export function greeting(now = new Date()): string {
  const hour = now.getHours();
  const part = hour < 6 ? "Goeienacht" : hour < 12 ? "Goeiemorgen" : hour < 18 ? "Goeiemiddag" : "Goeieavond";
  const date = new Intl.DateTimeFormat("nl-BE", { weekday: "long", day: "numeric", month: "long" }).format(now);
  return `${part} · ${date}`;
}
