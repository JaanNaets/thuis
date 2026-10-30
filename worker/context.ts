import { createMiddleware } from "hono/factory";
import { cleanRights, NO_RIGHTS, type Rights } from "../shared/access";
import type { FieldDef } from "../shared/fields";
import type { TotalDef } from "../shared/totals";
import type { ItemType, Person, Project, ProjectNode, Tone } from "../shared/types";
import { TONES } from "../shared/types";
import type { AppEnv } from "./types";
import { ForbiddenError, NotFoundError } from "./validate";

/**
 * Koppelt elke aanvraag aan een persoon. Wie voor het eerst aanmeldt, krijgt een persoon (zonder projecten).
 * Bestaat er al een persoon met dit e-mailadres (iemand voegde je toe), dan ben je die persoon.
 */
export const withPerson = createMiddleware<AppEnv>(async (c, next) => {
  const email = c.get("user").trim().toLowerCase();
  const db = c.env.DB;
  let person = await db.prepare("SELECT id, name, email, color FROM people WHERE email = ?").bind(email).first<Person>();
  if (!person) {
    const name =
      email
        .split("@")[0]
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (ch) => ch.toUpperCase())
        .slice(0, 60) || "Ik";
    const color = TONES[Math.floor(Math.random() * TONES.length)] as Tone;
    person = await db
      .prepare(
        "INSERT INTO people (id, name, email, color) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO UPDATE SET email = email RETURNING id, name, email, color",
      )
      .bind(crypto.randomUUID(), name, email, color)
      .first<Person>();
  }
  c.set("person", person!);
  return next();
});

type ProjectRow = Project & { created_by: string };
type RoleRow = { id: string; name: string; rights: string };

/** Wat een persoon in één project mag, met de projecten erboven. */
export type ProjectAccess = {
  project: ProjectRow;
  /** Het project zelf en alles erboven, van onder naar boven (ook wat je zelf niet mag zien). */
  chain: string[];
  /** De projecten erboven die je mag zien, van boven naar onder. */
  path: { id: string; name: string }[];
  role: { id: string; name: string };
  rights: Rights;
  /** De rol komt van een project erboven. */
  inherited: boolean;
};

export function parseRights(json: string | null | undefined): Rights {
  if (!json) return NO_RIGHTS;
  try {
    return cleanRights(JSON.parse(json));
  } catch {
    return NO_RIGHTS;
  }
}

/**
 * Wat deze persoon in dit project mag: de rol van het dichtstbijzijnde project (het project zelf of erboven)
 * waar de persoon lid is. Geen lidmaatschap = geen toegang (null). Faalt gesloten.
 */
