// Een back-up van de projecten die je helemaal beheert (zie worker/routes/backup.ts): alles wat in de databank staat
// en dat jij ziet, als één JSON-bestand. Foto's en bestanden staan in R2; het bestand noemt ze, en terugzetten kopieert
// ze zolang het origineel er nog staat en jij het mag zien. Wat een item aan andere deed (`items.applied`) gaat nooit
// mee: terugzetten rekent dat opnieuw uit.
//
// Terugzetten maakt altijd een nieuwe kopie met nieuwe ids, en overschrijft nooit iets. Elke id in het bestand is een
// UUID: wie naar wat verwijst (een veld naar een lijst, een item naar een ander item, een weergave naar een tag, een
// totaal naar een lijst elders, ...) vertaalt `remap` in één keer, waar de id ook staat. Een verwijzing naar iets dat
// niet in de back-up zit (een lijst in een ander project), blijft zoals ze was.

export const BACKUP_KIND = "thuis-backup";
export const BACKUP_VERSION = 1;
/** Zo groot mag een back-up zijn om terug te zetten. */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
/** Zoveel projecten en items zet je in één keer terug. */
export const MAX_BACKUP_PROJECTS = 200;
export const MAX_BACKUP_ITEMS = 10000;

export type BackupPerson = {
  id: string;
  name: string;
  email: string | null;
  color: string | null;
};
export type BackupProject = {
  id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  sort_order: number;
  archived: number;
};
export type BackupRole = {
  id: string;
  project_id: string;
  name: string;
  rights: unknown;
  sort_order: number;
};
export type BackupMembership = {
  project_id: string;
  person_id: string;
  role_id: string;
  sort_order: number;
};
export type BackupType = {
  id: string;
  project_id: string;
  name: string;
  plural: string;
  name_label: string | null;
  icon: string | null;
  fields: unknown;
  totals: unknown;
  sort_order: number;
};
export type BackupTag = {
  id: string;
  project_id: string;
  name: string;
  color: string | null;
};
export type BackupItem = {
  id: string;
  project_id: string;
  type_id: string;
  name: string;
  data: unknown;
  archived: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  /** Er staat een foto in R2 (items/<id>/photo). */
  photo: boolean;
};
export type BackupLog = {
  id: string;
  item_id: string;
  happened_on: string;
  text: string;
  created_by: string;
  created_at: string;
};
export type BackupRepeat = {
  item_id: string;
  every_n: number;
  every_unit: string;
  next_on: string;
  created_by: string;
};
export type BackupView = {
  id: string;
  project_id: string;
  type_id: string;
  person_id: string | null;
  name: string;
  def: unknown;
  sort_order: number;
};
export type BackupFile = {
  id: string;
  item_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_by: string;
};

export type Backup = {
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  created_at: string;
  people: BackupPerson[];
  projects: BackupProject[];
  roles: BackupRole[];
  memberships: BackupMembership[];
  types: BackupType[];
  tags: BackupTag[];
  items: BackupItem[];
  log: BackupLog[];
  repeats: BackupRepeat[];
  views: BackupView[];
  shown: { project_id: string; type_id: string }[];
  files: BackupFile[];
};

/**
 * Elke tabel in de databank, en of ze in de back-up zit. Een nieuwe tabel moet hier bij (test/backup.test.ts leest de
 * migraties na): neem ze mee in de back-up en het terugzetten, of zeg waarom niet.
 */
export const BACKUP_TABLES = {
  people: "mensen in je projecten (naam, e-mailadres, kleur; geen rekeningnummer of overzicht)",
  projects: true,
  roles: true,
  memberships: true,
  item_types: true,
  tags: true,
  items: "zonder applied (wordt opnieuw uitgerekend)",
  item_tags: true,
  item_log: true,
  repeats: true,
  views: "gedeelde en je eigen",
  shown_lists: true,
  item_files: "de bestanden zelf staan in R2",
  ai_usage: false,
  ai_usage_people: false,
  products: false,
  settings: false,
  push_subscriptions: false,
} as const;

const ARRAYS = ["people", "projects", "roles", "memberships", "types", "tags", "items", "log", "repeats", "views", "shown", "files"] as const;
const ID = /^[A-Za-z0-9-]{1,64}$/;

/** Is dit een back-up van Thuis? Gooit een fout met uitleg als het niet klopt. */
export function parseBackup(raw: unknown): Backup {
  const b = raw as Partial<Backup> | null;
  if (!b || typeof b !== "object" || b.kind !== BACKUP_KIND) throw new Error("Dit is geen back-up van Thuis.");
  if (b.version !== BACKUP_VERSION) throw new Error("Deze back-up is van een andere versie van Thuis.");
  for (const key of ARRAYS) if (!Array.isArray(b[key])) throw new Error("Deze back-up is onvolledig.");
  const ids = (list: { id?: unknown }[]) => list.every((x) => typeof x?.id === "string" && ID.test(x.id));
  if (![b.projects!, b.types!, b.items!, b.roles!, b.people!, b.tags!].every(ids)) throw new Error("Deze back-up is beschadigd.");
  const projects = new Set(b.projects!.map((p) => p.id));
  if (!projects.size) throw new Error("Er staan geen projecten in deze back-up.");
  if ([...b.types!, ...b.items!, ...b.roles!, ...b.tags!].some((x) => !projects.has(x.project_id))) throw new Error("Deze back-up is beschadigd.");
  return b as Backup;
}

/** Vervangt elke id uit `map` (ook diep in velden, waarden en weergaven) door de nieuwe; de rest blijft. */
export function remap<T>(value: T, map: Map<string, string>): T {
  if (typeof value === "string") return (map.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((v) => remap(v, map)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [map.get(k) ?? k, remap(v, map)])) as T;
  }
  return value;
}

/**
 * Een nieuwe id voor alles in de back-up (projecten, rollen, lijsten, tags, items, logboek, weergaven, bestanden).
 * Personen niet: die koppelt het terugzetten aan wie al bestaat (zelfde e-mailadres) of maakt ze nieuw.
 */
export function freshIds(b: Backup, newId: () => string): Map<string, string> {
  const map = new Map<string, string>();
  for (const list of [b.projects, b.roles, b.types, b.tags, b.items, b.log, b.views, b.files]) for (const x of list) map.set(x.id, newId());
  return map;
}

/** De projecten bovenaan (hun ouder zit niet in de back-up): die worden hoofdprojecten. */
export const topProjects = (b: Backup) => b.projects.filter((p) => !p.parent_id || !b.projects.some((x) => x.id === p.parent_id));

/**
 * De projecten van boven naar onder (een ouder altijd voor zijn kinderen), met per project de keten erboven binnen de
 * back-up (het project zelf eerst). Wat niet aan een project bovenaan hangt (een kring), valt weg.
 */
export function projectTree(b: Backup): {
  order: BackupProject[];
  chain: Map<string, string[]>;
} {
  const order: BackupProject[] = [];
  const chain = new Map<string, string[]>();
  let level = topProjects(b);
  for (const p of level) chain.set(p.id, [p.id]);
  while (level.length) {
    order.push(...level);
    const ids = new Set(level.map((p) => p.id));
    level = b.projects.filter((p) => p.parent_id && ids.has(p.parent_id) && !chain.has(p.id));
    for (const p of level) chain.set(p.id, [p.id, ...chain.get(p.parent_id!)!]);
  }
  return { order, chain };
}
