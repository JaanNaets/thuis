// Een lijst als sjabloon delen (Instellen → Algemeen → Als sjabloon): een bestand met de opbouw van de lijst (naam, hoe
// één ding heet, icoon, velden, voorraad, eigen soorten en wie een melding krijgt), zonder dingen, logboek, mensen, tags of weergaven. Een
// verwijzing naar de lijst zelf wordt "self" (bij het maken weer de nieuwe lijst); een verwijzing naar een andere lijst
// betekent elders niets en valt weg. Wat binnenkomt, gaat door `parseTemplateFile` en daarna door de gewone
// controle van POST /lists.

import { cleanDoes, STOCK, type Handeling } from "./cells.ts";
import { cleanNotify } from "./alerts.ts";
import type { ListTemplate, KindTemplate } from "./catalog.ts";
import type { FieldDef } from "./fields.ts";
import { isIconKey } from "./icons.ts";
import { cleanKindFields, cleanListFields } from "./listdef.ts";
import { cleanLedger } from "./ledger.ts";
import { BASES, cleanParts, type Base, type Parts } from "./model.ts";
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
  /** Een saldo per persoon (ontbreekt het, dan geen). */
  ledger?: unknown;
  kinds: KindTemplate[];
  /** Wie een melding krijgt (sinds deze versie; ontbreekt het, dan geen). */
  notify?: unknown;
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
export function templateFile(
  list: { id: string; name: string; one: string | null; icon: string | null; fields: FieldDef[]; stock: unknown; ledger?: unknown; notify?: unknown },
  kinds: { base: Base; name: string; icon: string; fields: FieldDef[]; goal: number | null; planned?: boolean; parts?: Parts; does?: Handeling[] }[],
): TemplateFile {
  // De groepen lijnen: uit de lijst zelf wordt "self", uit een andere lijst uit elke lijst.
  const ownParts = (p?: Parts) => (p ? { ...p, groups: p.groups.map((g) => ({ ...g, list: g.list === list.id ? SELF : null })) } : undefined);
  // Wat een formulier invult: in de lijst zelf, of de voorraad van elke lijst (niets van andere lijsten).
  const ownDoes = (does: Handeling[] = []) => does.filter((h) => h.list === list.id || (h.list === null && h.field === STOCK)).map((h) => ({ ...h, list: h.list ? SELF : null }));
  return {
    kind: TEMPLATE_KIND,
    version: TEMPLATE_VERSION,
    name: list.name,
    one: list.one,
    icon: list.icon,
    fields: refsTo(list.fields, list.id, SELF),
    stock: list.stock,
    ...(list.ledger ? { ledger: list.ledger } : {}),
    kinds: kinds.map((k) => {
      const does = ownDoes(k.does);
      const parts = ownParts(k.parts);
      return {
        base: k.base,
        name: k.name,
        ...(isIconKey(k.icon) ? { icon: k.icon } : {}),
        fields: refsTo(k.fields, list.id, SELF),
        ...(k.goal ? { goal: k.goal } : {}),
        ...(k.planned ? { planned: true as const } : {}),
        ...(parts ? { parts } : {}),
        ...(does.length ? { does } : {}),
      };
    }),
    ...(list.notify ? { notify: list.notify } : {}),
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
  const stock = cleanStock(t.stock, fields);
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
    let does: Handeling[] = [];
    try {
      does = cleanDoes((k as KindTemplate).does ?? [], [{ id: SELF, name: "deze lijst", stock: Boolean(stock), ledger: Boolean(cleanLedger(t.ledger, fields)), fields }], kf);
    } catch {
      does = [];
    }
    const raw = cleanParts((k as KindTemplate).parts);
    const parts = raw ? { ...raw, groups: raw.groups.map((g) => (g.list === SELF ? g : { ...g, list: null })) } : null;
    kinds.push({
      base: k.base,
      name,
      ...(isIconKey(k.icon) ? { icon: k.icon } : {}),
      fields: kf,
      ...(typeof k.goal === "number" && k.goal > 0 ? { goal: k.goal } : {}),
      ...(k.planned === true ? { planned: true as const } : {}),
      ...(parts ? { parts } : {}),
      ...(does.length ? { does } : {}),
    });
  }
  const name = typeof t.name === "string" && t.name.trim() ? t.name.trim().slice(0, 60) : "Lijst";
  const notify = cleanNotify(t.notify);
  const ledger = cleanLedger(t.ledger, fields);
  return {
    key: "bestand",
    name,
    one: typeof t.one === "string" && t.one.trim() ? t.one.trim().slice(0, 40) : null,
    icon: isIconKey(t.icon) ? t.icon : "folder",
    fields,
    ...(stock ? { stock } : {}),
    ...(ledger ? { ledger } : {}),
    kinds,
    ...(notify ? { notify } : {}),
  };
}

/** Bij het maken: "self" wordt de nieuwe lijst. */
export const withSelf = (fields: FieldDef[], id: string): FieldDef[] => fields.map((f) => (f.ref_type === SELF ? { ...f, ref_type: id } : f));
