// Rechten: wat iemand met een bepaalde rol in een project mag.
//
// - Een rol hoort bij een project en geldt ook in de subprojecten. Wie in een subproject een eigen rol heeft,
//   krijgt daar die rol (de dichtste wint).
// - Wat je met het project zelf mag: instellen (naam, subprojecten, lijsten en velden, tags, rollen), mensen
//   beheren, items toevoegen en items verwijderen.
// - Per lijst en per veld: niet zien, zien of wijzigen. Zonder uitzondering geldt de standaard (`items`).
//   Wie een lijst niet mag zien, ziet de items van die lijst niet.

import type { FieldDef, Attributes } from "./fields";

export const ACCESS_LEVELS = {
  none: { label: "Niet zien" },
  view: { label: "Zien" },
  edit: { label: "Wijzigen" },
} as const;
export type Access = keyof typeof ACCESS_LEVELS;

export function isAccess(value: unknown): value is Access {
  return typeof value === "string" && Object.hasOwn(ACCESS_LEVELS, value);
}

export type TypeRights = { access?: Access; fields?: Record<string, Access> };

export type Rights = {
  manage: boolean;
  members: boolean;
  create: boolean;
  delete: boolean;
  /** Standaard voor elke lijst en elk veld. */
  items: Access;
  /** Uitzonderingen per lijst (id), en daarin per veld (sleutel). */
  types: Record<string, TypeRights>;
};

export const PROJECT_RIGHTS = {
  manage: { label: "Project instellen", hint: "Naam, subprojecten, lijsten en velden, tags en rollen" },
  members: { label: "Mensen beheren", hint: "Iemand toevoegen, een rol geven of weghalen" },
  create: { label: "Items toevoegen" },
  delete: { label: "Items verwijderen" },
} as const satisfies Record<string, { label: string; hint?: string }>;
export type ProjectRight = keyof typeof PROJECT_RIGHTS;

export const NO_RIGHTS: Rights = { manage: false, members: false, create: false, delete: false, items: "none", types: {} };

/** De rollen waarmee elk nieuw project (bovenaan) begint. */
export const DEFAULT_ROLES: { key: string; name: string; rights: Rights }[] = [
  { key: "admin", name: "Beheerder", rights: { manage: true, members: true, create: true, delete: true, items: "edit", types: {} } },
  { key: "member", name: "Lid", rights: { manage: false, members: false, create: true, delete: true, items: "edit", types: {} } },
  { key: "viewer", name: "Lezer", rights: { manage: false, members: false, create: false, delete: false, items: "view", types: {} } },
];

/** Wat je met de items van een lijst mag (de naam, tags, foto, bestanden, logboek). */
export function typeAccess(rights: Rights, typeId: string): Access {
  return rights.types[typeId]?.access ?? rights.items;
}

/** Wat je met één veld mag. Wie de lijst niet ziet, ziet ook geen enkel veld. */
export function fieldAccess(rights: Rights, typeId: string, key: string): Access {
  const base = typeAccess(rights, typeId);
  if (base === "none") return "none";
  return rights.types[typeId]?.fields?.[key] ?? base;
}

export const canSeeType = (rights: Rights, typeId: string) => typeAccess(rights, typeId) !== "none";
export const canEditType = (rights: Rights, typeId: string) => typeAccess(rights, typeId) === "edit";
export const canCreate = (rights: Rights, typeId: string) => rights.create && canEditType(rights, typeId);
export const canDelete = (rights: Rights, typeId: string) => rights.delete && canEditType(rights, typeId);

/** Per veld wat je mag (voor de app). */
export function fieldAccessMap(rights: Rights, typeId: string, fields: FieldDef[]): Record<string, Access> {
  return Object.fromEntries(fields.map((f) => [f.key, fieldAccess(rights, typeId, f.key)]));
}

/** Enkel de velden die je mag zien. */
export function visibleFields(rights: Rights, typeId: string, fields: FieldDef[]): FieldDef[] {
  return fields.filter((f) => fieldAccess(rights, typeId, f.key) !== "none");
}

/** Enkel de waarden die je mag zien. */
export function visibleData(rights: Rights, typeId: string, fields: FieldDef[], data: Attributes): Attributes {
  const out: Attributes = {};
  for (const f of fields) if (f.key in data && fieldAccess(rights, typeId, f.key) !== "none") out[f.key] = data[f.key];
  return out;
}

/**
 * Bij bewaren: de velden die je mag wijzigen komen uit wat je stuurde, al de rest blijft zoals het was.
 * Zo kan niemand een veld aanpassen of wissen dat die niet mag wijzigen, ook niet door het weg te laten.
 */
export function mergeEditable(rights: Rights, typeId: string, fields: FieldDef[], existing: Attributes, incoming: Attributes): Attributes {
  const out: Attributes = {};
  for (const f of fields) {
    const value = fieldAccess(rights, typeId, f.key) === "edit" ? incoming[f.key] : existing[f.key];
    if (value !== undefined) out[f.key] = value;
  }
  return out;
}

/** Rechten nakijken (wat de app stuurde). Onbekende sleutels vallen weg. */
export function cleanRights(raw: unknown): Rights {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const types: Record<string, TypeRights> = {};
  const rawTypes = r.types && typeof r.types === "object" ? (r.types as Record<string, unknown>) : {};
  for (const [typeId, value] of Object.entries(rawTypes).slice(0, 200)) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(typeId) || !value || typeof value !== "object") continue;
    const t = value as Record<string, unknown>;
    const entry: TypeRights = {};
    if (isAccess(t.access)) entry.access = t.access;
    const fields = t.fields && typeof t.fields === "object" ? (t.fields as Record<string, unknown>) : {};
    const cleanFields = Object.fromEntries(
      Object.entries(fields)
        .filter(([k, v]) => /^[a-z][a-z0-9_]{0,39}$/.test(k) && isAccess(v))
        .slice(0, 60),
    ) as Record<string, Access>;
    if (Object.keys(cleanFields).length) entry.fields = cleanFields;
    if (entry.access || entry.fields) types[typeId] = entry;
  }
  return {
    manage: r.manage === true,
    members: r.members === true,
    create: r.create === true,
    delete: r.delete === true,
    items: isAccess(r.items) ? r.items : "view",
    types,
  };
}

/** Korte omschrijving van een rol: "Alles", "Toevoegen en wijzigen", "Enkel zien", … */
export function rightsSummary(rights: Rights): string {
  const parts: string[] = [];
  if (rights.manage && rights.members) parts.push("beheert alles");
  else {
    if (rights.manage) parts.push("stelt in");
    if (rights.members) parts.push("beheert mensen");
  }
  if (rights.create) parts.push("voegt toe");
  if (rights.delete) parts.push("verwijdert");
  parts.push(rights.items === "edit" ? "wijzigt" : rights.items === "view" ? "ziet" : "ziet niets");
  const exceptions = Object.keys(rights.types).length;
  const text = parts.join(", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${exceptions ? ` · ${exceptions} ${exceptions === 1 ? "uitzondering" : "uitzonderingen"}` : ""}`;
}
