import { useEffect, useSyncExternalStore } from "react";
import { flattenTree, rootOf, type FlatNode } from "../shared/tree";
import type { Category, CategoryDomain, Location, Member, Taxonomy, Tone } from "../shared/types";
import { api } from "./api";
import { toneForCategory } from "./components/Page";

/**
 * Leden, categorieën, plaatsen en tags: bijna elk scherm heeft ze nodig.
 * Eén gedeelde kopie, die bij elk nieuw scherm op de achtergrond ververst wordt.
 */
let snapshot: { data?: Taxonomy; error?: string } = {};
let inflight: Promise<void> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function refreshTaxonomy(): Promise<void> {
  inflight ??= api
    .get<Taxonomy>("/taxonomy")
    .then(
      (data) => {
        snapshot = { data };
      },
      (err: Error) => {
        snapshot = { ...snapshot, error: err.message };
      },
    )
    .finally(() => {
      inflight = undefined;
      listeners.forEach((l) => l());
    });
  return inflight;
}

export function useTaxonomy() {
  const state = useSyncExternalStore(subscribe, () => snapshot);
  useEffect(() => {
    refreshTaxonomy();
  }, []);
  return state;
}

// ---------- hulpjes ----------

export function categoryTree(t: Taxonomy, domain: CategoryDomain): FlatNode<Category>[] {
  return flattenTree(t.categories.filter((c) => c.domain === domain));
}

export function locationTree(t: Taxonomy): FlatNode<Location>[] {
  return flattenTree(t.locations);
}

/** Subcategorieën nemen de kleur van hun hoofdcategorie over. */
export function categoryTone(t: Taxonomy | undefined, id: string | null): Tone {
  if (!t || !id) return toneForCategory(null);
  const root = rootOf(t.categories, id);
  return root?.color ?? toneForCategory(root?.name ?? null);
}

export function memberById(t: Taxonomy | undefined, id: string | null): Member | undefined {
  return id ? t?.members.find((m) => m.id === id) : undefined;
}

/** created_by is een e-mailadres; toon de naam als we die persoon kennen. */
export function nameForEmail(t: Taxonomy | undefined, email: string): string {
  return t?.members.find((m) => m.email?.toLowerCase() === email.toLowerCase())?.name ?? email;
}

export function activeMembers(t: Taxonomy): Member[] {
  return t.members.filter((m) => m.active === 1);
}

export function placeName(t: Taxonomy | undefined, id: string | null): string | null {
  if (!t || !id) return null;
  return flattenTree(t.locations).find((l) => l.id === id)?.path ?? null;
}
