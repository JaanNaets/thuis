// Een kasticket lezen (✨): POST /lists/:id/events/read-receipt leest de foto met de AI en koppelt elke lijn aan een
// ding uit een voorraad die de lezer ziet (zie shared/receipt.ts), en de winkel aan een ding dat hij ziet. Bewaart
// niets: het formulier toont het als één aankoop om na te kijken. POST /things/:id/alias onthoudt de naam op het
// ticket bij het ding (een tekstveld met `aliases`, enkel als je in die lijst mag wijzigen).

import { Hono } from "hono";
import type { Attributes, FieldDef } from "../../shared/fields";
import { canEdit, type ThingRef } from "../../shared/model";
import { aliasesOf, matchName, readLines, validDate, cents, withAlias, type Candidate } from "../../shared/receipt";
import { measureFor, type StockDef } from "../../shared/stock";
import { AI_IMAGE_TYPES, MAX_IMAGE_BYTES, MODEL, safeJson, toBase64, useAiBudget } from "../ai";
import { ids, needEdit, parseJson, requireList, requireThing, seenLists } from "../access";
import { brusselsToday } from "../today";
import type { AppEnv } from "../types";
import { asObject, requiredString, ValidationError } from "../validate";

export const listReceipt = new Hono<AppEnv>();
export const thingAlias = new Hono<AppEnv>();

type Read = {
  store: ThingRef | null;
  store_text: string | null;
  date: string | null;
  total: number | null;
  lines: { name: string; thing: ThingRef | null; amount: number; unit: string | null; price: number | null }[];
  message?: string;
};

const PROMPT = `Je leest een kasticket, lijn per lijn. Geef:
- store: de naam van de winkel (bv. "Colruyt", "Delhaize"), zonder adres
- date: de datum van aankoop als JJJJ-MM-DD, anders leeg
- total: het totaal dat betaald werd, in euro (0 als je het niet ziet)
- lines: elke gekochte lijn, met
  - name: de productnaam zoals op het ticket (zonder prijs, code of gewicht)
  - quantity: het aantal stuks (1 als er geen aantal staat, ook bij iets dat per gewicht verkocht wordt)
  - size: het gewicht of de inhoud als die op de lijn staat (bv. "5 kg", "500 g", "1,5 l", "6x33 cl"), anders leeg
  - price: wat de hele lijn kost in euro (aantal × stukprijs); staat er een korting direct onder, trek die ervan af
Sla totalen, tussentotalen, statiegeld, zakjes, spaarpunten en betaalgegevens over. Geef enkel wat je echt ziet.`;

