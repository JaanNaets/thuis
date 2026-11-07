// Back-up en terugzetten (Jouw gegevens → Back-up, worker/routes/backup.ts): de lijsten die je beheert, met hun soorten,
// dingen, logboek (gebeurtenissen met hun lijnen), tags en weergaven (de gedeelde en je eigen). Nooit een rekeningnummer,
// app-instellingen of andermans eigen weergaven. Terugzetten maakt altijd een nieuwe kopie met nieuwe ids (`planRestore`)
// en kijkt alles na zoals bij gewoon invoeren; wat niet klopt, valt weg: een persoon die je niet kent, een verwijzing
// naar iets dat er niet (meer) is of dat je niet ziet (een lijn wordt dan tekst met de naam).

import { cleanAttributes, type AmountEntry, type Attributes, type FieldDef, type Share } from "./fields.ts";
import { cleanKindFields, cleanListFields } from "./listdef.ts";
import { BASES, isLineRole, isStatus, type Base, type LineRole, type Status } from "./model.ts";
import { cleanStock } from "./stock.ts";
import { cleanReadPhoto, type ReadPhoto } from "./photoread.ts";

export const BACKUP_KIND = "thuis-backup";
export const BACKUP_VERSION = 2;

/**
 * Elke tabel uit migrations/: mee in de back-up (true, of hoe), of bewust niet (false, met de reden in een commentaar).
 * test/backup.test.ts leest de migraties na: een nieuwe tabel moet hier staan.
 */
export const BACKUP_TABLES = {
  people: "de mensen in je lijsten (naam, e-mailadres, kleur; geen rekeningnummer, overzicht of app-instellingen)",
  lists: true,
  list_people: "wie erbij is (bij terugzetten ben jij beheerder; de anderen voeg je opnieuw toe)",
  list_tags: true,
  list_tag_links: true,
  kinds: true,
  things: true,
  events: true,
  lines: true,
  attachments: "de bestanden zelf staan in R2",
  saved_views: "gedeelde en je eigen",
  // Persoonlijk of af te leiden: van die persoon, of opnieuw in te stellen.
  list_order: false,
  tag_rules: false,
  ai_usage: false,
  ai_usage_people: false,
  products: false,
  nevo_foods: false, // NEVO van het RIVM: dezelfde voor iedereen, geen gegevens van een lijst
  settings: false,
  push_subscriptions: false,
  fixed_values: false,
  // Het oude model (projecten en items, voor de herbouw): wordt niet meer gebruikt en later opgeruimd.
  projects: false,
  roles: false,
  memberships: false,
  item_types: false,
  tags: false,
  items: false,
  item_tags: false,
  item_log: false,
  repeats: false,
  views: false,
  shown_lists: false,
  item_files: false,
} as const;

export type BackupLine = { role: LineRole; thing_id: string | null; text: string | null; amount: number | null; unit: string | null; price: number | null; expires: string | null; owner: string | null };

export type Backup = {
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  created_at: string;
  people: { id: string; name: string; email: string | null; color: string | null }[];
  tags: { id: string; name: string; color: string | null }[];
  lists: { id: string; name: string; one: string | null; icon: string | null; color: string | null; fields: unknown; stock: unknown; notify: unknown; read_photo?: unknown; archived: 0 | 1; tag_ids: string[] }[];
  kinds: { id: string; list_id: string; base: Base; name: string; icon: string; fields: unknown; goal: number | null; sort_order: number }[];
  things: { id: string; list_id: string; name: string; data: unknown; part_of: string | null; archived: 0 | 1; photo: boolean }[];
  events: {
    id: string;
    list_id: string;
    kind: string;
    base: Base;
    name: string;
    status: Status;
    at: string;
    end_at: string | null;
    amount: number | null;
    paid_by: string | null;
    split: unknown;
    to_person: string | null;
    data: unknown;
    repeat: unknown;
    done_by: string | null;
    photo: boolean;
    lines: BackupLine[];
  }[];
  views: { id: string; list_id: string; target: "dingen" | "logboek"; name: string; def: unknown; shared: 0 | 1 }[];
  /** De namen van dingen buiten de back-up waarnaar een lijn wijst (Colruyt in een lijst die je niet beheert). */
  outside: { id: string; name: string }[];
};

const ID = /^[A-Za-z0-9-]{1,64}$/;
const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

