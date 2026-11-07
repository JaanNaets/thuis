// Een foto lezen voor een nieuw ding (✨, POST /lists/:id/things/read-photo): een etiket of typeplaatje (wat er staat,
// in de velden van de lijst), of in een lijst met productinfo het product of gerecht (de AI herkent en schat, daarna
// de echte gegevens uit Open Food Facts of NEVO, en de app zegt welke van de twee). Bewaart niets.

import { Hono } from "hono";
import { cleanAttributes, type FieldDef } from "../../shared/fields";
import { nevoCredit } from "../../shared/nevo";
import { readsPhoto, THINGS_FORM } from "../../shared/photoread";
import { isProductCode, PRODUCT_KEYS, productData, productLabel, type ProductInfo } from "../../shared/product";
import { AI_IMAGE_TYPES, MAX_IMAGE_BYTES, MODEL, safeJson, toBase64, useAiBudget } from "../ai";
import { needEdit, requireList } from "../access";
import { nevoByName, nevoData, productByCode, productByName } from "../products";
import type { AppEnv } from "../types";
import { ValidationError } from "../validate";

export const listPhoto = new Hono<AppEnv>();

export type PhotoRead = {
  name: string | null;
  data: Record<string, unknown>;
  /** Uit een databank (met de naam van het product), of geschat door de AI. */
  source?: { kind: "database"; label: string; db: "off" | "nevo"; credit?: string } | { kind: "estimate" };
  message?: string;
};

/** Velden die de AI van een foto kan lezen. */
export const READABLE = ["text", "url", "email", "phone", "address", "number", "money", "date", "time", "year", "year_range", "select", "multi", "bool"];

export function labelSchema(fields: FieldDef[]) {
  const properties: Record<string, unknown> = { name: { type: ["string", "null"] } };
  for (const f of fields) {
    if (f.type === "year_range") {
      properties[`${f.key}_from`] = { type: ["integer", "null"] };
      properties[`${f.key}_to`] = { type: ["integer", "null"] };
    } else if (f.type === "select" && f.options?.length) properties[f.key] = { type: ["string", "null"], enum: [...f.options, null] };
    else if (f.type === "multi") properties[f.key] = { type: ["array", "null"], items: { type: "string" } };
    else if (f.type === "number" || f.type === "money") properties[f.key] = { type: ["number", "null"] };
    else if (f.type === "year") properties[f.key] = { type: ["integer", "null"] };
    else if (f.type === "bool") properties[f.key] = { type: ["boolean", "null"] };
    else properties[f.key] = { type: ["string", "null"] };
  }
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false } as { type: string; properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
}

export function describeField(f: FieldDef): string {
  const extra =
    ({ year_range: ` (${f.key}_from en ${f.key}_to: jaartallen)`, money: " (in euro)", multi: " (lijst)", date: " (YYYY-MM-DD)", time: " (HH:MM)" } as Record<string, string>)[f.type] ??
    (f.unit ? ` (in ${f.unit})` : "");
  return `- ${f.key}: ${f.label}${extra}${f.product ? ` (${PRODUCT_KEYS[f.product].label})` : ""}`;
}

