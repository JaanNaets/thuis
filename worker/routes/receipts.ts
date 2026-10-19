import { Hono } from "hono";
import {
  CATEGORIES,
  emptyGuess,
  isComplete,
  mergeGuess,
  normalizeGuess,
  parseReceiptText,
  type Category,
  type ReceiptGuess,
  type ReceiptReadResult,
} from "../../shared/receipt";
import type { AppEnv } from "../types";

// Goedkoop en goed in OCR, ook in het Nederlands. ±20-30 neurons per ticket;
// de gratis hoeveelheid van Workers AI is 10.000 neurons per dag.
const MODEL = "@cf/google/gemma-4-26b-a4b-it";

// Harde rem: zelfs op een betaald plan blijven we zo ver onder de gratis hoeveelheid.
const AI_DAILY_LIMIT = 50;

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const AI_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const SYSTEM_PROMPT = `Je leest Belgische en Nederlandse kastickets en facturen.
Geef enkel wat je echt op het document ziet; gebruik null als je twijfelt. Raad nooit.
- store: naam van de winkel of verkoper
- date: aankoopdatum of factuurdatum als YYYY-MM-DD (niet de vervaldatum)
- total: het eindbedrag dat betaald werd, inclusief btw, als getal in euro
- description: korte omschrijving in het Nederlands van wat gekocht werd; bij boodschappen "Boodschappen"; bij één hoofdproduct de productnaam
- category: een van de toegelaten categorieën, of null`;

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    store: { type: ["string", "null"] },
    date: { type: ["string", "null"] },
    total: { type: ["number", "null"] },
    description: { type: ["string", "null"] },
    category: { type: ["string", "null"], enum: [...CATEGORIES, null] },
  },
  required: ["store", "date", "total", "description", "category"],
  additionalProperties: false,
};

export const receipts = new Hono<AppEnv>();

/**
 * Leest een kasticket of factuur. Multipart met:
 * - "text": tekst uit een PDF (de app haalt die er zelf uit), en/of
 * - "image": een foto (of de eerste pagina van een gescande PDF), al verkleind door de app.
 *
 * Volgorde, van gratis naar (bijna) gratis: eerst code op de tekst; enkel als daar niet alles
 * uit komt én er een afbeelding is, de AI. Wat de AI zegt, wordt altijd door code nagekeken.
 */
receipts.post("/read", async (c) => {
  const form = await c.req.formData();
  const text = form.get("text");
  const image = form.get("image");

  let guess: ReceiptGuess =
    typeof text === "string" && text.trim() ? parseReceiptText(text.slice(0, 50_000)) : emptyGuess();
  let source: ReceiptReadResult["source"] = Object.values(guess).some((v) => v !== null) ? "code" : null;
  let message: string | undefined;

  if (!isComplete(guess) && image instanceof File) {
    const ai = await readWithAi(c.env, image);
    if ("guess" in ai) {
      // Wat de code wél vond, is exact; de AI vult enkel aan.
      guess = mergeGuess(guess, ai.guess);
      source = "ai";
    } else {
      message = ai.error;
    }
  }

  // Categorie van vorige aankopen in dezelfde winkel: die kent het huishouden het best.
  if (guess.store) {
    const previous = await categoryFromHistory(c.env.DB, guess.store);
    if (previous) guess.category = previous;
  }

  const result: ReceiptReadResult = { guess, source, complete: isComplete(guess), message };
  return c.json(result);
});

async function readWithAi(env: Env, image: File): Promise<{ guess: ReceiptGuess } | { error: string }> {
  if (!AI_IMAGE_TYPES.includes(image.type)) return { error: "Dit fotoformaat kan niet automatisch gelezen worden." };
  if (image.size > MAX_IMAGE_BYTES) return { error: "De foto is te groot om automatisch te lezen." };

  const usage = await env.DB.prepare(
    `INSERT INTO ai_usage (day, calls) VALUES (date('now'), 1)
     ON CONFLICT (day) DO UPDATE SET calls = calls + 1
     RETURNING calls`,
  ).first<{ calls: number }>();
  if (!usage || usage.calls > AI_DAILY_LIMIT) {
    return { error: "De daglimiet voor automatisch lezen is bereikt. Vul het ticket zelf in." };
  }

  try {
    const dataUrl = `data:${image.type};base64,${toBase64(await image.arrayBuffer())}`;
    const result = await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `Lees dit document. Toegelaten categorieën: ${CATEGORIES.join(", ")}.` },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: "json_schema", json_schema: { name: "receipt", schema: RECEIPT_SCHEMA, strict: true } },
      // Geen "denkstappen": die kosten extra tokens en zijn voor een ticket niet nodig.
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0,
      max_tokens: 300,
    });
    const content = result.choices?.[0]?.message?.content;
    const parsed = typeof content === "string" ? safeJson(content) : content;
    return { guess: normalizeGuess(parsed) };
  } catch (err) {
    console.error("AI kon het ticket niet lezen", err);
    return { error: "Automatisch lezen lukte niet. Vul het ticket zelf in." };
  }
}

async function categoryFromHistory(db: D1Database, store: string): Promise<Category | null> {
  const row = await db
    .prepare(
      `SELECT category FROM purchases
       WHERE store = ? COLLATE NOCASE AND category IS NOT NULL
       GROUP BY category ORDER BY COUNT(*) DESC LIMIT 1`,
    )
    .bind(store)
    .first<{ category: string }>();
  return CATEGORIES.find((c) => c === row?.category) ?? null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, ""));
  } catch {
    return null;
  }
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // In stukken, anders wordt de argumentenlijst van fromCharCode te lang.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
