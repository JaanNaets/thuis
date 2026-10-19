import type { LoyaltyCard } from "../shared/types";
import { useApi } from "./api";

/**
 * Alle schermen voor klantenkaarten gebruiken dezelfde lijst. De service worker bewaart die ene aanvraag,
 * zodat elke kaart ook offline te openen is.
 */
export function useCards() {
  return useApi<LoyaltyCard[]>("/loyalty-cards");
}

export function useCard(id: string | undefined) {
  const { data, error, loading } = useCards();
  const card = data?.find((c) => c.id === id);
  return { card, error: error ?? (data && !card ? "Kaart niet gevonden" : undefined), loading };
}
