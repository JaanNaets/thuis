import { createContext, useContext } from "react";
import type { HouseholdAccess, Stats } from "../shared/types";

/**
 * Wie aangemeld is, in welk huishouden, en de tellers van de zijbalk. Eén keer opgehaald in App, overal leesbaar.
 * `full` = volledige toegang tot het huishouden; zonder is het een gast die enkel zijn projecten ziet.
 */
export type Session = {
  email?: string;
  households: HouseholdAccess[];
  /** Het gekozen huishouden, met jouw lidmaatschap daarin. */
  membership?: HouseholdAccess;
  full: boolean;
  stats?: Stats;
  openSearch: () => void;
  switchHousehold: (id: string) => void;
  /** Na het aanmaken of hernoemen van een huishouden. */
  reloadMe: () => void;
};

export const SessionContext = createContext<Session>({
  households: [],
  full: false,
  openSearch: () => {},
  switchHousehold: () => {},
  reloadMe: () => {},
});

export function useSession(): Session {
  return useContext(SessionContext);
}