export async function projectAccess(db: D1Database, personId: string, projectId: string): Promise<ProjectAccess | null> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE up(id, depth) AS (
         SELECT id, 0 FROM projects WHERE id = ?1
         UNION ALL
         SELECT p.parent_id, up.depth + 1 FROM projects p JOIN up ON p.id = up.id WHERE p.parent_id IS NOT NULL AND up.depth < 30
       )
       SELECT p.*, up.depth, m.role_id, r.name AS role_name, r.rights
       FROM up JOIN projects p ON p.id = up.id
       LEFT JOIN memberships m ON m.project_id = p.id AND m.person_id = ?2
       LEFT JOIN roles r ON r.id = m.role_id
       ORDER BY up.depth`,
    )
    .bind(projectId, personId)
    .all<ProjectRow & { depth: number; role_id: string | null; role_name: string | null; rights: string | null }>();
  const nearest = results.find((r) => r.role_id);
  if (!nearest) return null;
  // Je ziet de projecten erboven tot het hoogste project waar je lid bent.
  const top = Math.max(...results.filter((r) => r.role_id).map((r) => r.depth));
  const { depth: _d, role_id: _r, role_name: _n, rights: _x, ...project } = results[0];
  return {
    project,
    chain: results.map((r) => r.id),
    path: results
      .filter((r) => r.depth > 0 && r.depth <= top)
      .reverse()
      .map((r) => ({ id: r.id, name: r.name })),
    role: { id: nearest.role_id!, name: nearest.role_name! },
    rights: parseRights(nearest.rights),
    inherited: nearest.depth > 0,
  };
}

/** Zoals projectAccess, maar gooit "niet gevonden" als je er niet bij mag (we verklappen niet of het bestaat). */
export async function requireProject(db: D1Database, personId: string, projectId: string): Promise<ProjectAccess> {
  const access = await projectAccess(db, personId, projectId);
  if (!access) throw new NotFoundError("Dat project bestaat niet (meer), of je hebt er geen toegang toe.");
  return access;
}

/** Gooit "geen toestemming" als een recht ontbreekt. */
export function need(access: ProjectAccess, right: "manage" | "members" | "create" | "delete", message?: string) {
  if (!access.rights[right]) throw new ForbiddenError(message ?? "Dat mag je in dit project niet.");
}

/**
 * Al je projecten met je rol erin: de projecten waar je lid bent en alles eronder. In een subproject waar je
 * een eigen rol hebt, geldt die rol.
 */
export async function accessibleProjects(db: D1Database, personId: string): Promise<ProjectNode[]> {
  const [{ results: memberships }, { results: projects }] = (await db.batch([
    db
      .prepare(
        "SELECT m.project_id, m.role_id, m.sort_order, r.name AS role_name, r.rights FROM memberships m JOIN roles r ON r.id = m.role_id WHERE m.person_id = ?",
      )
      .bind(personId),
    db
      .prepare(
        `WITH RECURSIVE down(id, depth) AS (
           SELECT project_id, 0 FROM memberships WHERE person_id = ?1
           UNION
           SELECT p.id, down.depth + 1 FROM projects p JOIN down ON p.parent_id = down.id WHERE down.depth < 30
         )
         SELECT DISTINCT p.* FROM projects p JOIN down ON down.id = p.id`,
      )
      .bind(personId),
  ])) as [D1Result<{ project_id: string; role_id: string; sort_order: number; role_name: string; rights: string }>, D1Result<ProjectRow>];
  const byId = new Map(projects.map((p) => [p.id, p]));
  const own = new Map(memberships.map((m) => [m.project_id, m]));
  const nodes: ProjectNode[] = [];
  for (const p of projects) {
    // De dichtstbijzijnde rol: het project zelf, anders erboven.
    let cursor: ProjectRow | undefined = p;
    let membership = own.get(p.id);
    const seen = new Set<string>();
    while (!membership && cursor?.parent_id && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      cursor = byId.get(cursor.parent_id);
      membership = cursor ? own.get(cursor.id) : undefined;
    }
    if (!membership) continue;
    const { created_by: _c, ...project } = p;
    // Bovenaan (de ouder zie je niet): jouw eigen volgorde, van je lidmaatschap.
    const top = !p.parent_id || !byId.has(p.parent_id);
    nodes.push({
      ...project,
      sort_order: top && own.has(p.id) ? own.get(p.id)!.sort_order : p.sort_order,
      role_id: membership.role_id,
      role_name: membership.role_name,
      rights: parseRights(membership.rights),
      inherited: membership.project_id !== p.id,
    });
  }
  return nodes;
}

export type TypeRow = Omit<ItemType, "fields" | "totals"> & { fields: string; totals?: string };

function parseList<T>(json: string | undefined): T[] {
  try {
    const value = JSON.parse(json ?? "[]");
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

export function toItemType(row: TypeRow): ItemType {
  // De kolom rules (van voor de totalen, zie migratie 0013) gaat niet mee.
  const { rules: _rules, ...rest } = row as TypeRow & { rules?: unknown };
  return { ...rest, fields: parseList<FieldDef>(row.fields), totals: parseList<TotalDef>(row.totals) };
}

/** De lijsten die in een project te gebruiken zijn: die van het project zelf en erboven. */
export async function typesFor(db: D1Database, chain: string[]): Promise<ItemType[]> {
  const { results } = await db
    .prepare(`SELECT * FROM item_types WHERE project_id IN (${chain.map(() => "?").join(", ")}) ORDER BY sort_order, created_at`)
    .bind(...chain)
    .all<TypeRow>();
  // Eerst de lijsten van het project zelf, dan die erboven.
  return results.map(toItemType).sort((a, b) => chain.indexOf(a.project_id) - chain.indexOf(b.project_id));
}

export function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

export type { RoleRow };
