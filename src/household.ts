import { useSyncExternalStore } from "react";
import { REFRESH_EVENT } from "./device";

/**
 * Het gekozen huishouden. Elke aanvraag naar de API krijgt het mee als ?hh= (zie api.ts), zodat ook
 * afbeeldingen en de offline kopie van de klantenkaarten per huishouden kloppen.
 */
const KEY = "thuis:household";

let current: string | null = (() => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
})();

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentHousehold(): string | null {
  return current;
}

/** Wisselt van huishouden: alles wordt opnieuw opgehaald. */
export function setCurrentHousehold(id: string) {
  if (id === current) return;
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Privévenster: dan onthouden we het enkel zolang de app open is.
  }
  listeners.forEach((l) => l());
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export function useCurrentHousehold(): string | null {
  return useSyncExternalStore(subscribe, () => current);
}

export function onHouseholdChange(listener: () => void): () => void {
  return subscribe(listener);
}

/** Zet ?hh=<huishouden> achter een API-pad. */
export function withHousehold(path: string): string {
  if (!current) return path;
  return `${path}${path.includes("?") ? "&" : "?"}hh=${encodeURIComponent(current)}`;
}
