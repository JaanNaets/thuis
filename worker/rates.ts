// De dagkoersen van de Europese Centrale Bank (gratis, elke werkdag rond 16 u), een halve dag bijgehouden in
// `settings`. Lukt het ophalen niet, dan de laatste die we hebben.

import { fromEcbXml, type Rates } from "../shared/money";

const ECB = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export async function getRates(db: D1Database): Promise<Rates | null> {
  const row = await db
    .prepare("SELECT value, updated_at > datetime('now', '-12 hours') AS fresh FROM settings WHERE key = 'rates'")
    .first<{ value: string; fresh: number }>();
  if (row?.fresh) return JSON.parse(row.value) as Rates;
  try {
    const res = await fetch(ECB, { signal: AbortSignal.timeout(8000) });
    const rates = res.ok ? fromEcbXml(await res.text()) : null;
    if (!rates) throw new Error("Geen koersen");
    await db
      .prepare("INSERT INTO settings (key, value) VALUES ('rates', ?1) ON CONFLICT (key) DO UPDATE SET value = ?1, updated_at = datetime('now')")
      .bind(JSON.stringify(rates))
      .run();
    return rates;
  } catch {
    return row ? (JSON.parse(row.value) as Rates) : null;
  }
}
