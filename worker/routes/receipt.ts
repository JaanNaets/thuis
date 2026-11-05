// Een kasticket per lijn lezen (zie shared/receipt.ts): de AI leest de winkel, de datum, het totaal en elke lijn met
// haar prijs; de server koppelt de lijnen aan de producten die jij ziet (ook in lijsten van andere projecten, en op de
// namen zoals ze vroeger op een ticket stonden) en de winkel aan een winkel. Er wordt niets bewaard: je kijkt alles
// na, en bewaren gaat in één keer via `POST /projects/:id/items/batch` (met het kasticket zelf als `group`).

import { Hono } from "hono";
import { canCreate, fieldAccess, typeAccess, visibleFields } from "../../shared/access";
import { matchName, refLists, type Attributes } from "../../shared/fields";
import { cents, readLines, receiptPlan, validDate, type Candidate } from "../../shared/receipt";
import type { ItemType, ProjectNode, ReceiptRead } from "../../shared/types";
import { AI_IMAGE_TYPES, MAX_IMAGE_BYTES, MODEL, safeJson, toBase64, useAiBudget } from "../ai";
import { accessibleProjects, projectAccess, requireProject, toItemType, typesFor, type TypeRow } from "../context";
import { brusselsToday } from "../today";
import type { AppEnv } from "../types";
import { ForbiddenError, ValidationError } from "../validate";

export const projectReceipt = new Hono<AppEnv>();

