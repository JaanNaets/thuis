import { Hono } from "hono";
import type { DefaultSplit } from "../../shared/split";
import { TONES, type HouseholdAccess, type Me, type Member } from "../../shared/types";
import { requireFull } from "../context";
import { seedStatements } from "../seed";
import type { AppEnv } from "../types";
import { asObject, requiredString, ValidationError } from "../validate";

/** "jaan.naets@…" → "Jaan". Aanpassen kan bij Instellingen → Huishouden. */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0];
  const first = local.split(/[._+-]/)[0].replace(/\d+$/, "") || local;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export function parseJson<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * De allereerste aanmelding op een lege installatie: die persoon wordt lid van het eerste huishouden.
 * Daarna komt niemand er nog vanzelf bij: een lid voegt je toe met je e-mailadres.
 */
async function bootstrap(db: D1Database, email: string): Promise<void> {
  if (await db.prepare("SELECT 1 FROM members WHERE email IS NOT NULL LIMIT 1").first()) return;
  let household = await db.prepare("SELECT id FROM households ORDER BY created_at LIMIT 1").first<{ id: string }>();
  const statements: D1PreparedStatement[] = [];
  if (!household) {
    household = { id: crypto.randomUUID() };
    statements.push(db.prepare("INSERT INTO households (id, name) VALUES (?, 'Thuis')").bind(household.id), ...seedStatements(db, household.id));
  }
  statements.push(
    db
      .prepare("INSERT INTO members (id, household_id, name, email, color, access) VALUES (?, ?, ?, ?, ?, 'full')")
      .bind(crypto.randomUUID(), household.id, nameFromEmail(email), email, TONES[0]),
  );
  await db.batch(statements);
}

type MembershipRow = Member & { h_name: string; h_default_split: string | null };

async function memberships(db: D1Database, email: string): Promise<HouseholdAccess[]> {
  const { results } = await db
    .prepare(
      `SELECT m.*, h.name AS h_name, h.default_split AS h_default_split
       FROM members m JOIN households h ON h.id = m.household_id
       WHERE m.email = ? COLLATE NOCASE
       ORDER BY h.created_at`,
    )
    .bind(email)
    .all<MembershipRow>();
  return results.map(({ h_name, h_default_split, ...member }) => ({
    id: member.household_id,
    name: h_name,
    default_split: parseJson<DefaultSplit>(h_default_split),
    member,
  }));
}

// ---------- zonder huishouden: wie ben ik, nieuw huishouden ----------

export const account = new Hono<AppEnv>();

account.get("/me", async (c) => {
  const email = c.get("user");
  await bootstrap(c.env.DB, email);
  const me: Me = { email, households: await memberships(c.env.DB, email) };
  return c.json(me);
});

/**
 * Een nieuw huishouden, met jou als eerste lid en de gewone startindeling.
 * Enkel wie al ergens volledige toegang heeft: een gast in een project maakt geen huishoudens aan.
 */
account.post("/households", async (c) => {
  const email = c.get("user");
  const name = requiredString(asObject(await c.req.json()), "name", 60);
  const db = c.env.DB;
  const owner = await db
    .prepare("SELECT name, color FROM members WHERE email = ? COLLATE NOCASE AND access = 'full' ORDER BY created_at LIMIT 1")
    .bind(email)
    .first<Pick<Member, "name" | "color">>();
  if (!owner) return c.json({ error: "Enkel wie al een huishouden beheert, kan een nieuw huishouden aanmaken." }, 403);

  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO households (id, name) VALUES (?, ?)").bind(id, name),
    db
      .prepare("INSERT INTO members (id, household_id, name, email, color, access) VALUES (?, ?, ?, ?, ?, 'full')")
      .bind(crypto.randomUUID(), id, owner.name, email, owner.color),
    ...seedStatements(db, id),
  ]);
  const created = (await memberships(db, email)).find((h) => h.id === id);
  return c.json(created, 201);
});

// ---------- het gekozen huishouden ----------

export const household = new Hono<AppEnv>();

household.use("*", requireFull);

/** Controleert een standaardverdeling: enkel leden van dit huishouden, procenten samen 100. */
export async function parseDefaultSplit(db: D1Database, householdId: string, value: unknown): Promise<DefaultSplit | null> {
  if (value === null || value === undefined) return null;
  const obj = asObject(value);
  const mode = obj.mode;
  if (mode !== "equal" && mode !== "percent" && mode !== "shares") throw new ValidationError("Onbekende verdeling");
  if (mode === "equal") return { mode, values: {} };
  const values = asObject(obj.values ?? {});
  const entries = Object.entries(values);
  if (entries.some(([, v]) => typeof v !== "number" || !Number.isFinite(v) || v < 0)) throw new ValidationError("Vul enkel positieve getallen in");
  const ids = entries.map(([id]) => id);
  if (ids.length > 0) {
    const { results } = await db
      .prepare(`SELECT id FROM members WHERE household_id = ? AND id IN (${ids.map(() => "?").join(", ")})`)
      .bind(householdId, ...ids)
      .all();
    if (results.length !== ids.length) throw new ValidationError("Iemand in de verdeling hoort niet bij dit huishouden");
  }
  const total = entries.reduce((sum, [, v]) => sum + (v as number), 0);
  if (mode === "percent" && Math.abs(total - 100) > 0.01) throw new ValidationError("De percentages moeten samen 100% zijn");
  if (total <= 0) throw new ValidationError("Geef minstens iemand een deel");
  return { mode, values: Object.fromEntries(entries) as Record<string, number> };
}

household.put("/", async (c) => {
  const obj = asObject(await c.req.json());
  const id = c.get("household");
  const split = await parseDefaultSplit(c.env.DB, id, obj.default_split);
  await c.env.DB.prepare("UPDATE households SET name = ?, default_split = ? WHERE id = ?")
    .bind(requiredString(obj, "name", 60), split ? JSON.stringify(split) : null, id)
    .run();
  return c.json((await memberships(c.env.DB, c.get("user"))).find((h) => h.id === id));
});
