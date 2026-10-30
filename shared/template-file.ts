// Sjablonen delen als bestand: een project (met zijn subprojecten) of één lijst, zonder items, mensen, rollen of
// tags. Iemand anders maakt er een nieuw project mee, of voegt de lijsten toe aan een bestaand project.
//
// Het bestand is JSON: { thuis: "sjabloon", version: 1, project: { name, description, icon, color, lists, children } }.
// Een lijst heeft een sleutel; verwijzingen en samenvattingen wijzen naar die sleutel (zie `TypeTemplate`). Wat
// binnenkomt, wordt volledig nagekeken (`parseTemplateFile`); de API kijkt daarna de verwijzingen tegen de keten na.

import { cleanFields, fieldKey, MAX_FIELDS, type FieldDef } from "./fields.ts";
import { MAX_TOTALS, type TotalDef } from "./totals.ts";
import { isIconKey, type IconKey, type TemplateField, type TemplatePlan, type TypeTemplate } from "./templates.ts";
import { isTone, type ItemType, type Tone } from "./types.ts";

export const TEMPLATE_VERSION = 1;
const LIMITS = { projects: 25, depth: 5, lists: 40 };

export type TemplateProject = {
  name: string;
  description: string | null;
  icon: IconKey | null;
  color: Tone | null;
  lists: TypeTemplate[];
  children: TemplateProject[];
};
export type TemplateFile = { thuis: "sjabloon"; version: number; project: TemplateProject };

// ---------- inlezen en nakijken ----------

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Een gewone verdeling noemt mensen; die horen niet in een sjabloon. */
const withoutPeople = <F extends FieldDef | TemplateField>({ default_shares: _people, ...f }: F) => f as F;

/**
 * Totalen: enkel de vorm (de API kijkt ze na tegen de velden zodra de lijst er is), zonder lijsten uit andere
 * projecten (die bestaan bij iemand anders niet).
 */
function totalsOf(totals: unknown): TotalDef[] {
  return Array.isArray(totals)
    ? (totals
        .filter(isObject)
        .slice(0, MAX_TOTALS)
        .map(({ sources: _sources, ...t }) => t) as TotalDef[])
    : [];
}

/**
 * Een sjabloon van voor de totalen had regels: Kosten verdelen (bedrag, betaald door, verdeling) of Terugbetalingen
 * (bedrag, van, aan). Die worden velden die zelf invullen en een totaal dat verrekent.
 */
function fromRules(rules: unknown, fields: FieldDef[], totals: TotalDef[]): { fields: FieldDef[]; totals: TotalDef[] } {
  const rule = Array.isArray(rules) && isObject(rules[0]) ? rules[0] : null;
  if (!rule || totals.some((t) => t.settle)) return { fields, totals };
  const key = (k: unknown) => (typeof k === "string" && fields.some((f) => f.key === k) ? k : undefined);
  const amount = key(rule.amount);
  const [by, against] = rule.kind === "split" ? [key(rule.payer), key(rule.for)] : rule.kind === "settle" ? [key(rule.from), key(rule.to)] : [];
  if (!amount || !by || !against) return { fields, totals };
  return {
    fields:
      rule.kind === "split"
        ? fields.map((f) => (f.key === by && f.type === "person" ? { ...f, me: true } : f.key === against && f.type === "share" ? { ...f, fill: true } : f))
        : fields,
    totals: [...totals, { id: "saldo", agg: "sum", field: amount, period: "all", by, against, settle: true, scope: "tree" } satisfies TotalDef].slice(
      0,
      MAX_TOTALS,
    ),
  };
}

