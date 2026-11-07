import { Hono } from "hono";
import { cleanAppSettings, destinationPath, keepReachable, type AppSettings, type ListPlace, type Reach } from "../../shared/apps";
import { cleanBlocks, cleanBoards, defaultBlocks, renameBoards, type Board } from "../../shared/board";
import { appManifest, ownAppManifest } from "../../shared/manifest";
import { canEdit, type KindInfo } from "../../shared/model";
import { isValidIban, normalizeIban } from "../../shared/payment";
import { isTone, type AiState, type Person } from "../../shared/types";
import { AI_PERSON_LIMIT, aiOn, aiUsedToday } from "../ai";
import { ids, kindsFor, parseJson, seenLists } from "../access";
import type { AppEnv } from "../types";
import { asObject, NotFoundError, parseOrder, requiredString, ValidationError } from "../validate";
import { knownPeople, myLists } from "./lists";

export const me = new Hono<AppEnv>();

/** Wie je bent, je lijsten (met je rol, tags en volgorde), de tags die je ziet, en of de AI voor jou leest. */
me.get("/", async (c) => {
  const db = c.env.DB;
  const person = c.get("person");
  const [{ lists, tags }, settings, boards] = await Promise.all([myLists(db, person.id), storedSettings(db, person.id), boardsOf(db, person.id)]);
  return c.json({ person, lists, tags, ai: settings.ai, hidden: settings.hidden, boards: boards.map(({ id, name, icon }) => ({ id, name, icon })) });
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

/** Wie je kent (om toe te voegen aan een lijst, of in een veld met mensen). */
me.get("/people", async (c) => c.json(await knownPeople(c.env.DB, c.get("person").id)));

/** Je volgorde van de lijsten: { ids } in de gewenste volgorde. */
me.put("/order", async (c) => {
  const db = c.env.DB;
  const personId = c.get("person").id;
  const order = parseOrder(await c.req.json());
  const seen = await seenLists(db, personId);
  const mine = order.filter((id) => seen.has(id));
  await db.batch([
    db.prepare("DELETE FROM list_order WHERE person_id = ?").bind(personId),
    ...mine.map((id, i) => db.prepare("INSERT INTO list_order (person_id, list_id, position) VALUES (?, ?, ?)").bind(personId, id, i)),
  ]);
  return c.json({ ok: true });
});

// ---------- waar je logt ----------

/**
 * Waar je kan loggen (voor Toevoegen, de snelkoppelingen en de app): per lijst waar je lid of beheerder bent, de
 * soorten die je er kan gebruiken, en hoe vaak jij er de laatste 90 dagen iets logde (per soort) of een ding toevoegde.
 */
export type Targets = {
  lists: { id: string; name: string; one: string | null; icon: string | null; color: string | null; stock: boolean }[];
  kinds: KindInfo[];
  used: { list_id: string; kind: string; n: number; last: string }[];
};

export async function targetsFor(db: D1Database, personId: string): Promise<Targets> {
  const seen = await seenLists(db, personId);
  const editable = [...seen].filter(([, r]) => canEdit(r)).map(([id]) => id);
  const [rows, used] = (await db.batch([
    db.prepare("SELECT id, name, one, icon, color, stock IS NOT NULL AS stock FROM lists WHERE archived = 0 AND id IN (SELECT value FROM json_each(?))").bind(ids(editable)),
    db
      .prepare(
        `SELECT list_id, kind, count(*) AS n, max(created_at) AS last FROM events
         WHERE created_by = ?1 AND created_at >= datetime('now', '-90 days') GROUP BY list_id, kind
         UNION ALL
         SELECT list_id, '+ding' AS kind, count(*) AS n, max(created_at) AS last FROM things
         WHERE created_by = ?1 AND created_at >= datetime('now', '-90 days') GROUP BY list_id`,
      )
      .bind(personId),
  ])) as [D1Result<Targets["lists"][number]>, D1Result<Targets["used"][number]>];
  return {
    lists: rows.results.map((r) => ({ ...r, stock: Boolean(r.stock) })),
    kinds: await kindsFor(db, seen.keys()),
    used: used.results.filter((u) => editable.includes(u.list_id)),
  };
}

me.get("/targets", async (c) => c.json(await targetsFor(c.env.DB, c.get("person").id)));

/** Wat je het meest logt, als snelkoppeling (naam en pad). */
function often(t: Targets): { name: string; url: string }[] {
  const lists = new Map(t.lists.map((l) => [l.id, l]));
  const kinds = new Map(t.kinds.map((k) => [k.id, k]));
  return [...t.used]
    .sort((a, b) => b.n - a.n || b.last.localeCompare(a.last))
    .flatMap((u) => {
      const list = lists.get(u.list_id);
      if (!list) return [];
      if (u.kind === "+ding") return list.one ? [{ name: list.one, url: `/lijsten/${list.id}/nieuw` }] : [];
      const kind = kinds.get(u.kind);
      return kind ? [{ name: kind.name, url: `/lijsten/${list.id}/loggen?soort=${encodeURIComponent(kind.id)}` }] : [];
    });
}

// ---------- app ----------

me.get("/manifest", async (c) => {
  const db = c.env.DB;
  const personId = c.get("person").id;
  const settings = await appSettingsOf(db, personId);
  const chosen = settings.shortcuts?.map((s) => ({ name: s.name, url: destinationPath(s.to) })) ?? null;
  const list = chosen ? [] : often(await targetsFor(db, personId));
  return c.body(JSON.stringify(appManifest(list, chosen)), 200, { "content-type": "application/manifest+json" });
});

me.get("/app", async (c) => c.json(await appSettingsOf(c.env.DB, c.get("person").id)));

/** Je app-instellingen bewaren. AI, stilzetten en verbergen veranderen hier niet (PUT /me/ai, /me/muted, /me/hidden). */
me.put("/app", async (c) => {
  const db = c.env.DB;
  const personId = c.get("person").id;
  const stored = await storedSettings(db, personId);
  const raw = { ...cleanAppSettings(asObject(await c.req.json()).settings), ai: stored.ai, muted: stored.muted, hidden: stored.hidden };
  const settings = keepReachable(raw, await reachFor(db, personId));
  await saveSettings(db, personId, settings);
  return c.json(settings);
});

/** Een lijst of tag stilzetten (of niet meer): geen melding bij iets nieuws daar. */
me.put("/muted", async (c) => {
  const db = c.env.DB;
  const personId = c.get("person").id;
  const obj = asObject(await c.req.json());
  const target = typeof obj.id === "string" ? obj.id : "";
  const { lists, tags } = await myLists(db, personId);
  if (!lists.some((l) => l.id === target) && !tags.some((t) => t.id === target)) throw new NotFoundError("Die lijst of tag ken je niet.");
  const settings = await storedSettings(db, personId);
  const muted = obj.muted === true ? [...new Set([...settings.muted, target])] : settings.muted.filter((x) => x !== target);
  await saveSettings(db, personId, { ...settings, muted });
  return c.json({ muted });
});

/** Een lijst in je menu of bij de + verbergen (of weer tonen): { id, place: "menu" | "add", hidden }. */
me.put("/hidden", async (c) => {
  const db = c.env.DB;
  const personId = c.get("person").id;
  const obj = asObject(await c.req.json());
  const target = typeof obj.id === "string" ? obj.id : "";
  if (obj.place !== "menu" && obj.place !== "add") throw new ValidationError("Waar?");
  const place: ListPlace = obj.place;
  const { lists } = await myLists(db, personId);
  if (!lists.some((l) => l.id === target)) throw new NotFoundError("Die lijst ken je niet.");
  const settings = await storedSettings(db, personId);
  const now = settings.hidden[place].filter((x) => x !== target);
  const hidden = { ...settings.hidden, [place]: obj.hidden === true ? [...now, target] : now };
  await saveSettings(db, personId, { ...settings, hidden });
  return c.json({ hidden });
});

me.get("/ai", async (c) => c.json(await aiState(c.env.DB, c.get("person").id)));

me.put("/ai", async (c) => {
  const db = c.env.DB;
  const personId = c.get("person").id;
  const on = asObject(await c.req.json()).on;
  if (typeof on !== "boolean") throw new ValidationError("Aan of uit?");
  await saveSettings(db, personId, { ...(await storedSettings(db, personId)), ai: on });
  return c.json(await aiState(db, personId));
});

async function aiState(db: D1Database, personId: string): Promise<AiState> {
  const [on, used] = await Promise.all([aiOn(db, personId), aiUsedToday(db, personId)]);
  return { on, used, limit: AI_PERSON_LIMIT };
}

me.get("/apps/:appId/manifest", async (c) => {
  const app = (await appSettingsOf(c.env.DB, c.get("person").id)).apps.find((a) => a.id === c.req.param("appId"));
  if (!app) throw new NotFoundError("Die app bestaat niet (meer).");
  return c.body(JSON.stringify(ownAppManifest(app)), 200, { "content-type": "application/manifest+json" });
});

async function storedSettings(db: D1Database, personId: string): Promise<AppSettings> {
  const row = await db.prepare("SELECT app_settings FROM people WHERE id = ?").bind(personId).first<{ app_settings: string | null }>();
  return cleanAppSettings(parseJson(row?.app_settings, null));
}

async function saveSettings(db: D1Database, personId: string, settings: AppSettings) {
  await db.prepare("UPDATE people SET app_settings = ? WHERE id = ?").bind(JSON.stringify(settings), personId).run();
}

async function appSettingsOf(db: D1Database, personId: string): Promise<AppSettings> {
  return keepReachable(await storedSettings(db, personId), await reachFor(db, personId));
}

/** Wat je kan bereiken: je borden, en je lijsten met hun soorten (en of je er mag loggen). */
async function reachFor(db: D1Database, personId: string): Promise<Reach> {
  const seen = await seenLists(db, personId);
  const [{ results }, kinds, boards] = await Promise.all([
    db.prepare("SELECT id, name, one FROM lists WHERE archived = 0 AND id IN (SELECT value FROM json_each(?))").bind(ids(seen.keys())).all<{ id: string; name: string; one: string | null }>(),
    kindsFor(db, seen.keys()),
    boardsOf(db, personId),
  ]);
  const kindMap = new Map(kinds.map((k) => [k.id, k.name]));
  return {
    boards: boards.map(({ id, name, icon }) => ({ id, name, icon })),
    lists: new Map(results.map((l) => [l.id, { name: l.name, one: l.one, edit: canEdit(seen.get(l.id)), kinds: kindMap }])),
  };
}

// ---------- overzicht ----------

export async function boardsOf(db: D1Database, personId: string): Promise<Board[]> {
  const row = await db.prepare("SELECT overview FROM people WHERE id = ?").bind(personId).first<{ overview: string | null }>();
  return cleanBoards(parseJson(row?.overview, null));
}

async function saveBoards(db: D1Database, personId: string, boards: Board[]) {
  await db.prepare("UPDATE people SET overview = ? WHERE id = ?").bind(JSON.stringify({ v: 2, boards }), personId).run();
}

/** Een bord (`?board=`, anders het eerste) met zijn blokken; vanzelf als je er nog geen koos. */
me.get("/overview", async (c) => {
  const db = c.env.DB;
  const personId = c.get("person").id;
  const boards = await boardsOf(db, personId);
  const board = boards.find((b) => b.id === c.req.query("board")) ?? boards[0];
  let blocks = board.blocks;
  if (!blocks) {
    const { lists } = await myLists(db, personId);
    const seen = ids(lists.map((l) => l.id));
    const has = await db
      .prepare(
        `SELECT EXISTS (SELECT 1 FROM events WHERE amount IS NOT NULL AND list_id IN (SELECT value FROM json_each(?1))) AS money,
                EXISTS (SELECT 1 FROM lists WHERE stock IS NOT NULL AND id IN (SELECT value FROM json_each(?1))) AS stock`,
      )
      .bind(seen)
      .first<{ money: number; stock: number }>();
    blocks = defaultBlocks(lists, { money: Boolean(has?.money), stock: Boolean(has?.stock) });
  }
  return c.json({ board: board.id, boards: boards.map(({ id, name, icon }) => ({ id, name, icon })), blocks, custom: board.blocks !== null });
});

me.put("/overview", async (c) => {
  const db = c.env.DB;
  const personId = c.get("person").id;
  const body = asObject(await c.req.json());
  const boards = await boardsOf(db, personId);
  const board = boards.find((b) => b.id === body.board) ?? boards[0];
  board.blocks = cleanBlocks(body.blocks);
  await saveBoards(db, personId, boards);
  return c.json({ blocks: board.blocks });
});

me.put("/boards", async (c) => {
  const db = c.env.DB;
  const personId = c.get("person").id;
  const boards = renameBoards(await boardsOf(db, personId), asObject(await c.req.json()).boards, () => `b-${crypto.randomUUID().slice(0, 8)}`);
  await saveBoards(db, personId, boards);
  return c.json({ boards: boards.map(({ id, name, icon }) => ({ id, name, icon })) });
});
