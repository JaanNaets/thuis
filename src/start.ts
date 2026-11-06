// Waar de app opent op dit toestel (Jouw gegevens → App → Openen op): een overzicht (een bord), een lijst of een
// formulier. Per toestel (de keukentablet "Keuken", je gsm "Uitgave toevoegen"), dus in localStorage.
// Enkel bij het openen (de eerste keer "/" in deze sessie), en op de kiosk na een tijd zonder aanraking.

import { cleanDestination, destinationPath, type Destination } from "../shared/apps";

const START_KEY = "thuis.start";
const OPENED_KEY = "thuis.opened";

export function startDestination(): Destination | null {
  try {
    return cleanDestination(JSON.parse(localStorage.getItem(START_KEY) ?? "null"));
  } catch {
    return null;
  }
}

export function setStartDestination(d: Destination | null) {
  try {
    if (d) localStorage.setItem(START_KEY, JSON.stringify(d));
    else localStorage.removeItem(START_KEY);
  } catch {
    // Zonder opslag opent dit toestel gewoon op het overzicht.
  }
}

/** Het pad waar de app opent (zonder keuze: het overzicht). */
export const startPath = () => {
  const d = startDestination();
  return d ? destinationPath(d) : "/";
};

/** Net geopend (de eerste keer "/" in deze sessie)? Dan naar de gekozen pagina; daarna gewoon het overzicht. */
export function openingPath(pathname: string, search: string): string | null {
  try {
    if (sessionStorage.getItem(OPENED_KEY)) return null;
    sessionStorage.setItem(OPENED_KEY, "1");
  } catch {
    return null;
  }
  if (pathname !== "/" || search) return null;
  const path = startPath();
  return path === "/" ? null : path;
}