/** Een sjabloon nakijken (uit een bestand of van de API). Gooit een fout met uitleg. */
export function parseTemplateFile(raw: unknown): TemplateFile {
  if (!isObject(raw) || raw.thuis !== "sjabloon") throw new Error("Dit is geen sjabloon van Thuis.");
  if (typeof raw.version !== "number" || raw.version < 1) throw new Error("Dit sjabloon kan Thuis niet lezen.");
  if (raw.version > TEMPLATE_VERSION) throw new Error("Dit sjabloon is gemaakt met een nieuwere versie van Thuis.");
  const keys = new Set<string>();
  let projects = 0;
  let lists = 0;

  const list = (l: unknown): TypeTemplate => {
    if (!isObject(l)) throw new Error("Een lijst in het sjabloon klopt niet.");
    const name = text(l.name, 40);
    if (!name) throw new Error("Elke lijst in het sjabloon heeft een naam nodig.");
    const key = typeof l.key === "string" && /^[a-z0-9_]{1,40}$/.test(l.key) ? l.key : "";
    if (!key || keys.has(key)) throw new Error(`${name}: geen geldige sleutel.`);
    keys.add(key);
    if (++lists > LIMITS.lists) throw new Error(`Hoogstens ${LIMITS.lists} lijsten in een sjabloon.`);
    if (!Array.isArray(l.fields ?? [])) throw new Error(`${name}: de velden kloppen niet.`);
    // De velden zoals bij een gewone lijst; een verwijzing heet hier `ref` (de sleutel van een lijst in het sjabloon).
    let fields: FieldDef[];
    try {
      fields = cleanFields(((l.fields ?? []) as unknown[]).slice(0, MAX_FIELDS + 1).map((f) => (isObject(f) ? { ...f, ref_type: f.ref } : f)));
    } catch (err) {
      throw new Error(`${name}: ${(err as Error).message}`);
    }
    const converted = fromRules(l.rules, fields.map(withoutPeople), totalsOf(l.totals));
    const nameLabel = text(l.name_label, 40);
    return {
      key,
      name,
      plural: text(l.plural, 40) || name,
      ...(nameLabel ? { name_label: nameLabel } : {}),
      icon: isIconKey(l.icon) ? l.icon : "folder",
      fields: converted.fields.map(({ ref_type, ...f }): TemplateField => (ref_type ? { ...f, ref: ref_type } : f)),
      totals: converted.totals,
      ...(l.linked === true ? { linked: true } : {}),
    };
  };

  const project = (p: unknown, depth: number): TemplateProject => {
    if (!isObject(p)) throw new Error("Het sjabloon klopt niet.");
    if (++projects > LIMITS.projects) throw new Error(`Hoogstens ${LIMITS.projects} projecten in een sjabloon.`);
    if (depth > LIMITS.depth) throw new Error("De subprojecten zitten te diep in elkaar.");
    const name = text(p.name, 80);
    if (!name) throw new Error("Het sjabloon heeft geen naam.");
    if (!Array.isArray(p.lists ?? []) || !Array.isArray(p.children ?? [])) throw new Error(`${name}: de lijsten kloppen niet.`);
    return {
      name,
      description: text(p.description, 2000) || null,
      icon: isIconKey(p.icon) ? p.icon : null,
      color: isTone(p.color) ? p.color : null,
      lists: ((p.lists ?? []) as unknown[]).map(list),
      children: ((p.children ?? []) as unknown[]).map((c) => project(c, depth + 1)),
    };
  };

  return { thuis: "sjabloon", version: TEMPLATE_VERSION, project: project(raw.project, 1) };
}

/** Wat erin zit, kort: "3 lijsten · 1 subproject". */
export function templateSummary(file: TemplateFile): { lists: string[]; projects: number } {
  const all: TemplateProject[] = [];
  const walk = (p: TemplateProject) => (all.push(p), p.children.forEach(walk));
  walk(file.project);
  return { lists: all.flatMap((p) => p.lists.map((l) => l.plural)), projects: all.length - 1 };
}

// ---------- maken (exporteren) ----------

export type ExportProject = { id: string; parent_id: string | null; name: string; description: string | null; icon: string | null; color: string | null };

/**
 * Een sjabloon maken. `projects`: het project en zijn subprojecten (het eerste is het project zelf, in hun
 * volgorde); `lists`: hun lijsten en die erboven (in hun volgorde). Een lijst erboven komt enkel mee als ernaar
 * verwezen wordt (`linked`). `only`: één lijst delen in plaats van het hele project.
 */
