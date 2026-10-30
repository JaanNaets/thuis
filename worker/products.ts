// Productinfo opvragen bij Open Food Facts (open en gratis), met een eigen kopie in D1: een product 30 dagen, een
// zoekvraag zonder resultaat een dag. Open Food Facts vraagt om een herkenbare User-Agent en om zuinig te zijn.

import { bestMatch, fromOff, isProductCode, type ProductInfo } from "../shared/product";

const FIELDS = "code,product_name,product_name_nl,product_name_fr,product_name_en,brands,quantity,nutriments,unique_scans_n";
const HEADERS = { "User-Agent": "Thuis/1.0 (huishoud-app op Cloudflare)" };
const KEEP_DAYS = 30;

async function cached(db: D1Database, key: string, load: () => Promise<ProductInfo | null>): Promise<ProductInfo | null> {
  const row = await db
    .prepare(
      `SELECT data FROM products WHERE key = ?1
         AND fetched_at > datetime('now', CASE WHEN data IS NULL THEN '-1 day' ELSE '-${KEEP_DAYS} days' END)`,
    )
    .bind(key)
    .first<{ data: string | null }>();
  if (row) return row.data ? (JSON.parse(row.data) as ProductInfo) : null;
  const found = await load();
  await db
    .prepare("INSERT INTO products (key, data, fetched_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT (key) DO UPDATE SET data = ?2, fetched_at = datetime('now')")
    .bind(key, found ? JSON.stringify(found) : null)
    .run();
  return found;
}

/** Een vraag aan Open Food Facts; gooit een fout als het niet lukt (dat onthouden we niet als "niets gevonden"). */
async function getJson(url: string, seconds = 8): Promise<unknown> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(seconds * 1000) });
  if (!res.ok) throw new Error(`Open Food Facts: ${res.status}`);
  return res.json();
}

/** Een product op barcode; null als het er niet in staat (of de barcode niet klopt). */
export async function productByCode(db: D1Database, code: string): Promise<ProductInfo | null> {
  if (!isProductCode(code)) return null;
  return cached(db, `code:${code}`, async () => {
    const body = (await getJson(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}`)) as { status?: number; product?: unknown };
    return body.status === 1 ? fromOff({ ...(body.product as object), code }) : null;
  });
}

/** Een product op naam en merk (wat de app op een foto herkende): de beste match, of null. */
export async function productByName(db: D1Database, name: string, brand: string | null): Promise<ProductInfo | null> {
  const clean = (s: string) => s.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const q = clean(name);
  const b = brand ? clean(brand) : "";
  if (!q) return null;
  return cached(db, `zoek:${q.toLowerCase()}|${b.toLowerCase()}`, async () => {
    const pick = (found: unknown[] | undefined) =>
      bestMatch((found ?? []).map(fromOff).filter((p): p is ProductInfo => p !== null), { name: q, brand: b || null });
    // Eerst de nieuwe zoekfunctie binnen het merk (snel, precies); anders de oude op naam en merk samen (trager en
    // strenger beperkt, maar beter voor wat hier in de winkel ligt). Lukt die niet, dan is er gewoon geen match.
    let failed = false;
    if (b) {
      try {
        const params = new URLSearchParams({ q: `${q} brands:"${b}"`, page_size: "12", fields: FIELDS });
        const fast = pick(((await getJson(`https://search.openfoodfacts.org/search?${params}`)) as { hits?: unknown[] }).hits);
        if (fast) return fast;
      } catch {
        failed = true;
      }
    }
    const params = new URLSearchParams({ search_terms: `${q} ${b}`.trim(), search_simple: "1", action: "process", json: "1", page_size: "12", fields: FIELDS });
    try {
      return pick(((await getJson(`https://world.openfoodfacts.org/cgi/search.pl?${params}`, 15)) as { products?: unknown[] }).products);
    } catch (err) {
      // Lukte geen van beide, dan weten we niets (en onthouden we dat niet); lukte de eerste wel, dan is er geen match.
      if (failed || !b) throw err;
      return null;
    }
  });
}
