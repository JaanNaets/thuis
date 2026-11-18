// Back-up en terugzetten (Jouw gegevens → Back-up, worker/routes/backup.ts): de lijsten die je beheert, met hun soorten,
// items, logboek (gebeurtenissen met hun lijnen), tags en weergaven (de gedeelde en je eigen). Nooit een rekeningnummer,
// app-instellingen of andermans eigen weergaven. Terugzetten maakt altijd een nieuwe kopie met nieuwe ids (`planRestore`)
// en kijkt alles na zoals bij gewoon invoeren; wat niet klopt, valt weg: een persoon die je niet kent, een verwijzing
// naar iets dat er niet (meer) is of dat je niet ziet (een lijn wordt dan tekst met de naam).

import { cleanDoes, type Handeling } from "./cells.ts";
import { cleanAttributes, type AmountEntry, type Attributes, type FieldDef, type Share } from "./fields.ts";
import { cleanKindFields, cleanListFields } from "./listdef.ts";
import { cleanLedger, type LedgerDef } from "./ledger.ts";
import { BASES, cleanParts, isLineRole, isStatus, type Base, type LineRole, type Parts, type Status } from "./model.ts";
import { cleanStock } from "./stock.ts";
import { cleanReadPhoto, type ReadPhoto } from "./photoread.ts";

export const BACKUP_KIND = "thuis-backup";
export const BACKUP_VERSION = 3;

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
  items: true,
  mirrors: "koppelingen tussen lijsten die allebei in de back-up zitten",
  events: true,
  lines: true,
  effects: false, // afgeleid uit de gebeurtenissen en hun formulieren (worker/cells.ts): na terugzetten opnieuw uitgerekend
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
} as const;

export type BackupLine = { role: LineRole; item_id: string | null; text: string | null; amount: number | null; unit: string | null; price: number | null; expires: string | null; owner: string | null };

export type Backup = {
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  created_at: string;
  people: { id: string; name: string; email: string | null; color: string | null }[];
  tags: { id: string; name: string; color: string | null }[];
  lists: { id: string; name: string; one: string | null; icon: string | null; color: string | null; fields: unknown; stock: unknown; ledger?: unknown; notify: unknown; read_photo?: unknown; archived: 0 | 1; tag_ids: string[] }[];
  /** `planned` ontbreekt in back-ups van vóór 2026-11-10 (dan: niet gepland). */
  kinds: { id: string; list_id: string; base: Base; name: string; icon: string; fields: unknown; goal: number | null; planned?: boolean; parts?: unknown; does?: unknown; sort_order: number }[];
  items: { id: string; list_id: string; name: string; data: unknown; part_of: string | null; archived: 0 | 1; photo: boolean; mirror_id?: string | null; mirror_of?: string | null }[];
  /** Koppelingen (zie shared/transfer.ts) tussen lijsten die allebei in de back-up zitten; ontbreekt in oudere back-ups. */
  mirrors?: { id: string; list_id: string; source_id: string; plan: unknown }[];
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
  views: { id: string; list_id: string; target: "items" | "logboek"; name: string; def: unknown; shared: 0 | 1 }[];
  /** De namen van items buiten de back-up waarnaar een lijn wijst (Colruyt in een lijst die je niet beheert). */
  outside: { id: string; name: string }[];
};

const ID = /^[A-Za-z0-9-]{1,64}$/;
const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

/**
 * Een back-up van versie 2 (toen items nog "dingen" en `things` heetten) als versie 3: `items`, een lijn met `item_id`
 * en een weergave van de items.
 */
function olderBackup(raw: unknown): unknown {
  const b = raw as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || b.kind !== BACKUP_KIND || b.version !== 2) return raw;
  const lines = (l: Record<string, unknown>) => {
    const { thing_id, ...rest } = l;
    return { ...rest, item_id: rest.item_id ?? thing_id ?? null };
  };
  const events = Array.isArray(b.events) ? (b.events as Record<string, unknown>[]).map((e) => ({ ...e, lines: Array.isArray(e.lines) ? (e.lines as Record<string, unknown>[]).map(lines) : e.lines })) : b.events;
  const views = Array.isArray(b.views) ? (b.views as Record<string, unknown>[]).map((v) => ({ ...v, target: v.target === "dingen" ? "items" : v.target })) : b.views;
  const { things, ...rest } = b;
  return { ...rest, version: 3, items: b.items ?? things, events, views };
}

