import { createContext, useContext } from "react";
import type { BoardInfo } from "../shared/board";
import type { ListNode, Tag } from "../shared/model";
import type { Person } from "../shared/types";

/**
 * Wie aangemeld is, al je lijsten (met je rol, tags en volgorde), de tags die je ziet en je borden (het menu). Eén keer
 * opgehaald in App, overal leesbaar. Na het maken, hernoemen of verwijderen van een lijst, tag of bord: `reloadMe()`.
 */
export type Session = {
  person: Person;
  lists: ListNode[];
  tags: Tag[];
  /** Je borden (overzichten), in je volgorde: het eerste is je beginscherm. */
  boards: BoardInfo[];
  /** Mag de AI voor jou lezen (Jouw gegevens → AI)? Uit: geen ✨-knoppen (de server weigert dan ook). */
  ai: boolean;
  reloadMe: () => void;
  openSearch: () => void;
};

export const SessionContext = createContext<Session>({
  person: { id: "", name: "", email: null, color: null },
  lists: [],
  tags: [],
  boards: [],
  ai: false,
  reloadMe: () => {},
  openSearch: () => {},
});

export function useSession(): Session {
  return useContext(SessionContext);
}

/** Het antwoord van GET /me. */
export type Me = { person: Person; lists: ListNode[]; tags: Tag[]; ai: boolean; boards?: BoardInfo[] };