listReceipt.post("/:id/events/read-receipt", async (c) => {
  const db = c.env.DB;
  const me = c.get("person").id;
  const { role } = await requireList(db, me, c.req.param("id"));
  needEdit(role);
  const form = await c.req.formData();
  const image = form.get("image");
  const none: Read = { store: null, store_text: null, date: null, total: null, lines: [] };
  if (!(image instanceof File)) throw new ValidationError("Geen foto ontvangen");
  if (!AI_IMAGE_TYPES.includes(image.type) || image.size > MAX_IMAGE_BYTES) return c.json({ ...none, message: "Deze foto kan niet gelezen worden." });
  const limit = await useAiBudget(c.env, me);
  if (limit) return c.json({ ...none, message: limit });

  let parsed: { store?: unknown; date?: unknown; total?: unknown; lines?: unknown } = {};
  try {
    const result = await c.env.AI.run(MODEL, {
      messages: [
        { role: "system", content: PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Lees dit kasticket." },
            { type: "image_url", image_url: { url: `data:${image.type};base64,${toBase64(await image.arrayBuffer())}` } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "receipt",
          strict: true,
          schema: {
            type: "object",
            properties: {
              store: { type: "string" },
              date: { type: "string" },
              total: { type: "number" },
              lines: {
                type: "array",
                items: {
                  type: "object",
                  properties: { name: { type: "string" }, quantity: { type: "number" }, size: { type: "string" }, price: { type: "number" } },
                  required: ["name", "quantity", "size", "price"],
                  additionalProperties: false,
                },
              },
            },
            required: ["store", "date", "total", "lines"],
            additionalProperties: false,
          },
        },
      },
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0,
      max_tokens: 3000,
    } as never);
    const content = (result as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
    parsed = ((typeof content === "string" ? safeJson(content) : content) ?? {}) as typeof parsed;
  } catch (err) {
    console.error("AI kon het kasticket niet lezen", err);
    return c.json({ ...none, message: "Automatisch lezen lukte niet." });
  }
  return c.json(await matchReceipt(db, me, parsed));
});

/** Wat de AI las, gekoppeld aan wat de lezer ziet: producten uit een voorraad, de winkel uit de rest. */
export async function matchReceipt(db: D1Database, me: string, parsed: { store?: unknown; date?: unknown; total?: unknown; lines?: unknown }): Promise<Read> {
  const seen = await seenLists(db, me);
  const { results } = await db
    .prepare(
      `SELECT t.id, t.name, t.data, t.list_id, l.name AS list, l.fields, l.stock FROM things t JOIN lists l ON l.id = t.list_id
       WHERE t.list_id IN (SELECT value FROM json_each(?)) AND t.archived = 0 AND l.archived = 0 LIMIT 5000`,
    )
    .bind(ids(seen.keys()))
    .all<{ id: string; name: string; data: string; list_id: string; list: string; fields: string; stock: string | null }>();
  const refOf = (r: (typeof results)[number], unit: string | null = null): ThingRef => ({ id: r.id, name: r.name, list_id: r.list_id, list: r.list, unit });
  const stocked = results.filter((r) => r.stock);
  const candidates: Candidate[] = stocked.map((r) => {
    const data = parseJson<Attributes>(r.data, {});
    const fields = parseJson<FieldDef[]>(r.fields, []);
    const aliasKeys = fields.filter((f) => f.type === "text" && f.aliases).map((f) => f.key);
    return { id: r.id, name: r.name, aliases: aliasKeys.flatMap((k) => aliasesOf(data[k])), measure: measureFor(parseJson<StockDef>(r.stock, {}), data) };
  });
  const lines = readLines(parsed.lines, candidates).map((l) => {
    const row = l.thing ? stocked.find((r) => r.id === l.thing) : undefined;
    return { ...l, thing: row ? refOf(row, candidates.find((c) => c.id === row.id)?.measure?.unit ?? null) : null };
  });
  const storeText = typeof parsed.store === "string" && parsed.store.trim() ? parsed.store.trim().slice(0, 80) : null;
  const storeId = storeText ? matchName(results.filter((r) => !r.stock), storeText) : null;
  const storeRow = storeId ? results.find((r) => r.id === storeId) : undefined;
  return {
    store: storeRow ? refOf(storeRow) : null,
    store_text: storeText,
    date: validDate(parsed.date, brusselsToday()),
    total: cents(parsed.total),
    lines,
  };
}

/** De naam op het ticket onthouden bij een ding (in zijn eerste tekstveld met `aliases`). */
thingAlias.post("/:id/alias", async (c) => {
  const db = c.env.DB;
  const me = c.get("person").id;
  const { thing, list, role } = await requireThing(db, me, c.req.param("id"));
  const body = asObject(await c.req.json());
  const name = requiredString(body, "name", 80);
  const field = list.fields.find((f) => f.type === "text" && f.aliases);
  if (!field || !canEdit(role)) return c.json({ ok: false });
  const next = withAlias(thing.data[field.key], name);
  if (next === null) return c.json({ ok: true });
  await db
    .prepare("UPDATE things SET data = json_set(data, ?, ?), updated_at = datetime('now') WHERE id = ?")
    .bind(`$.${field.key}`, next, thing.id)
    .run();
  return c.json({ ok: true });
});