projectReceipt.post("/:id/items/scan-receipt", async (c) => {
  const form = await c.req.formData();
  const db = c.env.DB;
  const me = c.get("person").id;
  const access = await requireProject(db, me, c.req.param("id"));
  const type = (await typesFor(db, access.chain)).find((t) => t.id === form.get("type_id"));
  if (!type) throw new ValidationError("Die lijst bestaat hier niet.");
  if (!canCreate(access.rights, type.id)) throw new ForbiddenError(`Je mag hier geen ${type.plural.toLowerCase()} toevoegen.`);
  // De lijsten waarnaar deze lijst verwijst: om het kasticket te herkennen en de producten en winkels te zoeken.
  const linked = await listsById(db, [...new Set(type.fields.flatMap((f) => (f.type === "item" ? refLists(f) : [])))]);
  const plan = receiptPlan(type.fields, type.id, (id) => linked.get(id)?.fields);
  if (!plan) throw new ValidationError("Deze lijst heeft geen bedrag en geen product dat telt.");
  const image = form.get("image");
  const none: ReceiptRead = { store: null, date: null, total: null, lines: [] };
  if (!(image instanceof File)) return c.json({ error: "Geen foto ontvangen" }, 400);
  if (!AI_IMAGE_TYPES.includes(image.type) || image.size > MAX_IMAGE_BYTES) return c.json({ ...none, message: "Deze foto kan niet gelezen worden." });
  const limit = await useAiBudget(c.env, me);
  if (limit) return c.json({ ...none, message: limit });

  let parsed: { store?: unknown; date?: unknown; total?: unknown; lines?: unknown } = {};
  try {
    const result = await c.env.AI.run(MODEL, {
      messages: [
        {
          role: "system",
          content: `Je leest een kasticket, lijn per lijn. Geef:
- store: de naam van de winkel (bv. "Colruyt", "Delhaize"), zonder adres
- date: de datum van aankoop als JJJJ-MM-DD, anders leeg
- total: het totaal dat betaald werd, in euro (0 als je het niet ziet)
- lines: elke gekochte lijn, met
  - name: de productnaam zoals op het ticket (zonder prijs, code of gewicht)
  - quantity: het aantal stuks (1 als er geen aantal staat, ook bij iets dat per gewicht verkocht wordt)
  - size: het gewicht of de inhoud als die op de lijn staat (bv. "5 kg", "500 g", "1,5 l", "6x33 cl"), anders leeg
  - price: wat de hele lijn kost in euro (aantal × stukprijs); staat er een korting direct onder, trek die ervan af
Sla totalen, tussentotalen, statiegeld, zakjes, spaarpunten en betaalgegevens over. Geef enkel wat je echt ziet.`,
        },
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
    });
    const content = result.choices?.[0]?.message?.content;
    parsed = ((typeof content === "string" ? safeJson(content) : content) ?? {}) as typeof parsed;
  } catch (err) {
    console.error("AI kon het kasticket niet lezen", err);
    return c.json({ ...none, message: "Automatisch lezen lukte niet." });
  }

  const nodes = await accessibleProjects(db, me);
  const products = await candidates(db, nodes, plan.product.lists, linked);
  const unitField = plan.unit ? type.fields.find((f) => f.key === plan.unit) : undefined;
  const options = unitField?.type === "select" ? unitField.options : undefined;
  const lines = readLines(parsed.lines, products, options);

  // De winkel: een winkel die je al hebt (zelfde naam), anders de naam.
  const storeName = typeof parsed.store === "string" ? parsed.store.trim().slice(0, 120) : "";
  let store: ReceiptRead["store"] = null;
  if (storeName && plan.store) {
    const stores = await candidates(db, nodes, plan.store.lists, linked);
    const id = matchName(stores, storeName);
    const found = id ? stores.find((s) => s.id === id) : undefined;
    store = { id: found?.id ?? null, name: found?.item ?? storeName };
  }

  // Het kasticket zelf: in dit project als de lijst erboven staat, anders in haar eigen project; enkel als je er mag
  // toevoegen.
  let receipt: ReceiptRead["receipt"];
  if (plan.receipt) {
    const list = linked.get(plan.receipt.list);
    const target = list && (access.chain.includes(list.project_id) ? access : await projectAccess(db, me, list.project_id));
    if (list && target && canCreate(target.rights, list.id))
      receipt = { key: plan.receipt.key, type_id: list.id, name: list.name, fields: visibleFields(target.rights, list.id, list.fields) };
  }

  const out: ReceiptRead = { store, date: validDate(parsed.date, brusselsToday()), total: cents(parsed.total), lines, ...(receipt ? { receipt } : {}) };
  if (!lines.length) out.message = "Geen lijnen gevonden op deze foto.";
  return c.json(out);
});

/** Lijsten op id (in eender welk project; wat je ervan mag zien, kijken we per project na). */
async function listsById(db: D1Database, ids: string[]): Promise<Map<string, ItemType>> {
  if (!ids.length) return new Map();
  const { results } = await db.prepare("SELECT * FROM item_types WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)).all<TypeRow>();
  return new Map(results.map((r) => [r.id, toItemType(r)]));
}

/**
 * Waaraan een naam op het ticket kan koppelen: de items van die lijsten die je ziet (per project, zoals
 * `GET /items`), op hun naam en op de namen zoals ze vroeger op een ticket stonden (een tekstveld met `aliases` dat je
 * daar ziet). `own`: de naam van het item zelf (geen andere naam).
 */
async function candidates(db: D1Database, nodes: ProjectNode[], lists: string[], linked: Map<string, ItemType>): Promise<Candidate[]> {
  const allowed = nodes.flatMap((n) => lists.filter((t) => typeAccess(n.rights, t) !== "none").map((t) => `${t}/${n.id}`));
  if (!allowed.length) return [];
  const { results } = await db
    .prepare(
      `SELECT id, name, type_id, project_id, data FROM items
       WHERE type_id IN (SELECT value FROM json_each(?1)) AND archived = 0 AND type_id || '/' || project_id IN (SELECT value FROM json_each(?2))`,
    )
    .bind(JSON.stringify(lists), JSON.stringify(allowed))
    .all<{ id: string; name: string; type_id: string; project_id: string; data: string }>();
  const rights = new Map(nodes.map((n) => [n.id, n.rights]));
  return results.flatMap((r) => {
    const aliasKeys = (linked.get(r.type_id)?.fields ?? []).filter((f) => f.type === "text" && f.aliases && fieldAccess(rights.get(r.project_id)!, r.type_id, f.key) !== "none").map((f) => f.key);
    let data: Attributes = {};
    if (aliasKeys.length)
      try {
        data = JSON.parse(r.data) as Attributes;
      } catch {
        data = {};
      }
    const aliases = aliasKeys.flatMap((k) => (typeof data[k] === "string" ? (data[k] as string).split(";") : [])).map((a) => a.trim()).filter(Boolean);
    return [{ id: r.id, name: r.name, item: r.name, own: true }, ...aliases.map((a) => ({ id: r.id, name: a, item: r.name, own: false }))];
  });
}
