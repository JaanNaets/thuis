// Workers AI: een foto lezen (etiket, typeplaatje). Met een harde daglimiet, ver onder de gratis hoeveelheid, en enkel
// voor wie de AI niet uitzette (Jouw gegevens → AI).

import { aiAllowed } from "../shared/apps";

// Goedkoop en goed in tekst op foto's, ook in het Nederlands. ±20-30 neurons per foto;
// de gratis hoeveelheid van Workers AI is 10.000 neurons per dag.
export const MODEL = "@cf/google/gemma-4-26b-a4b-it";

const AI_DAILY_LIMIT = 50;
/** Per persoon, zodat niemand de foto's van een ander opgebruikt. */
export const AI_PERSON_LIMIT = 25;

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const AI_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Mag de AI voor deze persoon lezen? (Uit in Jouw gegevens → AI: dan nooit.) */
export async function aiOn(db: D1Database, personId: string): Promise<boolean> {
  const row = await db.prepare("SELECT app_settings FROM people WHERE id = ?").bind(personId).first<{ app_settings: string | null }>();
  try {
    return aiAllowed(row?.app_settings ? JSON.parse(row.app_settings) : null);
  } catch {
    return true;
  }
}

/** Hoe vaak je de AI vandaag liet lezen (hoogstens je daglimiet; de dag is een UTC-dag, zoals de limiet). */
export async function aiUsedToday(db: D1Database, personId: string): Promise<number> {
  const row = await db
    .prepare("SELECT calls FROM ai_usage_people WHERE day = date('now') AND person_id = ?")
    .bind(personId)
    .first<{ calls: number }>();
  return Math.min(row?.calls ?? 0, AI_PERSON_LIMIT);
}

/**
 * Telt een AI-oproep; zegt waarom het niet mag als de AI voor jou uit staat, of wat er op is als een daglimiet
 * bereikt is (voor iedereen samen, of voor jou). Uit telt niet mee.
 */
export async function useAiBudget(env: Env, personId: string): Promise<string | null> {
  if (!(await aiOn(env.DB, personId))) return "Lezen met AI staat voor jou uit.";
  const [all, mine] = (await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ai_usage (day, calls) VALUES (date('now'), 1)
       ON CONFLICT (day) DO UPDATE SET calls = calls + 1
       RETURNING calls`,
    ),
    env.DB.prepare(
      `INSERT INTO ai_usage_people (day, person_id, calls) VALUES (date('now'), ?1, 1)
       ON CONFLICT (day, person_id) DO UPDATE SET calls = calls + 1
       RETURNING calls`,
    ).bind(personId),
  ])) as D1Result<{ calls: number }>[];
  if ((mine.results[0]?.calls ?? Infinity) > AI_PERSON_LIMIT) return `Je hebt vandaag al ${AI_PERSON_LIMIT} keer laten lezen. Vul het zelf in.`;
  if ((all.results[0]?.calls ?? Infinity) > AI_DAILY_LIMIT) return "De daglimiet voor automatisch lezen is bereikt. Vul het zelf in.";
  return null;
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, ""));
  } catch {
    return null;
  }
}

export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // In stukken, anders wordt de argumentenlijst van fromCharCode te lang.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