listPhoto.post("/:id/things/read-photo", async (c) => {
  const db = c.env.DB;
  const me = c.get("person").id;
  const { list, role } = await requireList(db, me, c.req.param("id"));
  needEdit(role);
  if (!readsPhoto(list.read_photo, THINGS_FORM, null)) throw new ValidationError("Deze lijst leest geen foto's.");
  const form = await c.req.formData();
  const image = form.get("image");
  // Een barcode die de app zelf al op de foto vond.
  const found = typeof form.get("code") === "string" && isProductCode(form.get("code") as string) ? (form.get("code") as string) : "";
  const empty: PhotoRead = { name: null, data: {} };
  if (!(image instanceof File)) throw new ValidationError("Geen foto ontvangen");
  if (!AI_IMAGE_TYPES.includes(image.type) || image.size > MAX_IMAGE_BYTES) return c.json({ ...empty, message: "Deze foto kan niet gelezen worden." });
  const limit = await useAiBudget(c.env, me);
  if (limit) return c.json({ ...empty, message: limit });

  const readable = list.fields.filter((f) => READABLE.includes(f.type));
  const products = readable.some((f) => f.product);
  const fields = products ? readable.filter((f) => f.type !== "date") : readable;
  const schema = labelSchema(fields);
  // Bij herkennen moet de AI de getallen van productinfo schatten (kcal per 100 g); een gekend product krijgt daarna
  // de echte gegevens.
  const estimated = products ? fields.filter((f) => f.type === "number" && f.product) : [];
  if (products) {
    Object.assign(schema.properties, {
      kind: { type: "string", enum: ["product", "dish", "unknown"] },
      brand: { type: ["string", "null"] },
      barcode: { type: ["string", "null"] },
      ...Object.fromEntries(estimated.map((f) => [f.key, { type: "number" }])),
    });
    schema.required = Object.keys(schema.properties);
  }
  const prompt = products
    ? `Je ziet een foto van eten of van een product. Herken wat het is.
- kind: "product" voor een verpakt product van een merk, "dish" voor een gerecht of los eten (fruit, brood), anders "unknown"
- name: bij een product de naam zoals op de verpakking, met de smaak of soort; bij een gerecht de naam in het Nederlands
- brand: het merk zoals op de verpakking, of null
- barcode: de cijfers onder de barcode als je ze allemaal kan lezen, anders null
${fields.map(describeField).join("\n")}
${estimated.length ? `Vul ${estimated.map((f) => f.key).join(" en ")} altijd in: lees het van de verpakking als dat kan, anders schat je het zoals een voedingstabel.\n` : ""}Vul de andere velden enkel in als het uit de foto volgt, anders null.`
    : `Je leest wat er op een foto staat: een etiket of typeplaatje. Geef enkel wat je echt ziet; gebruik null als je twijfelt. Raad nooit een getal of datum.
- name: de naam van ${list.one ? `de ${list.one.toLowerCase()}` : "het ding"} zoals op het etiket
${fields.map(describeField).join("\n")}`;
  try {
    const result = await c.env.AI.run(MODEL, {
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            { type: "text", text: products ? "Wat is dit?" : "Lees dit." },
            { type: "image_url", image_url: { url: `data:${image.type};base64,${toBase64(await image.arrayBuffer())}` } },
          ],
        },
      ],
      response_format: { type: "json_schema", json_schema: { name: "label", schema, strict: true } },
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
    if (parsed.kind === "unknown") for (const f of estimated) raw[f.key] = null;
    const name = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim().slice(0, 200) : null;
    const read: PhotoRead = { name, data: cleanAttributes(fields, raw) };
    if (products && read.name) {
      // Een gekend product: de echte gegevens (op barcode, anders op naam en merk); lukt dat niet, dan blijft de
      // schatting staan, en dat zeggen we ook.
      const code = found || (typeof parsed.barcode === "string" ? parsed.barcode.replace(/\D/g, "") : "");
      const brand = typeof parsed.brand === "string" && parsed.brand.trim() ? parsed.brand.trim() : null;
      const info: ProductInfo | null =
        parsed.kind === "product" || found
          ? await (isProductCode(code) ? productByCode(db, code) : Promise.resolve(null)).then((p) => p ?? productByName(db, read.name!, brand)).catch(() => null)
          : parsed.kind !== "unknown" && !brand
            ? await nevoByName(db, read.name)
            : null;
      if (info) {
        read.name = productLabel(info);
        Object.assign(read.data, cleanAttributes(fields, productData(fields, info)));
        read.source = { kind: "database", label: productLabel(info), db: info.source ?? "off", ...(info.source === "nevo" ? { credit: nevoCredit((await nevoData(db)).version) } : {}) };
      } else read.source = { kind: "estimate" };
    }
    if (!read.name && Object.keys(read.data).length === 0) read.message = "Niets herkend op deze foto. Vul het zelf in.";
    return c.json(read);
  } catch (err) {
    console.error("AI kon de foto niet lezen", err);
    return c.json({ ...empty, message: "Automatisch lezen lukte niet. Vul het zelf in." });
  }
});
