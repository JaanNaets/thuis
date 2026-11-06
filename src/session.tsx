import { createContext, useContext } from "react";
import type { ListNode, Tag } from "../shared/model";
import type { Person } from "../shared/types";

/**
 * Wie aangemeld is, al je lijsten (met je rol, tags en volgorde) en de tags die je ziet. Eén keer opgehaald in App,
 * overal leesbaar. Na het maken, hernoemen of verwijderen van een lijst of tag: `reloadMe()`.
 */
export type Session = {
  person: Person;
  lists: ListNode[];
  tags: Tag[];
  /** Mag de AI voor jou lezen (Jouw gegevens → AI)? Uit: geen ✨-knoppen (de server weigert dan ook). */
  ai: boolean;
  reloadMe: () => void;
  openSearch: () => void;
};

export const SessionContext = createContext<Session>({
  person: { id: "", name: "", email: null, color: null },
  lists: [],
  tags: [],
  ai: false,
  reloadMe: () => {},
  openSearch: () => {},
});

export function useSession(): Session {
  return useContext(SessionContext);
}

/** Het antwoord van GET /me. */
export type Me = { person: Person; lists: ListNode[]; tags: Tag[]; ai: boolean };
