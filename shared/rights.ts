// Wie wat mag, per lijst.
//
// - Iemand staat rechtstreeks bij een lijst (beheerder, lid, gast, of `geen`), of krijgt een rol via een **regel** op
//   een tag: "Jana altijd lid bij lijsten met de tag Huis". Rechtstreeks wint altijd, ook `geen` (een uitzondering).
// - Een regel geldt enkel op lijsten waar wie ze maakte rechtstreeks beheerder is: anders kon je via een tag toegang
//   geven tot de lijst van iemand anders.
// - Er blijft altijd minstens één rechtstreekse beheerder (`keepsAdmin`).
// - Een lijn `in`, `uit` of `voor` zie je ook als je de lijst van het ding ziet; `bij` enkel met de hele gebeurtenis
//   (anders zag je via de lijst met winkels en diensten elk doktersbezoek).

import { ROLE_RANK, canEdit, type DirectRole, type LineRole, type Role } from "./model.ts";

export type DirectRow = { list_id: string; person_id: string; role: DirectRole };
export type TagLink = { list_id: string; tag_id: string };
export type RuleRow = { tag_id: string; person_id: string; role: Role; created_by: string };

const higher = (a: Role | null, b: Role): Role => (!a || ROLE_RANK[b] > ROLE_RANK[a] ? b : a);

/** Een index om snel rollen op te zoeken. */
export class Roles {
  private direct = new Map<string, DirectRole>();
  private tagsOf = new Map<string, string[]>();
  private rulesOf = new Map<string, RuleRow[]>();

  constructor(direct: DirectRow[], links: TagLink[], rules: RuleRow[]) {
    for (const d of direct) this.direct.set(`${d.list_id}|${d.person_id}`, d.role);
    for (const l of links) this.tagsOf.set(l.list_id, [...(this.tagsOf.get(l.list_id) ?? []), l.tag_id]);
    for (const r of rules) this.rulesOf.set(r.tag_id, [...(this.rulesOf.get(r.tag_id) ?? []), r]);
  }

  directRole(listId: string, personId: string): DirectRole | null {
    return this.direct.get(`${listId}|${personId}`) ?? null;
  }

  /** De regel die iemand een rol geeft op een lijst (de hoogste), of null. */
  viaRule(listId: string, personId: string): { role: Role; tag_id: string } | null {
    let best: { role: Role; tag_id: string } | null = null;
    for (const tag of this.tagsOf.get(listId) ?? []) {
      for (const rule of this.rulesOf.get(tag) ?? []) {
        if (rule.person_id !== personId) continue;
        if (this.directRole(listId, rule.created_by) !== "beheerder") continue;
        if (!best || ROLE_RANK[rule.role] > ROLE_RANK[best.role]) best = { role: rule.role, tag_id: tag };
      }
    }
    return best;
  }

  /** De rol van iemand op een lijst: rechtstreeks, anders via een regel. Null = geen toegang. */
  role(listId: string, personId: string): Role | null {
    const direct = this.directRole(listId, personId);
    if (direct === "geen") return null;
    if (direct) return direct;
    return this.viaRule(listId, personId)?.role ?? null;
  }

  /**
   * Wie bij een lijst kan (rechtstreeks of via een regel), en wie er rechtstreeks uitgesloten is (`role` null,
   * `direct` geen: een uitzondering op een regel).
   */
  people(listId: string, candidates: string[]): { person_id: string; role: Role | null; direct: DirectRole | null; tag_id: string | null }[] {
    const out: { person_id: string; role: Role | null; direct: DirectRole | null; tag_id: string | null }[] = [];
    for (const person_id of new Set(candidates)) {
      const direct = this.directRole(listId, person_id);
      if (direct === "geen") {
        out.push({ person_id, role: null, direct, tag_id: null });
        continue;
      }
      if (direct) {
        out.push({ person_id, role: direct, direct, tag_id: null });
        continue;
      }
      const rule = this.viaRule(listId, person_id);
      if (rule) out.push({ person_id, role: rule.role, direct: null, tag_id: rule.tag_id });
    }
    return out;
  }
}

/** Je rollen op alle lijsten waar je bij kan (uit je rechtstreekse rijen en de regels voor jou). */
export function rolesFor(personId: string, direct: DirectRow[], links: TagLink[], rules: RuleRow[], listIds: string[]): Map<string, Role> {
  const index = new Roles(direct, links, rules);
  const out = new Map<string, Role>();
  for (const id of new Set(listIds)) {
    const role = index.role(id, personId);
    if (role) out.set(id, role);
  }
  return out;
}

/** Blijft er na deze wijziging minstens één rechtstreekse beheerder? */
export function keepsAdmin(rows: { role: DirectRole }[]): boolean {
  return rows.some((r) => r.role === "beheerder");
}

/**
 * Mag je deze lijn zien? `eventList`: je rol op de lijst van de gebeurtenis; `thingList`: op de lijst van het ding.
 * Met de gebeurtenis zie je alles; anders enkel een lijn in, uit of voor een ding dat je ziet.
 */
export function lineVisible(role: LineRole, eventList: Role | null, thingList: Role | null): boolean {
  if (eventList) return true;
  return role !== "bij" && thingList !== null;
}

/**
 * Mag je deze lijn bewaren? Erbij of eraf verandert de voorraad van het ding: daarvoor moet je de lijst van het ding
 * mogen wijzigen. Voor en bij: zien is genoeg. Een lijn zonder ding (tekst) mag altijd.
 */
export function lineAllowed(role: LineRole, thingList: Role | null | "none"): boolean {
  if (thingList === "none") return true;
  if (role === "in" || role === "uit") return canEdit(thingList);
  return thingList !== null;
}

/** De hoogste van twee rollen (of de enige). */
export const maxRole = (a: Role | null, b: Role | null): Role | null => (b ? higher(a, b) : a);