/** Is dit een back-up van Heystack? Gooit een fout met uitleg als het niet klopt. */
export function parseBackup(raw: unknown): Backup {
  const b = olderBackup(raw) as Partial<Backup> | null;
  if (!b || typeof b !== "object" || b.kind !== BACKUP_KIND) throw new Error("Dit is geen back-up van Heystack.");
  if (b.version !== BACKUP_VERSION) throw new Error("Deze back-up is van een andere versie van Heystack.");
  for (const key of ["people", "tags", "lists", "kinds", "items", "events", "views", "outside"] as const) if (!Array.isArray(b[key])) throw new Error("Deze back-up is onvolledig.");
  const all = [...b.lists!, ...b.kinds!, ...b.items!, ...b.events!, ...b.tags!];
  if (!all.every((x) => isId((x as { id?: unknown })?.id))) throw new Error("Deze back-up is beschadigd.");
  const lists = new Set(b.lists!.map((l) => l.id));
  if (!lists.size) throw new Error("Er staan geen lijsten in deze back-up.");
  if ([...b.kinds!, ...b.items!, ...b.events!].some((x) => !lists.has(x.list_id))) throw new Error("Deze back-up is beschadigd.");
  return b as Backup;
}

/** Vervangt elke id uit `map` (ook diep in velden, waarden en weergaven) door de nieuwe; de rest blijft. */
export function remap<T>(value: T, map: Map<string, string>): T {
  if (typeof value === "string") return (map.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((v) => remap(v, map)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, map)])) as T;
  return value;
}

