import { Hono } from "hono";
import { canCreate, typeAccess } from "../../shared/access";
import type { IconKey } from "../../shared/templates";
import { isTone, type Me, type Overview, type Person } from "../../shared/types";
import { blockProjects, cleanBlocks, cleanBoards, defaultBlocks, renameBoards, type Board } from "../../shared/overview";
import { MAX_TARGETS, rankTargets, type AddTarget } from "../../shared/quickadd";
import { appManifest } from "../../shared/manifest";
import { flattenTree } from "../../shared/tree";
import { isValidIban, normalizeIban } from "../../shared/payment";
import { accessibleProjects } from "../context";
import type { AppEnv } from "../types";
import { asObject, parseOrder, requiredString, ValidationError } from "../validate";

export const me = new Hono<AppEnv>();

const parseJson = (text: string | null | undefined): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

/**
 * Wat op je overzicht staat (zie shared/overview.ts): enkel ids, nagekeken. null = vanzelf. Wat erin staat, haalt de
 * app op met jouw rechten, dus een blok over iets dat je niet ziet, blijft gewoon weg.
 */
me.put("/overview", async (c) => {
  const body = asObject(await c.req.json());
  const blocks = cleanBlocks(body.blocks);
  const boards = await boardsOf(c.env.DB, c.get("person").id);
  const board = boards.find((b) => b.id === body.board) ?? boards[0];
  board.blocks = blocks;
  await saveBoards(c.env.DB, c.get("person").id, boards);
  return c.json({ blocks });
});

/**
 * Je overzichten hernoemen, schikken, toevoegen (zonder id) of weghalen (er niet meer bij); er blijft er altijd één.
 * Geeft de nieuwe namen en volgorde.
 */
me.put("/boards", async (c) => {
  const db = c.env.DB;
  const personId = c.get("person").id;
  const boards = renameBoards(await boardsOf(db, personId), asObject(await c.req.json()).boards, () => `b-${crypto.randomUUID().slice(0, 8)}`);
  await saveBoards(db, personId, boards);
  return c.json({ boards: boards.map(({ id, name }) => ({ id, name })) });
});

async function boardsOf(db: D1Database, personId: string): Promise<Board[]> {
  const row = await db.prepare("SELECT overview FROM people WHERE id = ?").bind(personId).first<{ overview: string | null }>();
  return cleanBoards(parseJson(row?.overview));
}

async function saveBoards(db: D1Database, personId: string, boards: Board[]) {
  await db.prepare("UPDATE people SET overview = ? WHERE id = ?").bind(JSON.stringify({ boards }), personId).run();
}

/**
 * De lijsten waarin je iets kan toevoegen, over al je projecten (voor Toevoegen en de snelkoppelingen): elke lijst in
 * haar eigen project, en waar jij er de laatste 90 dagen iets in zette (ook in een subproject), met hoe vaak. De
 * meestgebruikte eerst, hoogstens MAX_TARGETS.
 */
me.get("/lists", async (c) => {
  return c.json(await addTargets(c.env.DB, c.get("person").id));
});

export async function addTargets(db: D1Database, personId: string): Promise<AddTarget[]> {
  const nodes = (await accessibleProjects(db, personId)).filter((n) => !n.archived);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = JSON.stringify(nodes.map((n) => n.id));
  const [types, used] = (await db.batch([
    db
      .prepare(
        `SELECT id, project_id, name, plural, icon, fields FROM item_types
         WHERE project_id IN (SELECT value FROM json_each(?1))
            OR id IN (SELECT type_id FROM items WHERE created_by = ?2 AND created_at >= datetime('now', '-90 days')
                      AND project_id IN (SELECT value FROM json_each(?1)))`,
      )
      .bind(ids, personId),
    db
      .prepare(
        `SELECT project_id, type_id, COUNT(*) AS n, MAX(created_at) AS last FROM items
         WHERE created_by = ?2 AND created_at >= datetime('now', '-90 days') AND project_id IN (SELECT value FROM json_each(?1))
         GROUP BY project_id, type_id`,
      )
      .bind(ids, personId),
  ])) as [D1Result<{ id: string; project_id: string; name: string; plural: string; icon: string | null; fields: string }>, D1Result<{ project_id: string; type_id: string; n: number; last: string }>];
  const typeById = new Map(types.results.map((t) => [t.id, t]));
  const pairs = new Map<string, { project: string; type: string; n: number; last: string | null }>();
  for (const t of types.results) pairs.set(`${t.project_id}/${t.id}`, { project: t.project_id, type: t.id, n: 0, last: null });
  for (const u of used.results) pairs.set(`${u.project_id}/${u.type_id}`, { project: u.project_id, type: u.type_id, n: u.n, last: u.last });
  const out: AddTarget[] = [];
  for (const { project, type, n, last } of pairs.values()) {
    const node = byId.get(project);
    const t = typeById.get(type);
    if (!node || !t || !canCreate(node.rights, t.id)) continue;
    let fields: { type?: string; counter?: boolean }[] = [];
    try {
      fields = JSON.parse(t.fields);
    } catch {
      // Een lijst zonder leesbare velden telt geen voorraad.
    }
    out.push({
      project_id: project,
      project_name: node.name,
      type_id: t.id,
      name: t.name,
      plural: t.plural,
      icon: t.icon,
      used: n,
      last,
      counter: fields.some((f) => f.type === "number" && f.counter),
    });
  }
  return rankTargets(out).slice(0, MAX_TARGETS);
}

