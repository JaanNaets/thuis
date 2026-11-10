// Stap voor stap invullen in het palet: na "Uit eten · Het Forum" wordt het invulveld telkens het volgende veld (Score,
// Wat ik at, …) met suggesties; leeg is overslaan, na het laatste bewaar je. Hier: welke velden (`eventSteps`,
// `thingSteps`), wat je typte als waarde (`readStep`, met dezelfde lezer als het formulier: `parseFieldText`), de
// suggesties (`stepSuggestions`) en wat er bewaard wordt (`eventBody`, `thingBody`). Wat niet in één regel past (meer
// lijnen, een eigen verdeling, een foto, een timer) blijft in het volledige formulier: Alles invullen (`prefillOf`).

import { normalizeShares, parseFieldText, parseMoney, type Attributes, type FieldDef, type FieldType } from "./fields.ts";
import { defaultSharers } from "./ledger.ts";
import { BASES, type KindInfo, type Role } from "./model.ts";
import { fold } from "./targets.ts";

/** Veldsoorten die je in één regel invult. */
export const STEP_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "text",
  "longtext",
  "url",
  "email",
  "phone",
  "address",
  "number",
  "money",
  "score",
  "date",
  "time",
  "duration",
  "year",
  "select",
  "multi",
  "bool",
  "person",
]);

export type Step =
  | { key: string; label: string; type: "field"; def: FieldDef }
  | { key: "$name"; label: string; type: "name" }
  | { key: "$qty"; label: string; type: "qty"; unit: string | null }
  | { key: "$amount"; label: string; type: "amount" };

/** Wat je ingevuld hebt, per stap (de sleutel van het veld, of $name, $qty, $amount). */
export type StepValues = Record<string, unknown>;

const quick = (f: FieldDef) => STEP_TYPES.has(f.type);
const fieldStep = (def: FieldDef): Step => ({ key: def.key, label: def.label, type: "field", def });

/** Formulieren die je stap voor stap logt: geen activiteit (zonder einde loopt ze als timer) en geen overdracht (naar wie). */
export const canStep = (kind: Pick<KindInfo, "base"> | null | undefined): kind is KindInfo =>
  Boolean(kind && kind.base !== "activiteit" && kind.base !== "overdracht");

/**
 * Loggen met een formulier, eventueel over een ding: hoeveel (als het ding erbij komt of eraf gaat), de velden van het
 * formulier, en een bedrag (met geld, tenzij het formulier zelf een bedrag heeft of gepland begint).
 */
export function eventSteps(kind: KindInfo, thing?: { unit: string | null } | null): Step[] {
  const base = BASES[kind.base];
  const steps: Step[] = [];
  if (thing && (base.line === "in" || base.line === "uit")) steps.push({ key: "$qty", label: "Hoeveel", type: "qty", unit: thing.unit });
  steps.push(...kind.fields.filter(quick).map(fieldStep));
  if (base.money && !kind.planned && !kind.fields.some((f) => f.type === "money")) steps.push({ key: "$amount", label: "Bedrag", type: "amount" });
  return steps;
}

