import { Hono } from "hono";
import { canCreate, typeAccess } from "../../shared/access";
import type { IconKey } from "../../shared/templates";
import { isTone, type AiState, type Me, type Overview, type Person } from "../../shared/types";
import { blockProjects, cleanBlocks, cleanBoards, defaultBlocks, renameBoards, type Board } from "../../shared/overview";
import { MAX_TARGETS, rankTargets, type AddTarget } from "../../shared/quickadd";
import type { FieldDef } from "../../shared/fields";
import { receiptPlan } from "../../shared/receipt";
import { appManifest, ownAppManifest } from "../../shared/manifest";
import { cleanAppSettings, destinationPath, keepReachable, type AppSettings, type Reach } from "../../shared/apps";
import { flattenTree } from "../../shared/tree";
import { isValidIban, normalizeIban } from "../../shared/payment";
import { accessibleProjects } from "../context";
import { AI_PERSON_LIMIT, aiOn, aiUsedToday } from "../ai";
import type { AppEnv } from "../types";
import { asObject, NotFoundError, parseOrder, requiredString, ValidationError } from "../validate";

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
    let fields: FieldDef[] = [];
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
      receipt: receiptPlan(fields, t.id, () => undefined) !== null,
    });
  }
  return rankTargets(out).slice(0, MAX_TARGETS);
}

/**
 * Het manifest van de app (zie shared/manifest.ts): je eigen snelkoppelingen (enkel wat je nog bereikt), of vanzelf je
 * meestgebruikte lijsten.
 */
me.get("/manifest", async (c) => {
  const db = c.env.DB;
  const personId = c.get("person").id;
  const settings = await appSettingsOf(db, personId);
  const chosen = settings.shortcuts?.map((s) => ({ name: s.name, url: destinationPath(s.to) })) ?? null;
  const targets = chosen ? [] : await addTargets(db, personId);
  return c.body(JSON.stringify(appManifest(targets, chosen)), 200, { "content-type": "application/manifest+json" });
});

/** Je app-instellingen (zie shared/apps.ts): apps, snelkoppelingen en wat er met een gedeelde foto gebeurt. */
me.get("/app", async (c) => c.json(await appSettingsOf(c.env.DB, c.get("person").id)));

/**
 * Je app-instellingen bewaren: nagekeken, en enkel wat je kan bereiken (een nieuwe app krijgt een id). AI aan of uit
 * verandert hier niet (dat doet PUT /me/ai), zodat een oudere kopie van je instellingen ze niet terugzet.
 */
me.put("/app", async (c) => {
  const db = c.env.DB;
  const personId = c.get("person").id;
  const row = await db.prepare("SELECT app_settings FROM people WHERE id = ?").bind(personId).first<{ app_settings: string | null }>();
  const stored = cleanAppSettings(parseJson(row?.app_settings));
  const raw = { ...cleanAppSettings(asObject(await c.req.json()).settings), ai: stored.ai, muted: stored.muted };
  const settings = keepReachable(raw, await reachFor(db, personId, raw));
  await db.prepare("UPDATE people SET app_settings = ? WHERE id = ?").bind(JSON.stringify(settings), personId).run();
  return c.json(settings);
});

/**
 * Een project stilzetten (of niet meer): geen melding bij een nieuw item daar, ook niet in de subprojecten. Enkel een
 * project waar je in zit.
 */
me.put("/muted", async (c) => {
  const db = c.env.DB;
  const personId = c.get("person").id;
  const obj = asObject(await c.req.json());
  const project = typeof obj.project === "string" ? obj.project : "";
  if (!(await accessibleProjects(db, personId)).some((p) => p.id === project)) throw new NotFoundError("Dat project bestaat niet.");
  const row = await db.prepare("SELECT app_settings FROM people WHERE id = ?").bind(personId).first<{ app_settings: string | null }>();
  const settings = cleanAppSettings(parseJson(row?.app_settings));
  const muted = obj.muted === true ? [...new Set([...settings.muted, project])] : settings.muted.filter((id) => id !== project);
  await db.prepare("UPDATE people SET app_settings = ? WHERE id = ?").bind(JSON.stringify({ ...settings, muted }), personId).run();
  return c.json({ muted });
});

/** Lezen met AI: aan of uit voor jou, en hoe vaak je de AI vandaag liet lezen. */
me.get("/ai", async (c) => c.json(await aiState(c.env.DB, c.get("person").id)));