/** Het manifest van de app, met jouw meestgebruikte lijsten als snelkoppeling (zie shared/manifest.ts). */
me.get("/manifest", async (c) => {
  const targets = await addTargets(c.env.DB, c.get("person").id);
  return c.body(JSON.stringify(appManifest(targets)), 200, { "content-type": "application/manifest+json" });
});

/** Wie je bent en al je projecten, met je rol in elk. */
me.get("/", async (c) => {
  const person = c.get("person");
  const result: Me = { person, projects: await accessibleProjects(c.env.DB, person.id) };
  return c.json(result);
});

/** Je eigen naam, kleur en rekeningnummer. Je e-mailadres komt van je aanmelding en verandert hier niet. */
me.put("/", async (c) => {
  const obj = asObject(await c.req.json());
  const color = obj.color ?? null;
  if (color !== null && !isTone(color)) throw new ValidationError("Onbekende kleur");
  const raw = typeof obj.iban === "string" ? obj.iban.trim() : "";
  if (raw && !isValidIban(raw)) throw new ValidationError("Dat rekeningnummer klopt niet. Kijk het IBAN na (bv. BE68 5390 0754 7034).");
  const updated = await c.env.DB.prepare("UPDATE people SET name = ?, color = ?, iban = ? WHERE id = ? RETURNING id, name, email, color, iban")
    .bind(requiredString(obj, "name", 60), color, raw ? normalizeIban(raw) : null, c.get("person").id)
    .first<Person>();
  return c.json(updated);
});

/** Jouw volgorde van de projecten bovenaan je overzicht. Raakt enkel je eigen lidmaatschappen. */
me.put("/order", async (c) => {
  const ids = parseOrder(await c.req.json());
  const db = c.env.DB;
  const personId = c.get("person").id;
  await db.batch(
    ids.map((id, i) => db.prepare("UPDATE memberships SET sort_order = ? WHERE person_id = ? AND project_id = ?").bind((i + 1) * 10, personId, id)),
  );
  return c.json({ ok: true });
});

/**
 * Je overzicht: je blokken (of vanzelf, zie `defaultBlocks`), en voor de projecten die ze tonen de lijsten van dat
 * project zelf en die van erboven waar hier items in zitten, met het aantal. `?projects=a,b`: enkel voor die projecten
 * (een blok dat je net toevoegde). Een lijst die je niet mag zien, staat er niet (ook niet als aantal).
 */
me.get("/overview", async (c) => {
  const db = c.env.DB;
  const personId = c.get("person").id;
  const [all, mine] = await Promise.all([
    accessibleProjects(db, personId),
    db.prepare("SELECT overview FROM people WHERE id = ?").bind(personId).first<{ overview: string | null }>(),
  ]);
  const live = all.filter((n) => !n.archived);
  // ?board=: welk overzicht (anders het eerste).
  const boards = cleanBoards(parseJson(mine?.overview));
  const board = boards.find((b) => b.id === c.req.query("board")) ?? boards[0];
  const blocks = board.blocks;
  const asked = c.req.query("projects")?.split(",").filter(Boolean).slice(0, 60);
  const wanted = new Set(asked ?? blockProjects(blocks ?? defaultBlocks(flattenTree(live))));
  const nodes = live.filter((n) => wanted.has(n.id));
  const ids = JSON.stringify(nodes.map((n) => n.id));
  const [types, counts, shownRows] = (await db.batch([
    db
      .prepare(
        `SELECT id, project_id, name, plural, icon FROM item_types
         WHERE project_id IN (SELECT value FROM json_each(?1))
            OR id IN (SELECT type_id FROM items WHERE archived = 0 AND project_id IN (SELECT value FROM json_each(?1)))
            OR id IN (SELECT type_id FROM shown_lists WHERE project_id IN (SELECT value FROM json_each(?1)))
         ORDER BY sort_order, created_at`,
      )
      .bind(ids),
    db
      .prepare(
        `SELECT project_id, type_id, COUNT(*) AS n FROM items
         WHERE archived = 0 AND project_id IN (SELECT value FROM json_each(?)) GROUP BY project_id, type_id`,
      )
      .bind(ids),
    db.prepare("SELECT project_id, type_id FROM shown_lists WHERE project_id IN (SELECT value FROM json_each(?))").bind(ids),
  ])) as [
    D1Result<{ id: string; project_id: string; name: string; plural: string; icon: IconKey | null }>,
    D1Result<{ project_id: string; type_id: string; n: number }>,
    D1Result<{ project_id: string; type_id: string }>,
  ];
  const count = new Map(counts.results.map((r) => [`${r.project_id}/${r.type_id}`, r.n]));
  // Lijsten van erboven die een subproject zelf koos (zie PUT /projects/:id/shown).
  const shown = new Set(shownRows.results.map((r) => `${r.project_id}/${r.type_id}`));
  const result: Overview = {
    boards: boards.map(({ id, name }) => ({ id, name })),
    board: board.id,
    blocks,
    projects: nodes.map((n) => ({
      id: n.id,
      types: types.results
        .filter((t) => (t.project_id === n.id || count.has(`${n.id}/${t.id}`) || shown.has(`${n.id}/${t.id}`)) && typeAccess(n.rights, t.id) !== "none")
        // Eerst de eigen lijsten, dan die van erboven (elk in hun volgorde).
        .sort((a, b) => Number(b.project_id === n.id) - Number(a.project_id === n.id))
        .map((t) => ({
          id: t.id,
          name: t.name,
          plural: t.plural,
          icon: t.icon,
          count: count.get(`${n.id}/${t.id}`) ?? 0,
          can_create: canCreate(n.rights, t.id),
        })),
    })),
  };
  return c.json(result);
});