/** Is dit een back-up van Heystack? Gooit een fout met uitleg als het niet klopt. */
export function parseBackup(raw: unknown): Backup {
  const b = raw as Partial<Backup> | null;
  if (!b || typeof b !== "object" || b.kind !== BACKUP_KIND) throw new Error("Dit is geen back-up van Heystack.");
  if (b.version !== BACKUP_VERSION) throw new Error("Deze back-up is van een andere versie van Heystack.");
  for (const key of ["people", "tags", "lists", "kinds", "things", "events", "views", "outside"] as const) if (!Array.isArray(b[key])) throw new Error("Deze back-up is onvolledig.");
  const all = [...b.lists!, ...b.kinds!, ...b.things!, ...b.events!, ...b.tags!];
  if (!all.every((x) => isId((x as { id?: unknown })?.id))) throw new Error("Deze back-up is beschadigd.");
  const lists = new Set(b.lists!.map((l) => l.id));
  if (!lists.size) throw new Error("Er staan geen lijsten in deze back-up.");
  if ([...b.kinds!, ...b.things!, ...b.events!].some((x) => !lists.has(x.list_id))) throw new Error("Deze back-up is beschadigd.");
  return b as Backup;
}

/** Vervangt elke id uit `map` (ook diep in velden, waarden en weergaven) door de nieuwe; de rest blijft. */
export function remap<T>(value: T, map: Map<string, string>): T {
  if (typeof value === "string") return (map.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((v) => remap(v, map)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, map)])) as T;
  return value;
}

/** Verwijzingen naar dingen en personen die niet mogen, eruit. */
function keepRefs(fields: FieldDef[], data: Attributes, thing: (id: string) => boolean, person: (id: string) => boolean): Attributes {
  const out: Attributes = { ...data };
  for (const f of fields) {
    const v = out[f.key];
    if (v === undefined) continue;
    if (f.type === "item" && typeof v === "string" && !thing(v)) delete out[f.key];
    if (f.type === "items" && Array.isArray(v)) out[f.key] = (v as string[]).filter(thing);
    if (f.type === "amounts" && Array.isArray(v)) out[f.key] = (v as AmountEntry[]).filter((e) => !e.item || thing(e.item));
    if (f.type === "person" && typeof v === "string" && !person(v)) delete out[f.key];
    if (f.type === "people" && Array.isArray(v)) out[f.key] = (v as string[]).filter(person);
    if (f.type === "share" && Array.isArray(v)) out[f.key] = (v as Share[]).filter((s) => person(s.person_id));
    if (Array.isArray(out[f.key]) && (out[f.key] as unknown[]).length === 0) delete out[f.key];
  }
  return out;
}

export type RestoreContext = {
  newId: () => string;
  me: string;
  /** Wie je kent (jezelf en wie met jou in een lijst zit): enkel die blijven staan in velden, verdelingen en lijnen. */
  people: Set<string>;
  /** Dingen buiten de back-up die er nog zijn en die je ziet (Colruyt): een lijn mag ernaar blijven wijzen. */
  seenThings: Set<string>;
};

export type RestorePlan = {
  lists: { id: string; name: string; one: string | null; icon: string | null; color: string | null; fields: FieldDef[]; stock: unknown; notify: unknown; read_photo: ReadPhoto | null; archived: 0 | 1; tags: string[] }[];
  kinds: { id: string; list_id: string; base: Base; name: string; icon: string; fields: FieldDef[]; goal: number | null; sort_order: number }[];
  things: { id: string; old: string; list_id: string; name: string; data: Attributes; part_of: string | null; archived: 0 | 1; photo: boolean }[];
  events: (Omit<Backup["events"][number], "lines" | "data"> & { old: string; data: Attributes; lines: BackupLine[] })[];
  views: Backup["views"];
};

const remapReadPhoto = (r: ReadPhoto | null, map: Map<string, string>): ReadPhoto | null =>
  r && { on: r.on.map((f) => map.get(f) ?? f), off: r.off.map((f) => map.get(f) ?? f) };

