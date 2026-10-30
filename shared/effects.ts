// Verwijzingen die tellen: een verwijzing kan bij bewaren een getal van het gekozen item aanpassen (`adjust` op het
// veld). Wat je eet uit de voorraad, trekt het af ("Uit voorraad": − gram ÷ inhoud); wat je op de winkellijst
// afvinkt, telt het bij ("Product": + aantal als gekocht). Generiek: welk getal daar, met welk getal (of berekening)
// hier, erbij of eraf.
//
// Wat werd toegepast, onthoudt het item (`applied`). Bij wijzigen past de app enkel het verschil toe, bij verwijderen
// draait ze het terug; zo klopt het getal daar altijd met wat hier staat.

import type { Attributes, FieldDef } from "./fields.ts";

/** Wat een item aan een ander item deed: bij `target` het veld `field` met `delta`. */
export type Applied = { target: string; field: string; delta: number };

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Wat een item met deze waarden (met de berekeningen al uitgerekend) aanpast. */
export function effectsOf(fields: FieldDef[], data: Attributes): Applied[] {
  return fields.flatMap((f) => {
    if (f.type !== "item" || !f.adjust || typeof data[f.key] !== "string") return [];
    const amount = f.adjust.by ? data[f.adjust.by] : 1;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) return [];
    return [{ target: data[f.key] as string, field: f.adjust.field, delta: round(f.adjust.sign * amount) }];
  });
}

/** Wat er nog moet gebeuren van `before` naar `after`: per item en veld het verschil (zonder nullen). */
export function netEffects(before: Applied[], after: Applied[]): Applied[] {
  const sums = new Map<string, Applied>();
  const add = (e: Applied, sign: number) => {
    const key = `${e.target}\u0000${e.field}`;
    const cur = sums.get(key) ?? { target: e.target, field: e.field, delta: 0 };
    sums.set(key, { ...cur, delta: round(cur.delta + sign * e.delta) });
  };
  before.forEach((e) => add(e, -1));
  after.forEach((e) => add(e, 1));
  return [...sums.values()].filter((e) => e.delta !== 0);
}

/** Wat bewaard staat (JSON), nagekeken. */
export function parseApplied(json: string | null | undefined): Applied[] {
  if (!json) return [];
  try {
    const list = JSON.parse(json);
    return Array.isArray(list)
      ? list.filter((e): e is Applied => e && typeof e.target === "string" && typeof e.field === "string" && typeof e.delta === "number" && Number.isFinite(e.delta))
      : [];
  } catch {
    return [];
  }
}
