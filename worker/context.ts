import { createMiddleware } from "hono/factory";
import type { Member } from "../shared/types";
import type { AppEnv } from "./types";
import { ValidationError } from "./validate";

/**
 * Koppelt elke aanvraag aan een huishouden en aan het lid dat ze doet. Faalt gesloten:
 * wie geen lid is van het gevraagde huishouden, krijgt niets.
 *
 * De app stuurt het gekozen huishouden mee als ?hh= (zo werkt het ook voor afbeeldingen en de offline kopie)
 * of in de header X-Household. Zonder keuze nemen we het eerste huishouden waar je volledige toegang hebt
 * (of anders het eerste waar je lid van bent).
 */
export const withHousehold = createMiddleware<AppEnv>(async (c, next) => {
  const email = c.get("user");
  const requested = c.req.query("hh") || c.req.header("x-household");
  const db = c.env.DB;
  const member = requested
    ? await db.prepare("SELECT * FROM members WHERE household_id = ? AND email = ? COLLATE NOCASE").bind(requested, email).first<Member>()
    : await db.prepare("SELECT * FROM members WHERE email = ? COLLATE NOCASE ORDER BY access = 'full' DESC, created_at LIMIT 1").bind(email).first<Member>();
  if (!member) return c.json({ error: "Je hebt geen toegang tot dit huishouden." }, 403);

  c.set("household", member.household_id);
  c.set("member", member);
  c.set("full", member.access === "full");
  return next();
});

/** Enkel voor wie alles in het huishouden mag zien (niet voor gasten in een project). */
export const requireFull = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("full")) return c.json({ error: "Hiervoor heb je geen toegang." }, 403);
  return next();
});

type Owned = "members" | "categories" | "locations" | "tags" | "vendors" | "projects" | "pots" | "items" | "purchases";

/**
 * Controleert dat id's waarnaar je verwijst bij dit huishouden horen. Een foreign key controleert enkel
 * dat iets bestaat; zonder deze controle zou je naar iets van een ander huishouden kunnen verwijzen.
 */
export async function assertOwned(db: D1Database, household: string, table: Owned, ids: (string | null | undefined)[]): Promise<void> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return;
  const { results } = await db
    .prepare(`SELECT id FROM ${table} WHERE household_id = ? AND id IN (${wanted.map(() => "?").join(", ")})`)
    .bind(household, ...wanted)
    .all<{ id: string }>();
  if (results.length !== wanted.length) throw new ValidationError("Iets waarnaar je verwijst, bestaat niet (meer). Herlaad de pagina.");
}

/**
 * Mag dit lid aan een project (of, zonder project, aan het huishouden)?
 * Gasten mogen enkel in projecten waarin ze zitten; volledige leden overal in hun huishouden.
 */
export async function canUseProject(db: D1Database, household: string, member: Member, projectId: string | null): Promise<boolean> {
  if (!projectId) return member.access === "full";
  if (member.access === "full") {
    return Boolean(await db.prepare("SELECT 1 FROM projects WHERE id = ? AND household_id = ?").bind(projectId, household).first());
  }
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM project_members pm JOIN projects p ON p.id = pm.project_id
         WHERE pm.project_id = ? AND pm.member_id = ? AND p.household_id = ?`,
      )
      .bind(projectId, member.id, household)
      .first(),
  );
}
