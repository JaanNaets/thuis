// Gedeelde types tussen de Worker (API) en de React-app.

import type { Access, Rights } from "./access";
import type { Attributes, FieldDef } from "./fields";
import type { IconKey } from "./templates";

/** Pastelkleuren voor personen, projecten en tags. */
export const TONES = ["peach", "butter", "sage", "mint", "sky", "lilac", "rose"] as const;
export type Tone = (typeof TONES)[number];

export function isTone(value: unknown): value is Tone {
  return typeof value === "string" && (TONES as readonly string[]).includes(value);
}

// ---------- personen ----------

export type Person = {
  id: string;
  name: string;
  /** Leeg = meldt (nog) niet aan. */
  email: string | null;
  color: Tone | null;
};

// ---------- projecten ----------

export type Project = {
  id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  icon: IconKey | null;
  color: Tone | null;
  sort_order: number;
  archived: 0 | 1;
  created_at: string;
};

/** Een project in je boom, met wat jij er mag. */
export type ProjectNode = Project & {
  role_id: string;
  role_name: string;
  rights: Rights;
  /** De rol komt van een project erboven. */
  inherited: boolean;
};

export type Me = { person: Person; projects: ProjectNode[] };

export type ProjectInput = {
  name: string;
  description: string | null;
  icon: IconKey | null;
  color: Tone | null;
  parent_id: string | null;
};

/** Een nieuw project kan uit een sjabloon komen. */
export type NewProjectInput = ProjectInput & { template: string | null };

export type Role = { id: string; project_id: string; name: string; rights: Rights; sort_order: number; member_count: number };
export type RoleInput = { name: string; rights: Rights };

/** Iemand in een project: met een eigen rol hier, of een rol van een project erboven. */
export type Member = {
  person: Person;
  role_id: string;
  /** Waar de rol vandaan komt. */
  project_id: string;
  inherited: boolean;
};

export type MemberInput = {
  /** Een bestaande persoon, of een nieuwe met naam (en e-mailadres om zelf aan te melden). */
  person_id: string | null;
  name: string | null;
  email: string | null;
  role_id: string;
};

// ---------- soorten, tags en items ----------

export type ItemType = {
  id: string;
  project_id: string;
  name: string;
  plural: string;
  name_label: string | null;
  icon: IconKey | null;
  fields: FieldDef[];
  sort_order: number;
};

/** Een soort zoals jij ze ziet: enkel de velden die je mag zien, en wat je per veld mag. */
export type ItemTypeView = ItemType & { access: Access; field_access: Record<string, Access>; can_create: boolean; can_delete: boolean };

export type ItemTypeInput = { name: string; plural: string; name_label: string | null; icon: IconKey | null; fields: FieldDef[] };

export type Tag = { id: string; project_id: string; name: string; color: Tone | null };

export type ProjectDetail = {
  project: ProjectNode;
  /** De projecten erboven die je mag zien (van boven naar onder). */
  path: { id: string; name: string }[];
  children: (ProjectNode & { item_count: number })[];
  /** Soorten van dit project en erboven, die je mag zien. */
  types: ItemTypeView[];
  tags: Tag[];
  /** Rollen van dit project en erboven. */
  roles: Role[];
  members: Member[];
  /** Aantal items per soort in dit project. */
  counts: Record<string, number>;
};

export type Item = {
  id: string;
  project_id: string;
  type_id: string;
  name: string;
  data: Attributes;
  tag_ids: string[];
  photo_version: number | null;
  archived: 0 | 1;
  created_by: string;
  created_at: string;
  updated_at: string;
};

/** Een lijst items, met de namen waarnaar ze verwijzen (personen, andere items). */
export type ItemList = { items: Item[]; people: Person[]; refs: ItemRef[] };

export type ItemRef = { id: string; name: string; type_id: string; project_id: string };

export type ItemFile = { id: string; item_id: string; filename: string; content_type: string; size_bytes: number; created_at: string };

export type LogEntry = {
  id: string;
  item_id: string;
  happened_on: string;
  text: string;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
};

export type ItemDetail = Item & {
  files: ItemFile[];
  log: LogEntry[];
  people: Person[];
  refs: ItemRef[];
  /** Items die naar dit item verwijzen (de wijnen van een verkoper). */
  backlinks: (ItemRef & { field_label: string })[];
  access: Access;
  field_access: Record<string, Access>;
  can_delete: boolean;
};

export type ItemInput = { type_id: string; name: string; data: Record<string, unknown>; tag_ids: string[] };

export type ImportResult = { created: number; skipped: { row: number; error: string }[] };

/** Wat de app van een etiket of foto las, in de velden van de soort. */
export type LabelScan = { name: string | null; data: Attributes; message?: string };

export type SearchResult = {
  projects: { id: string; name: string; icon: IconKey | null; color: Tone | null }[];
  items: (ItemRef & { project_name: string; type_name: string; icon: IconKey | null })[];
};
