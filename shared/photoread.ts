// Een foto lezen met de AI (✨): om een item toe te voegen (per lijst, `lists.read_photo` met "items": een etiket, een
// product of een gerecht) of met een formulier (`kinds.reads`, zoals Aankoop of Gegeten). Een beheerder zet het aan of
// uit (Instellen); wat niemand koos, volgt de standaard: een item, een formulier met geld (een kasticket of factuur) en
// een formulier met voedingswaarden (een gerecht) lezen de foto. Bij elke foto kan je het lezen nog
// uitzetten (de fotokiezer), en de AI start enkel na die keuze.

import type { FieldDef } from "./fields.ts";
import type { Parts } from "./model.ts";

/** Het formulier om een item toe te voegen; een soort heet naar haar id ("aankoop", of de id van een eigen soort). */
export const ITEMS_FORM = "items";

/** Wat een beheerder uitdrukkelijk aan of uit zette (de rest volgt `readsByDefault`). */
export type ReadPhoto = { on: string[]; off: string[] };

type KindLike = { parts: Pick<Parts, "money">; fields: FieldDef[] };

/** Een soort met voedingswaarden (een getal met productinfo: kcal, eiwit, …): een foto is dan een gerecht. */
export const isFoodKind = (kind: KindLike): boolean => kind.fields.some((f) => f.type === "number" && f.product !== undefined);

/** Leest dit formulier een foto als niemand iets koos? */
export function readsByDefault(form: string, kind: KindLike | null): boolean {
  if (form === ITEMS_FORM) return true;
  if (!kind) return false;
  return kind.parts.money || isFoodKind(kind);
}

/** Leest dit formulier een foto (de keuze van de beheerder, anders de standaard)? */
export function readsPhoto(setting: ReadPhoto | null, form: string, kind: KindLike | null): boolean {
  if (setting?.on.includes(form)) return true;
  if (setting?.off.includes(form)) return false;
  return readsByDefault(form, kind);
}

/** Leest dit formulier een foto: wat zijn beheerder koos (`reads`), anders de standaard. */
export const formReads = (kind: KindLike & { id: string; reads: boolean | null }): boolean => kind.reads ?? readsByDefault(kind.id, kind);

/** Zet het lezen voor één formulier aan of uit; gelijk aan de standaard = geen uitdrukkelijke keuze meer. */
export function withReads(setting: ReadPhoto | null, form: string, kind: KindLike | null, on: boolean): ReadPhoto | null {
  const rest = { on: (setting?.on ?? []).filter((f) => f !== form), off: (setting?.off ?? []).filter((f) => f !== form) };
  if (on !== readsByDefault(form, kind)) rest[on ? "on" : "off"].push(form);
  return rest.on.length || rest.off.length ? rest : null;
}

const FORM = /^[A-Za-z0-9-]{1,64}$/;
const MAX_FORMS = 100;

/** Wat er bewaard mag worden: enkel geldige namen, elk één keer, aan wint niet van uit (eerst gezien wint). */
export function cleanReadPhoto(raw: unknown): ReadPhoto | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const pick = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      // Vroeger heette het formulier om een item toe te voegen "dingen".
      .map((f) => (f === "dingen" ? ITEMS_FORM : f))
      .filter((f): f is string => typeof f === "string" && FORM.test(f) && !seen.has(f) && (seen.add(f), true))
      .slice(0, MAX_FORMS);
  const on = pick(o.on);
  const off = pick(o.off);
  return on.length || off.length ? { on, off } : null;
}
