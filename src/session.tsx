import { createContext, useContext } from "react";
import type { Me, Stats } from "../shared/types";

/** Wie aangemeld is en de tellers van de zijbalk; één keer opgehaald in App, overal leesbaar. */
export type Session = { me?: Me; stats?: Stats; openSearch: () => void };

export const SessionContext = createContext<Session>({ openSearch: () => {} });

export function useSession(): Session {
  return useContext(SessionContext);
}
