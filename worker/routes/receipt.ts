// Een foto lezen voor een gebeurtenis (✨): POST /lists/:id/events/read-photo met de foto en de soort van het
// formulier. Een aankoop leest een kasticket: elke lijn gekoppeld aan een ding uit een voorraad die de lezer ziet (zie
// shared/receipt.ts), de winkel aan een ding dat hij ziet. Een andere soort vult haar eigen velden in (en de
// omschrijving, de datum, het bedrag); met voedingswaarden is de foto een gerecht en schat de AI de portie (dat zegt de
// app ook). Enkel als het formulier foto's leest (shared/photoread.ts). Bewaart niets: het formulier toont het om na
// te kijken. POST /things/:id/alias onthoudt de naam op het ticket bij het ding (een tekstveld met `aliases`, enkel als
// je in die lijst mag wijzigen).

import { Hono } from "hono";
import type { Attributes, FieldDef } from "../../shared/fields";
import { BASES, baseKind, canEdit, isBase, type KindInfo, type ThingRef } from "../../shared/model";
import { cleanAttributes } from "../../shared/fields";
import { isFoodKind, readsPhoto } from "../../shared/photoread";
import { aliasesOf, matchName, readLines, validDate, cents, withAlias, type Candidate } from "../../shared/receipt";
import { measureFor, type StockDef } from "../../shared/stock";
import { AI_IMAGE_TYPES, MAX_IMAGE_BYTES, MODEL, safeJson, toBase64, useAiBudget } from "../ai";
import { ids, kindsFor, needEdit, parseJson, requireList, requireThing, seenLists } from "../access";
import { describeField, labelSchema, READABLE } from "./photo";
import { brusselsToday } from "../today";
import type { AppEnv } from "../types";
import { asObject, requiredString, ValidationError } from "../validate";

export const listReceipt = new Hono<AppEnv>();
export const thingAlias = new Hono<AppEnv>();

type Read = {
  kind: "receipt";
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

/** Wat een foto opleverde voor een andere soort dan een aankoop: de omschrijving, datum, bedrag en haar velden. */
type FormRead = {
  kind: "form";
  name: string | null;
  date: string | null;
  amount: number | null;
  data: Record<string, unknown>;
  /** Geschat (een gerecht) of gelezen (wat er op de foto staat). */
  estimate: boolean;
  message?: string;
};

listReceipt.post("/:id/events/read-photo", async (c) => {
  const db = c.env.DB;
  const me = c.get("person").id;
  const { list, role } = await requireList(db, me, c.req.param("id"));
  needEdit(role);
  const form = await c.req.formData();
  const image = form.get("image");
  const wanted = String(form.get("kind") ?? "aankoop");
  // De soort: een basissoort, of een eigen soort van een lijst die je ziet.
  const seen = await seenLists(db, me);
  const kind: KindInfo | undefined = isBase(wanted) ? baseKind(wanted) : (await kindsFor(db, seen.keys())).find((k) => k.id === wanted);
  if (!kind) throw new ValidationError("Onbekende soort");
  if (!readsPhoto(list.read_photo, kind.id, kind)) throw new ValidationError("Dit formulier leest geen foto's.");
  if (!(image instanceof File)) throw new ValidationError("Geen foto ontvangen");
  const receipt = kind.base === "aankoop";
  const none: Read | FormRead = receipt
    ? { kind: "receipt", store: null, store_text: null, date: null, total: null, lines: [] }
    : { kind: "form", name: null, date: null, amount: null, data: {}, estimate: false };
  if (!AI_IMAGE_TYPES.includes(image.type) || image.size > MAX_IMAGE_BYTES) return c.json({ ...none, message: "Deze foto kan niet gelezen worden." });
  const limit = await useAiBudget(c.env, me);
  if (limit) return c.json({ ...none, message: limit });
  if (!receipt) return c.json(await readForm(c.env, image, kind, list.name));

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
  const read = await matchReceipt(db, me, parsed);
  // Geen lijn, winkel of totaal: dit is geen kasticket (een foto van een gerecht, …). Dan verandert het formulier niets.
  if (!read.lines.length && !read.store_text && !read.total) return c.json({ ...read, message: "Geen kasticket herkend op deze foto. Vul het zelf in." });
  return c.json(read);
});

/** Een foto voor een soort zonder kasticket: haar velden, en bij eten een schatting van de portie. */
async function readForm(env: Env, image: File, kind: KindInfo, listName: string): Promise<FormRead> {
  const fields = kind.fields.filter((f) => READABLE.includes(f.type));
  const food = isFoodKind(kind);
  const money = BASES[kind.base].money;
  const estimated = food ? fields.filter((f) => f.type === "number" && f.product) : [];
  const schema = labelSchema(fields);
  Object.assign(schema.properties, {
    date: { type: ["string", "null"] },
    ...(money ? { amount: { type: ["number", "null"] } } : {}),
    ...Object.fromEntries(estimated.map((f) => [f.key, { type: "number" }])),
  });
  schema.required = Object.keys(schema.properties);
  const lines = fields.map(describeField).join("\n");
  const prompt = food
    ? `Je ziet een foto van eten of drinken voor "${kind.name}". Herken wat het is en schat hoeveel er op de foto staat.
- name: wat het is, in het Nederlands (bv. "Thaise groene curry met rijst")
- date: null
${money ? "- amount: wat het kostte in euro als dat op de foto staat, anders null\n" : ""}${lines}
${estimated.length ? `Vul ${estimated.map((f) => f.key).join(" en ")} altijd in voor alles wat op de foto staat, geschat zoals een voedingstabel.\n` : ""}Vul de andere velden enkel in als het uit de foto volgt, anders null.`
    : `Je leest een foto voor "${kind.name}" in de lijst "${listName}": een bon, factuur, scherm, meter of etiket. Geef enkel wat je echt ziet; gebruik null als je twijfelt. Raad nooit een getal of datum.
- name: een korte omschrijving (bv. de winkel of wat het is)
- date: de datum als JJJJ-MM-DD
${money ? "- amount: het totaalbedrag in euro\n" : ""}${lines}`;
  try {
    const result = await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            { type: "text", text: food ? "Wat is dit?" : "Lees dit." },
            { type: "image_url", image_url: { url: `data:${image.type};base64,${toBase64(await image.arrayBuffer())}` } },
          ],
        },
      ],
      response_format: { type: "json_schema", json_schema: { name: "form", schema, strict: true } },
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0,
      max_tokens: 700,
    } as never);
    const content = (result as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
    const parsed = ((typeof content === "string" ? safeJson(content) : content) ?? {}) as Record<string, unknown>;
    const raw: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.type === "year_range") raw[f.key] = [parsed[`${f.key}_from`] ?? null, parsed[`${f.key}_to`] ?? null];
      else if (f.type === "money") raw[f.key] = typeof parsed[f.key] === "number" ? Math.round((parsed[f.key] as number) * 100) : null;
      else raw[f.key] = parsed[f.key];
    }
    const read: FormRead = {
      kind: "form",
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim().slice(0, 200) : null,
      date: validDate(parsed.date, brusselsToday()),
      amount: money ? cents(parsed.amount) : null,
      data: cleanAttributes(fields, raw),
      estimate: food,
    };
    if (!read.name && !read.amount && Object.keys(read.data).length === 0) read.message = "Niets herkend op deze foto. Vul het zelf in.";
    return read;
  } catch (err) {
    console.error("AI kon de foto niet lezen", err);
    return { kind: "form", name: null, date: null, amount: null, data: {}, estimate: false, message: "Automatisch lezen lukte niet. Vul het zelf in." };
  }
}

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
    kind: "receipt",
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