export function buildTemplateFile(projects: ExportProject[], lists: ItemType[], only?: ItemType): TemplateFile {
  const root = projects[0];
  const tree = new Set(projects.map((p) => p.id));
  const chosen = only ? [only] : lists.filter((l) => tree.has(l.project_id));
  // Waarnaar verwezen wordt, komt mee (ook wat die lijsten zelf nodig hebben).
  const included = new Map(chosen.map((l) => [l.id, l]));
  const linked: ItemType[] = [];
  for (let i = 0; i < chosen.length + linked.length; i++) {
    const l = i < chosen.length ? chosen[i] : linked[i - chosen.length];
    for (const f of l.fields) {
      const target = (f.type === "item" || f.type === "items") && !included.has(f.ref_type!) ? lists.find((x) => x.id === f.ref_type) : undefined;
      if (!target) continue;
      included.set(target.id, target);
      linked.push(target);
    }
  }
  const taken: string[] = [];
  const keys = new Map<string, string>();
  for (const l of included.values()) {
    const key = fieldKey(l.name, taken);
    taken.push(key);
    keys.set(l.id, key);
  }

  const toTemplate = (l: ItemType, isLinked: boolean): TypeTemplate => {
    const fields: TemplateField[] = [];
    for (const def of l.fields) {
      const { ref_type, result: _result, ...f } = def;
      if (f.type === "item" || f.type === "items") {
        const key = ref_type ? keys.get(ref_type) : undefined;
        if (key) fields.push({ ...f, ref: key });
      } else if (f.type === "calc" && f.calc?.kind === "rollup" && f.calc.from === "backlinks") {
        // Een samenvatting over een lijst die niet meekomt (bv. uit een ander project), valt weg.
        const key = f.calc.list ? keys.get(f.calc.list) : undefined;
        if (key) fields.push({ ...f, calc: { ...f.calc, list: key } });
      } else fields.push(withoutPeople(f));
    }
    return {
      key: keys.get(l.id)!,
      name: l.name,
      plural: l.plural,
      ...(l.name_label ? { name_label: l.name_label } : {}),
      icon: isIconKey(l.icon) ? l.icon : "folder",
      fields,
      totals: totalsOf(l.totals),
      ...(isLinked ? { linked: true } : {}),
    };
  };

  const node = (p: ExportProject): TemplateProject => ({
    name: p.name,
    description: p.description,
    icon: isIconKey(p.icon) ? p.icon : null,
    color: isTone(p.color) ? p.color : null,
    lists: chosen.filter((l) => l.project_id === p.id).map((l) => toTemplate(l, false)),
    children: projects.filter((c) => c.parent_id === p.id).map(node),
  });
  const top: TemplateProject = only
    ? { name: only.plural, description: null, icon: isIconKey(only.icon) ? only.icon : null, color: null, lists: [toTemplate(only, false)], children: [] }
    : node(root);
  top.lists.push(...linked.map((l) => toTemplate(l, true)));
  return { thuis: "sjabloon", version: TEMPLATE_VERSION, project: top };
}

// ---------- aanmaken (importeren) ----------

/**
 * Waar elke lijst van een sjabloon komt. `projectIds`: de (nieuwe) id van elk project, in de volgorde van
 * `flatten`; `byName`: de lijsten erboven op naam (een gekoppelde lijst met die naam wordt hergebruikt). Een
 * verwijzing mag naar een lijst in hetzelfde project of erboven; een samenvatting ook naar een lijst eronder (zoals
 * in de app). Geeft per project de lijsten die gemaakt moeten worden.
 */
export function planTemplate(
  top: TemplateProject,
  projectIds: string[],
  byName: Record<string, string>,
  newId: () => string,
): { projectId: string; plans: TemplatePlan[] }[] {
  const nodes = flatten(top);
  const ids = new Map<TemplateProject, Record<string, string>>();
  for (const { project } of nodes) {
    ids.set(project, Object.fromEntries(project.lists.map((l) => [l.key, (l.linked && byName[l.name.toLowerCase()]) || newId()])));
  }
  const below = (p: TemplateProject): Record<string, string> => Object.assign({}, ...p.children.map((c) => ({ ...ids.get(c), ...below(c) })));
  const reused = new Set(Object.values(byName));
  return nodes.map(({ project, ancestors }, i) => {
    const refs = Object.assign({}, ...ancestors.map((a) => ids.get(a)), ids.get(project));
    const calcs = { ...refs, ...below(project) };
    const own = ids.get(project)!;
    return {
      projectId: projectIds[i],
      plans: project.lists.filter((l) => !reused.has(own[l.key])).map((list) => ({ id: own[list.key], list, refs, calcs })),
    };
  });
}

/** De projecten van een sjabloon na elkaar (eerst een project, dan zijn subprojecten), met wie erboven staat. */
export function flatten(top: TemplateProject): { project: TemplateProject; parent: number | null; ancestors: TemplateProject[] }[] {
  const out: { project: TemplateProject; parent: number | null; ancestors: TemplateProject[] }[] = [];
  const walk = (p: TemplateProject, parent: number | null, ancestors: TemplateProject[]) => {
    const index = out.push({ project: p, parent, ancestors }) - 1;
    for (const c of p.children) walk(c, index, [...ancestors, p]);
  };
  walk(top, null, []);
  return out;
}