/** Verwijzingen naar items en personen die niet mogen, eruit. */
function keepRefs(fields: FieldDef[], data: Attributes, item: (id: string) => boolean, person: (id: string) => boolean): Attributes {
  const out: Attributes = { ...data };
  for (const f of fields) {
    const v = out[f.key];
    if (v === undefined) continue;
    if (f.type === "item" && typeof v === "string" && !item(v)) delete out[f.key];
    if (f.type === "items" && Array.isArray(v)) out[f.key] = (v as string[]).filter(item);
    if (f.type === "amounts" && Array.isArray(v)) out[f.key] = (v as AmountEntry[]).filter((e) => !e.item || item(e.item));
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
  /** Items buiten de back-up die er nog zijn en die je ziet (Colruyt): een lijn mag ernaar blijven wijzen. */
  seenItems: Set<string>;
};

export type RestorePlan = {
  lists: { id: string; name: string; one: string | null; icon: string | null; color: string | null; fields: FieldDef[]; stock: unknown; ledger: LedgerDef | null; notify: unknown; read_photo: ReadPhoto | null; archived: 0 | 1; tags: string[] }[];
  kinds: { id: string; list_id: string; base: Base; name: string; icon: string; fields: FieldDef[]; goal: number | null; planned: boolean; parts: Parts | null; does: Handeling[]; sort_order: number }[];
  items: { id: string; old: string; list_id: string; name: string; data: Attributes; part_of: string | null; archived: 0 | 1; photo: boolean; mirror_id: string | null; mirror_of: string | null }[];
  mirrors: { id: string; list_id: string; source_id: string; plan: unknown }[];
  events: (Omit<Backup["events"][number], "lines" | "data"> & { old: string; data: Attributes; lines: BackupLine[] })[];
  views: Backup["views"];
};

const remapReadPhoto = (r: ReadPhoto | null, map: Map<string, string>): ReadPhoto | null =>
  r && { on: r.on.map((f) => map.get(f) ?? f), off: r.off.map((f) => map.get(f) ?? f) };

/** Wat terugzetten maakt: alles met nieuwe ids, nagekeken. */
export function planRestore(backup: Backup, ctx: RestoreContext): RestorePlan {
  const map = new Map<string, string>();
  for (const x of [...backup.lists, ...backup.kinds, ...backup.items, ...backup.events, ...backup.views, ...(backup.mirrors ?? [])]) map.set(x.id, ctx.newId());
  const newItems = new Set(backup.items.map((t) => map.get(t.id)!));
  const itemOk = (id: string) => newItems.has(id) || ctx.seenItems.has(id);
  const personOk = (id: string) => ctx.people.has(id);
  const tagName = new Map(backup.tags.map((t) => [t.id, t.name]));
  const outsideName = new Map(backup.outside.map((t) => [t.id, t.name]));
  const itemName = new Map(backup.items.map((t) => [t.id, t.name]));

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
      ledger: cleanLedger(l.ledger, fields),
      notify: l.notify ?? null,
      // Een eigen soort krijgt een nieuwe id; een basissoort en "items" blijven.
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
    // Wat het formulier invult: enkel in lijsten die terugkomen (met hun nieuwe velden), of de voorraad van elke lijst.
    let does: Handeling[] = [];
    try {
      const back = lists.map((l) => ({ id: l.id, name: l.name, stock: Boolean(l.stock), ledger: Boolean(l.ledger), fields: l.fields }));
      const raw = (Array.isArray(k.does) ? k.does : []).map((h) => remap(h, map)).filter((h) => !h?.list || back.some((l) => l.id === h.list));
      does = cleanDoes(raw, back, fields);
    } catch {
      does = [];
    }
    // De groepen lijnen: een lijst die niet terugkomt, valt weg (de groep blijft, uit elke lijst).
    const parts = cleanParts(k.parts === undefined || k.parts === null ? null : remap(k.parts, map));
    const back = new Set(lists.map((l) => l.id));
    if (parts) parts.groups = parts.groups.map((g) => (g.list && !back.has(g.list) ? { ...g, list: null } : g));
    kinds.push({ id, list_id: map.get(k.list_id)!, base: k.base, name: String(k.name ?? "").slice(0, 40) || BASES[k.base].label, icon: k.icon, fields, goal: typeof k.goal === "number" ? k.goal : null, planned: k.planned === true, parts, does, sort_order: k.sort_order ?? 0 });
  }

  // Een koppeling enkel tussen twee lijsten die terugkomen; de bron en de doellijst met hun nieuwe ids.
  const restored = new Set(backup.lists.map((l) => map.get(l.id)!));
  const mirrors: RestorePlan["mirrors"] = (backup.mirrors ?? [])
    .map((m) => ({ id: map.get(m.id)!, list_id: map.get(m.list_id) ?? "", source_id: map.get(m.source_id) ?? "", plan: remap(m.plan, map) }))
    .filter((m) => restored.has(m.list_id) && restored.has(m.source_id) && m.list_id !== m.source_id);
  const mirrorIds = new Set(mirrors.map((m) => m.id));

  const items: RestorePlan["items"] = backup.items.map((t) => {
    const list_id = map.get(t.list_id)!;
    const mirror = t.mirror_id ? (map.get(t.mirror_id) ?? null) : null;
    const fields = fieldsOf.get(list_id) ?? [];
    const partOf = t.part_of ? (map.get(t.part_of) ?? t.part_of) : null;
    return {
      id: map.get(t.id)!,
      old: t.id,
      list_id,
      name: String(t.name ?? "").trim().slice(0, 200) || "Naamloos",
      data: keepRefs(fields, cleanAttributes(fields, remap(t.data, map)), itemOk, personOk),
      part_of: partOf && itemOk(partOf) ? partOf : null,
      archived: t.archived ? 1 : 0,
      photo: Boolean(t.photo),
      mirror_id: mirror && mirrorIds.has(mirror) ? mirror : null,
      mirror_of: mirror && mirrorIds.has(mirror) && t.mirror_of ? (map.get(t.mirror_of) ?? null) : null,
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
      const item = l.item_id ? (map.get(l.item_id) ?? l.item_id) : null;
      // Een item dat er niet (meer) is of dat je niet ziet: de lijn wordt tekst met zijn naam.
      const keep = item && itemOk(item);
      const text = keep ? null : (l.text ?? (l.item_id ? (itemName.get(l.item_id) ?? outsideName.get(l.item_id) ?? null) : null));
      if (!keep && !text) continue;
      lines.push({ ...l, item_id: keep ? item : null, text, owner: l.owner && personOk(l.owner) ? l.owner : null });
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
      data: keepRefs(fields, cleanAttributes(fields, remap(e.data, map)), itemOk, personOk),
      repeat: e.repeat ?? null,
      done_by: e.done_by ? (map.get(e.done_by) ?? null) : null,
      lines,
    });
  }

  const views = backup.views.map((v) => ({ ...v, id: map.get(v.id)!, list_id: map.get(v.list_id) ?? v.list_id, def: remap(v.def, map) })).filter((v) => lists.some((l) => l.id === v.list_id));
  return { lists, kinds, items, mirrors, events, views };
}
