import { createContext, useContext } from "react";
import type { Person, ProjectNode } from "../shared/types";

/**
 * Wie aangemeld is en al zijn projecten (met zijn rol in elk). Eén keer opgehaald in App, overal leesbaar.
 * Na het aanmaken, hernoemen of verwijderen van een project: `reloadMe()`.
 */
export type Session = {
  person: Person;
  projects: ProjectNode[];
  /** Mag de AI voor jou lezen (Jouw gegevens → AI)? Uit: geen ✨-knoppen (de server weigert dan ook). */
  ai: boolean;
  reloadMe: () => void;
  openSearch: () => void;
};

export const SessionContext = createContext<Session>({
  person: { id: "", name: "", email: null, color: null },
  projects: [],
  ai: false,
  reloadMe: () => {},
  openSearch: () => {},
});

export function useSession(): Session {
  return useContext(SessionContext);
}
