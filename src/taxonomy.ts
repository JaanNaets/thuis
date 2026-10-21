import { useEffect, useSyncExternalStore } from "react";
import { flattenTree, rootOf, type FlatNode } from "../shared/tree";
import type { Category, CategoryDomain, Location, Member, Pot, Taxonomy, Tone } from "../shared/types";
import { api } from "./api";
import { currentHousehold, onHouseholdChange } from "./household";
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

// Ander huishouden gekozen: de oude indeling meteen vergeten en de nieuwe ophalen.
onHouseholdChange(() => {
  snapshot = {};
  inflight = undefined;
  listeners.forEach((l) => l());
  refreshTaxonomy();
});

export function refreshTaxonomy(): Promise<void> {
  const household = currentHousehold();
  const request = (inflight ??= api
    .get<Taxonomy>("/taxonomy")
    .then(
      (data) => {
        // Intussen van huishouden gewisseld? Dan is dit antwoord niet meer van tel.
        if (currentHousehold() === household) snapshot = { data };
      },
      (err: Error) => {
        if (currentHousehold() === household) snapshot = { ...snapshot, error: err.message };
      },
    )
    .finally(() => {
      if (inflight === request) inflight = undefined;
      listeners.forEach((l) => l());
    }));
  return request;
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

/** Wie meedoet in een project. */
export function projectMembers(t: Taxonomy, projectId: string): Member[] {
  const project = t.projects.find((p) => p.id === projectId);
  return project ? t.members.filter((m) => project.member_ids.includes(m.id)) : [];
}

/**
 * Wie mee kan doen in een uitgave en welke potten mogen betalen: in een project de deelnemers en de potten van dat project
 * (plus die van het huishouden voor wie volledige toegang heeft); anders de bewoners en de potten van het huishouden.
 * `used`: leden die er al in staan; die blijven erbij, ook als ze intussen niet meer meedoen.
 */
export function splitCandidates(t: Taxonomy, projectId: string | null, full: boolean, used: string[] = []): { people: Member[]; pots: Pot[] } {
  const base = projectId ? projectMembers(t, projectId) : activeMembers(t);
  const people = [...base, ...t.members.filter((m) => used.includes(m.id) && !base.includes(m))];
  const pots = t.pots.filter((p) => !p.archived && (p.project_id === projectId || (p.project_id === null && (!projectId || full))));
  return { people, pots };
}
