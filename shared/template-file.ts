// Een lijst als sjabloon delen (Instellen → Algemeen → Als sjabloon): een bestand met de opbouw van de lijst (naam, hoe
// één ding heet, icoon, velden, voorraad en eigen soorten), zonder dingen, logboek, mensen, tags of weergaven. Een
// verwijzing naar de lijst zelf wordt "self" (bij het maken weer de nieuwe lijst); een verwijzing naar een andere lijst
// betekent elders niets en valt weg. Wat binnenkomt, gaat door `parseTemplateFile` en daarna door de gewone
// controle van POST /lists.

import type { ListTemplate, KindTemplate } from "./catalog.ts";
import type { FieldDef } from "./fields.ts";
import { isIconKey } from "./icons.ts";
import { cleanKindFields, cleanListFields } from "./listdef.ts";
import { BASES, type Base } from "./model.ts";
import { cleanStock } from "./stock.ts";

export const TEMPLATE_KIND = "thuis-sjabloon";
export const TEMPLATE_VERSION = 2;
/** Een verwijzing naar de lijst zelf, in een sjabloon. */
export const SELF = "self";

export type TemplateFile = {
  kind: typeof TEMPLATE_KIND;
  version: typeof TEMPLATE_VERSION;
  name: string;
  one: string | null;
  icon: string | null;
  fields: FieldDef[];
  stock: unknown;
  kinds: KindTemplate[];
};

const REF_TYPES = new Set(["item", "items", "amounts"]);

/** Velden met verwijzingen: naar de lijst zelf wordt `to`, naar een andere lijst valt weg. */
function refsTo(fields: FieldDef[], from: string, to: string): FieldDef[] {
  return fields.flatMap((f) => {
    if (!REF_TYPES.has(f.type) || !f.ref_type) return [f];
    if (f.ref_type !== from) return [];
    const { ref_also: _also, ...rest } = f;
    return [{ ...rest, ref_type: to }];
  });
}

/** Het bestand voor een lijst en haar eigen soorten. */
export function templateFile(list: { id: string; name: string; one: string | null; icon: string | null; fields: FieldDef[]; stock: unknown }, kinds: { base: Base; name: string; icon: string; fields: FieldDef[]; goal: number | null }[]): TemplateFile {
  return {
    kind: TEMPLATE_KIND,
    version: TEMPLATE_VERSION,
    name: list.name,
    one: list.one,
    icon: list.icon,
    fields: refsTo(list.fields, list.id, SELF),
    stock: list.stock,
    kinds: kinds.map((k) => ({ base: k.base, name: k.name, ...(isIconKey(k.icon) ? { icon: k.icon } : {}), fields: refsTo(k.fields, list.id, SELF), ...(k.goal ? { goal: k.goal } : {}) })),
  };
}

/** Een sjabloon uit een bestand, nagekeken; een fout met uitleg als het niet klopt. */
export function parseTemplateFile(raw: unknown): ListTemplate {
  const t = raw as Partial<TemplateFile> | null;
  if (!t || typeof t !== "object" || t.kind !== TEMPLATE_KIND) throw new Error("Dit is geen sjabloon van Heystack.");
  if (t.version !== TEMPLATE_VERSION) throw new Error("Dit sjabloon is van een andere versie van Heystack.");
  let fields: FieldDef[];
  try {
    fields = cleanListFields(t.fields);
  } catch (err) {
    throw new Error(`Dit sjabloon klopt niet: ${(err as Error).message}`);
  }
  // Enkel verwijzingen naar de lijst zelf.
  fields = fields.filter((f) => !REF_TYPES.has(f.type) || f.ref_type === SELF);
  const kinds: KindTemplate[] = [];
  for (const k of Array.isArray(t.kinds) ? t.kinds.slice(0, 20) : []) {
    if (!k || typeof k !== "object" || !Object.hasOwn(BASES, (k as KindTemplate).base)) continue;
    let kf: FieldDef[] = [];
    try {
      kf = cleanKindFields((k as KindTemplate).fields ?? []).filter((f) => !REF_TYPES.has(f.type) || f.ref_type === SELF);
    } catch {
      kf = [];
    }
    const name = typeof k.name === "string" && k.name.trim() ? k.name.trim().slice(0, 40) : BASES[k.base].label;
    kinds.push({ base: k.base, name, ...(isIconKey(k.icon) ? { icon: k.icon } : {}), fields: kf, ...(typeof k.goal === "number" && k.goal > 0 ? { goal: k.goal } : {}) });
  }
  const name = typeof t.name === "string" && t.name.trim() ? t.name.trim().slice(0, 60) : "Lijst";
  const stock = cleanStock(t.stock, fields);
  return {
    key: "bestand",
    name,
    one: typeof t.one === "string" && t.one.trim() ? t.one.trim().slice(0, 40) : null,
    icon: isIconKey(t.icon) ? t.icon : "folder",
    fields,
    ...(stock ? { stock } : {}),
    kinds,
  };
}

/** Bij het maken: "self" wordt de nieuwe lijst. */
export const withSelf = (fields: FieldDef[], id: string): FieldDef[] => fields.map((f) => (f.ref_type === SELF ? { ...f, ref_type: id } : f));
