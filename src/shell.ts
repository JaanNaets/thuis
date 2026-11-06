// De + in de onderbalk (gsm): een scherm zegt wat die doet (een lijst: iets toevoegen of loggen); zonder opent hij het
// palet om toe te voegen.

import { createContext, use, useEffect, useRef } from "react";

export type AddAction = { label: string; to?: string; onClick?: () => void };

export const AddContext = createContext<(action: AddAction | null) => void>(() => {});

/** Wat de + doet zolang dit scherm open is (null: de gewone +). */
export function useAddAction(action: AddAction | null) {
  const set = use(AddContext);
  const click = useRef(action?.onClick);
  click.current = action?.onClick;
  const label = action?.label;
  const to = action?.to;
  const has = action !== null;
  const hasClick = action?.onClick !== undefined;
  useEffect(() => {
    if (!has || label === undefined) return;
    set({ label, to, onClick: hasClick ? () => click.current?.() : undefined });
    return () => set(null);
  }, [set, has, label, to, hasClick]);
}

/** Hetzelfde als onderdeel, voor een scherm dat pas na het laden weet wat de + doet. */
export function PhoneAdd(action: AddAction) {
  useAddAction(action);
  return null;
}
