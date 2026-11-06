// Foto's en bestanden van dingen en gebeurtenissen, in R2. Een ding houdt de sleutel van het item van vroeger
// (`items/<id>/photo`), zodat foto's van voor de herbouw blijven werken.

import type { Context } from "hono";
import type { AppEnv } from "./types";

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type OwnerKind = "thing" | "event";
const prefix = (kind: OwnerKind, id: string) => (kind === "thing" ? `items/${id}` : `events/${id}`);
export const photoKey = (kind: OwnerKind, id: string) => `${prefix(kind, id)}/photo`;
export const fileKey = (kind: OwnerKind, id: string, fileId: string) => `${prefix(kind, id)}/files/${fileId}`;

export type Attachment = { id: string; filename: string; content_type: string; size_bytes: number; created_at: string };

export async function servePhoto(c: Context<AppEnv>, kind: OwnerKind, id: string): Promise<Response> {
  const object = await c.env.FILES.get(photoKey(kind, id));
  if (!object) return c.json({ error: "Geen foto" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      // De app vraagt de foto op met ?v=<versie>, dus een nieuwe foto is altijd een nieuwe URL.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Een foto bewaren; geeft de nieuwe versie (of een fout om te tonen). */
export async function storePhoto(c: Context<AppEnv>, kind: OwnerKind, id: string): Promise<{ photo_version: number } | { error: string }> {
  const file = (await c.req.formData()).get("file");
  if (!(file instanceof File)) return { error: "Geen bestand ontvangen" };
  // Geen SVG: daar kan code in zitten.
  if (!PHOTO_TYPES.includes(file.type)) return { error: "Kies een foto (JPG, PNG of WebP)" };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Deze foto is groter dan 3 MB" };
  await c.env.FILES.put(photoKey(kind, id), file.stream(), { httpMetadata: { contentType: file.type } });
  const table = kind === "thing" ? "things" : "events";
  const row = await c.env.DB.prepare(`UPDATE ${table} SET photo_version = COALESCE(photo_version, 0) + 1 WHERE id = ? RETURNING photo_version`)
    .bind(id)
    .first<{ photo_version: number }>();
  return { photo_version: row?.photo_version ?? 1 };
}

export async function removePhoto(c: Context<AppEnv>, kind: OwnerKind, id: string) {
  const table = kind === "thing" ? "things" : "events";
  await c.env.DB.prepare(`UPDATE ${table} SET photo_version = NULL WHERE id = ?`).bind(id).run();
  await c.env.FILES.delete(photoKey(kind, id));
}

export async function storeFiles(c: Context<AppEnv>, kind: OwnerKind, id: string): Promise<Attachment[] | { error: string }> {
  const form = await c.req.formData();
  const uploads = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!uploads.length) return { error: "Geen bestand ontvangen" };
  for (const file of uploads) {
    if (!FILE_TYPES.includes(file.type)) return { error: `${file.name}: kies een foto of PDF` };
    if (file.size > MAX_FILE_BYTES) return { error: `${file.name} is groter dan 10 MB` };
  }
  const saved: Attachment[] = [];
  for (const file of uploads.slice(0, 10)) {
    const fileId = crypto.randomUUID();
    const key = fileKey(kind, id, fileId);
    await c.env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    const meta = await c.env.DB.prepare(
      "INSERT INTO attachments (id, owner_kind, owner_id, filename, content_type, size_bytes, r2_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, filename, content_type, size_bytes, created_at",
    )
      .bind(fileId, kind, id, file.name.slice(0, 200), file.type, file.size, key, c.get("person").id)
      .first<Attachment>();
    saved.push(meta!);
  }
  return saved;
}

export async function attachmentsOf(db: D1Database, kind: OwnerKind, id: string): Promise<Attachment[]> {
  const { results } = await db
    .prepare("SELECT id, filename, content_type, size_bytes, created_at FROM attachments WHERE owner_kind = ? AND owner_id = ? ORDER BY created_at")
    .bind(kind, id)
    .all<Attachment>();
  return results;
}

/** Alles in R2 van een ding of gebeurtenis weghalen (na het verwijderen uit de databank). */
export async function purgeMedia(env: AppEnv["Bindings"], kind: OwnerKind, id: string, keys: string[]) {
  await env.FILES.delete([...keys, photoKey(kind, id)]);
}