/** Wat terugzetten maakt: alles met nieuwe ids, nagekeken. */
export function planRestore(backup: Backup, ctx: RestoreContext): RestorePlan {
  const map = new Map<string, string>();
  for (const x of [...backup.lists, ...backup.kinds, ...backup.things, ...backup.events, ...backup.views]) map.set(x.id, ctx.newId());
  const newThings = new Set(backup.things.map((t) => map.get(t.id)!));
  const thingOk = (id: string) => newThings.has(id) || ctx.seenThings.has(id);
  const personOk = (id: string) => ctx.people.has(id);
  const tagName = new Map(backup.tags.map((t) => [t.id, t.name]));
  const outsideName = new Map(backup.outside.map((t) => [t.id, t.name]));
  const thingName = new Map(backup.things.map((t) => [t.id, t.name]));

  const lists: RestorePlan["lists"] = [];
  const fieldsOf = new Map<string, FieldDef[]>();
  for (const l of backup.lists) {
    let fields: FieldDef[] = [];
    try {
      fields = cleanListFields(remap(l.fields, map));
    } catch {
      fields = [];
    }
    const id = map.get(l.id)!;
    fieldsOf.set(id, fields);
    lists.push({
      id,
      name: String(l.name ?? "").trim().slice(0, 80) || "Lijst",
      one: typeof l.one === "string" ? l.one.slice(0, 40) : null,
      icon: typeof l.icon === "string" ? l.icon : null,
      color: typeof l.color === "string" ? l.color : null,
      fields,
      stock: cleanStock(l.stock, fields),
      notify: l.notify ?? null,
      // Een eigen soort krijgt een nieuwe id; een basissoort en "dingen" blijven.
      read_photo: remapReadPhoto(cleanReadPhoto(l.read_photo), map),
      archived: l.archived ? 1 : 0,
      tags: [...new Set((l.tag_ids ?? []).map((t) => tagName.get(t)).filter((n): n is string => Boolean(n)))],
    });
  }

  const kinds: RestorePlan["kinds"] = [];
  const kindFields = new Map<string, FieldDef[]>();
  for (const k of backup.kinds) {
    if (!Object.hasOwn(BASES, k.base)) continue;
    let fields: FieldDef[] = [];
    try {
      fields = cleanKindFields(remap(k.fields, map));
    } catch {
      fields = [];
    }
    const id = map.get(k.id)!;
    kindFields.set(id, fields);
    kinds.push({ id, list_id: map.get(k.list_id)!, base: k.base, name: String(k.name ?? "").slice(0, 40) || BASES[k.base].label, icon: k.icon, fields, goal: typeof k.goal === "number" ? k.goal : null, sort_order: k.sort_order ?? 0 });
  }

  const things: RestorePlan["things"] = backup.things.map((t) => {
    const list_id = map.get(t.list_id)!;
    const fields = fieldsOf.get(list_id) ?? [];
    const partOf = t.part_of ? (map.get(t.part_of) ?? t.part_of) : null;
    return {
      id: map.get(t.id)!,
      old: t.id,
      list_id,
      name: String(t.name ?? "").trim().slice(0, 200) || "Naamloos",
      data: keepRefs(fields, cleanAttributes(fields, remap(t.data, map)), thingOk, personOk),
      part_of: partOf && thingOk(partOf) ? partOf : null,
      archived: t.archived ? 1 : 0,
      photo: Boolean(t.photo),
    };
  });

  const events: RestorePlan["events"] = [];
  for (const e of backup.events) {
    if (!Object.hasOwn(BASES, e.base) || !isStatus(e.status)) continue;
    const kind = map.get(e.kind) ?? (Object.hasOwn(BASES, e.kind) ? e.kind : e.base);
    const fields = kindFields.get(kind) ?? [];
    const lines: BackupLine[] = [];
    for (const l of e.lines ?? []) {
      if (!isLineRole(l.role)) continue;
      const thing = l.thing_id ? (map.get(l.thing_id) ?? l.thing_id) : null;
      // Een ding dat er niet (meer) is of dat je niet ziet: de lijn wordt tekst met zijn naam.
      const keep = thing && thingOk(thing);
      const text = keep ? null : (l.text ?? (l.thing_id ? (thingName.get(l.thing_id) ?? outsideName.get(l.thing_id) ?? null) : null));
      if (!keep && !text) continue;
      lines.push({ ...l, thing_id: keep ? thing : null, text, owner: l.owner && personOk(l.owner) ? l.owner : null });
    }
    const split = Array.isArray(e.split) ? (e.split as Share[]).filter((s) => s && personOk(s.person_id)) : null;
    events.push({
      ...e,
      id: map.get(e.id)!,
      old: e.id,
      list_id: map.get(e.list_id)!,
      kind,
      paid_by: e.paid_by && personOk(e.paid_by) ? e.paid_by : null,
      to_person: e.to_person && personOk(e.to_person) ? e.to_person : null,
      split: split && split.length ? split : null,
      data: keepRefs(fields, cleanAttributes(fields, remap(e.data, map)), thingOk, personOk),
      repeat: e.repeat ?? null,
      done_by: e.done_by ? (map.get(e.done_by) ?? null) : null,
      lines,
    });
  }

  const views = backup.views.map((v) => ({ ...v, id: map.get(v.id)!, list_id: map.get(v.list_id) ?? v.list_id, def: remap(v.def, map) })).filter((v) => lists.some((l) => l.id === v.list_id));
  return { lists, kinds, things, events, views };
}