/** Een nieuw ding: de naam (als je die nog niet typte), dan de verplichte velden en die als kolom in de lijst staan. */
export function thingSteps(fields: FieldDef[], named: boolean): Step[] {
  return [...(named ? [] : [{ key: "$name", label: "Naam", type: "name" } as const]), ...fields.filter((f) => quick(f) && (f.required || f.column)).map(fieldStep)];
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Een keuze uit een lijst: precies, anders de eerste die zo begint (zonder hoofdletters of accenten). */
const pick = (options: string[], text: string) => options.find((o) => fold(o) === fold(text)) ?? options.find((o) => fold(o).startsWith(fold(text)));

export type StepRead = { value: unknown } | { skip: true } | { error: string };

/** Wat je typte als waarde voor deze stap; leeg is overslaan. */
export function readStep(step: Step, text: string, ctx: { today: string; people: { id: string; name: string }[] }): StepRead {
  const s = text.trim();
  if (!s) return { skip: true };
  if (step.type === "name") return { value: s.slice(0, 200) };
  if (step.type === "qty") {
    const n = Number(s.replace(",", ".").replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && n > 0 ? { value: n } : { error: "Hoeveel klopt niet" };
  }
  if (step.type === "amount") {
    const cents = parseMoney(s);
    return Number.isFinite(cents) && cents >= 0 ? { value: cents } : { error: "Het bedrag klopt niet" };
  }
  const def = step.def;
  const wrong = { error: `${def.label} klopt niet` };
  if (def.type === "person") {
    const p = ctx.people.find((x) => fold(x.name) === fold(s)) ?? ctx.people.find((x) => fold(x.name).startsWith(fold(s)));
    return p ? { value: p.id } : wrong;
  }
  if (def.type === "date") {
    const day = { vandaag: 0, gisteren: -1, eergisteren: -2, morgen: 1 }[fold(s)];
    if (day !== undefined) return { value: addDays(ctx.today, day) };
  }
  if (def.type === "select" && def.options?.length) {
    const option = pick(def.options, s);
    return option ? { value: option } : wrong;
  }
  const value = parseFieldText(def, s);
  return value === undefined || value === null ? wrong : { value };
}

/** Wat je eerder invulde in een veld, het vaakst eerst (van gebeurtenissen met dit formulier of dingen in de lijst). */
export function memoryOf(rows: Attributes[], key: string, max = 6): string[] {
  const count = new Map<string, number>();
  for (const row of rows) {
    const v = row[key];
    for (const x of Array.isArray(v) ? v : [v]) if (typeof x === "string" && x.trim()) count.set(x.trim(), (count.get(x.trim()) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, max).map(([v]) => v);
}

/** De suggesties bij een stap (tekst om in te vullen, met wat er staat); het palet filtert ze op wat je typt. */
export function stepSuggestions(step: Step, ctx: { people: { id: string; name: string }[]; memory: string[] }): { label: string; text: string }[] {
  const plain = (xs: string[]) => xs.map((x) => ({ label: x, text: x }));
  if (step.type !== "field") return plain(ctx.memory);
  const def = step.def;
  switch (def.type) {
    case "select":
      return plain(def.options ?? []);
    case "multi":
      return plain([...new Set([...ctx.memory, ...(def.options ?? [])])]);
    case "bool":
      return plain(["Ja", "Nee"]);
    case "score":
      return [1, 2, 3, 4, 5].map((n) => ({ label: "★".repeat(n), text: String(n) }));
    case "date":
      return plain(["Vandaag", "Gisteren"]);
    case "person":
      return plain(ctx.people.map((p) => p.name));
    default:
      return plain(ctx.memory);
  }
}

/** De velden van een formulier of lijst uit wat je invulde (enkel echte velden). */
const dataOf = (steps: Step[], values: StepValues): Attributes =>
  Object.fromEntries(steps.flatMap((s) => (s.type === "field" && values[s.key] !== undefined ? [[s.key, values[s.key] as Attributes[string]]] : []))) as Attributes;

/**
 * De gebeurtenis zoals het formulier ze zou bewaren: vandaag, gepland als het formulier (of jij) dat vraagt, het ding
 * als lijn (hoeveel, en bij één aankoop het bedrag als prijs), jij als betaler en in een lijst waar meer mensen loggen
 * gelijk verdeeld (`defaultSharers`).
 */
export function eventBody(
  kind: KindInfo,
  steps: Step[],
  values: StepValues,
  ctx: { thing?: { id: string; unit: string | null } | null; me: string; people: { id: string; role: Role }[]; today: string; planned?: boolean },
) {
  const base = BASES[kind.base];
  const data = dataOf(steps, values);
  const moneyField = kind.fields.find((f) => f.type === "money");
  const amount = typeof values.$amount === "number" ? values.$amount : moneyField && typeof data[moneyField.key] === "number" ? (data[moneyField.key] as number) : null;
  const sharers = base.money ? defaultSharers(kind.base, ctx.people) : [];
  const qty = typeof values.$qty === "number" ? values.$qty : null;
  return {
    kind: kind.id,
    name: "",
    status: kind.planned || ctx.planned ? "gepland" : "gebeurd",
    at: ctx.today,
    end_at: null,
    amount: base.money ? amount : null,
    paid_by: base.money ? ctx.me : null,
    to_person: null,
    split: sharers.length ? normalizeShares(sharers.map((id) => ({ person_id: id }))) : null,
    data,
    lines: ctx.thing
      ? [{ role: base.line, thing_id: ctx.thing.id, amount: qty, unit: ctx.thing.unit, price: kind.base === "aankoop" ? amount : null, expires: null, owner: null }]
      : [],
    repeat: null,
  };
}

/** Een nieuw ding: de naam en de velden die je invulde. */
export function thingBody(name: string, steps: Step[], values: StepValues) {
  return { name: (typeof values.$name === "string" ? values.$name : name).trim(), data: dataOf(steps, values) };
}

/** Wat al ingevuld is, voor het volledige formulier (`?vooraf=`): de velden, en $amount en $qty voor een gebeurtenis. */
export function prefillOf(steps: Step[], values: StepValues): Record<string, unknown> {
  const out: Record<string, unknown> = { ...dataOf(steps, values) };
  if (typeof values.$amount === "number") out.$amount = values.$amount;
  if (typeof values.$qty === "number") out.$qty = values.$qty;
  return out;
}