/** Lezen met AI aan- of uitzetten (enkel voor jezelf). Uit: de server weigert elke AI-vraag van jou. */
me.put("/ai", async (c) => {
  const db = c.env.DB;
  const personId = c.get("person").id;
  const on = asObject(await c.req.json()).on;
  if (typeof on !== "boolean") throw new ValidationError("Aan of uit?");
  const row = await db.prepare("SELECT app_settings FROM people WHERE id = ?").bind(personId).first<{ app_settings: string | null }>();
  const settings = { ...cleanAppSettings(parseJson(row?.app_settings)), ai: on };
  await db.prepare("UPDATE people SET app_settings = ? WHERE id = ?").bind(JSON.stringify(settings), personId).run();
  return c.json(await aiState(db, personId));
});

async function aiState(db: D1Database, personId: string): Promise<AiState> {
  const [on, used] = await Promise.all([aiOn(db, personId), aiUsedToday(db, personId)]);
  return { on, used, limit: AI_PERSON_LIMIT };
}

/** Het manifest van één eigen app (een eigen icoon op je beginscherm); 404 als ze er niet (meer) is. */
me.get("/apps/:appId/manifest", async (c) => {
  const app = (await appSettingsOf(c.env.DB, c.get("person").id)).apps.find((a) => a.id === c.req.param("appId"));
  if (!app) throw new NotFoundError("Die app bestaat niet (meer).");
  return c.body(JSON.stringify(ownAppManifest(app)), 200, { "content-type": "application/manifest+json" });
});

/** Je app-instellingen zoals ze nu gelden: wat je niet meer kan bereiken, valt weg. */
async function appSettingsOf(db: D1Database, personId: string): Promise<AppSettings> {
  const row = await db.prepare("SELECT app_settings FROM people WHERE id = ?").bind(personId).first<{ app_settings: string | null }>();
  const raw = cleanAppSettings(parseJson(row?.app_settings));
  return keepReachable(raw, await reachFor(db, personId, raw));
}

/**
 * Wat je kan bereiken voor deze instellingen: je overzichten, en voor de projecten waarnaar ze verwijzen de lijsten
 * die je er ziet (ook van erboven) en of je er iets mag toevoegen. Enkel die projecten, ook bij 1000 projecten.
 */
async function reachFor(db: D1Database, personId: string, s: AppSettings): Promise<Reach> {
  const all = [...s.apps.map((a) => a.to), ...(s.shortcuts ?? []).map((x) => x.to), ...(s.share.kind === "receipt" ? [{ kind: "list" as const, project: s.share.project, list: s.share.list }] : [])];
  const wanted = new Set(all.flatMap((d) => ("project" in d ? [d.project] : [])));
  const boards = all.some((d) => d.kind === "board") ? (await boardsOf(db, personId)).map(({ id, name }) => ({ id, name })) : [];
  const reach: Reach = { boards, projects: new Map() };
  if (!wanted.size) return reach;
  const nodes = (await accessibleProjects(db, personId)).filter((n) => !n.archived);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chainOf = (id: string) => {
    const chain: string[] = [];
    for (let n = byId.get(id); n && !chain.includes(n.id); n = n.parent_id ? byId.get(n.parent_id) : undefined) chain.push(n.id);
    return chain;
  };
  const chains = new Map([...wanted].filter((id) => byId.has(id)).map((id) => [id, chainOf(id)]));
  const ids = JSON.stringify([...new Set([...chains.values()].flat())]);
  const { results } = await db
    .prepare("SELECT id, project_id, name, plural FROM item_types WHERE project_id IN (SELECT value FROM json_each(?))")
    .bind(ids)
    .all<{ id: string; project_id: string; name: string; plural: string }>();
  for (const [id, chain] of chains) {
    const node = byId.get(id)!;
    const lists = new Map(
      results
        .filter((t) => chain.includes(t.project_id) && typeAccess(node.rights, t.id) !== "none")
        .map((t) => [t.id, { name: t.name, plural: t.plural, create: canCreate(node.rights, t.id) }]),
    );
    reach.projects.set(id, { name: node.name, lists });
  }
  return reach;
}

/** Wie je bent en al je projecten, met je rol in elk. */
me.get("/", async (c) => {
  const person = c.get("person");
  const [projects, ai] = await Promise.all([accessibleProjects(c.env.DB, person.id), aiOn(c.env.DB, person.id)]);
  const result: Me = { person, projects, ai };
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
