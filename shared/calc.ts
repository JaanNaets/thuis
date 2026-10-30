// Berekeningen: een veld dat de app zelf uitrekent. Bewust eenvoudig: een handvol soorten, elk met één duidelijke
// vraag, en een berekening kan op een andere berekening verder bouwen (Totaal = Aantal × Prijs, Met btw = Totaal × 1,21).
//
// - Binnen het item: rekensom, formule (zelf geschreven, zie shared/formula.ts), vergelijking (ja/nee), dagen tot,
//   tijd sinds, datum plus.
// - Link-modules: een veld uit een gelinkt item (opzoeken), en samenvatten over gelinkte items: die in een
//   Verwijzing(en)-veld staan, of die naar dit item verwijzen (bv. hoeveel je bij een verkoper uitgaf).
//
// De API kijkt elke berekening na (`checkCalcs`) en zet de soort van de uitkomst (`result`). Uitrekenen gebeurt bij
// het lezen; niets wordt bewaard. Opzoeken en samenvatten doet de Worker (die weet wat je mag zien).

import type { Attributes, FieldDef, FieldType, FieldValue, Interval, IntervalUnit } from "./fields.ts";
import { evalFormula, FORMULA_MAX, formulaRefs, inferFormula, mapRefs, parseFormula, printFormula, type FKind } from "./formula.ts";

export type Operand = { field: string } | { value: number };
export type MathOp = "+" | "-" | "*" | "/";
export type CompareOp = "<" | "<=" | ">" | ">=" | "=" | "!=";
export type Agg = "count" | "sum" | "avg" | "min" | "max";
export type SinceUnit = "day" | "month" | "year";

export type CalcDef =
  | { kind: "math"; op: MathOp; a: Operand; b: Operand }
  | { kind: "formula"; expr: string }
  | { kind: "compare"; op: CompareOp; a: Operand; b: Operand }
  | { kind: "days_until"; field: string }
  | { kind: "since"; field: string; unit: SinceUnit }
  | { kind: "date_add"; field: string; add: { field: string } | { n: number; unit: IntervalUnit } }
  | { kind: "lookup"; via: string; field: string }
  | { kind: "rollup"; from: "links" | "backlinks"; via: string; list?: string; agg: Agg; field?: string };
export type CalcKind = CalcDef["kind"];

/** De soort van de uitkomst: zo wordt ze getoond (een bedrag, een datum, ja/nee, ...). */
export type CalcResult = FieldType;

export const CALC_KINDS = {
  math: { label: "Rekensom", hint: "Twee velden (of een veld en een getal) optellen, aftrekken, vermenigvuldigen of delen. Bv. Aantal × Prijs per fles." },
  formula: {
    label: "Formule",
    hint: "Een eigen som met velden tussen [ ], zoals [kcal per 100 g] × [Hoeveel] ÷ 100. Ook haakjes, afronden, min, max, als en of (het eerste dat ingevuld is).",
  },
  compare: { label: "Vergelijking (ja/nee)", hint: "Ja als de vergelijking klopt. Bv. Aantal ≤ Bijna op onder: dan weet je wat je moet kopen." },
  days_until: { label: "Dagen tot", hint: "Hoeveel dagen tot een datum; negatief als ze voorbij is. Bv. tot de garantie afloopt." },
  since: { label: "Tijd sinds", hint: "Hoe lang geleden een datum of jaar was. Bv. hoe oud een fiets of een wijn is." },
  date_add: { label: "Datum plus", hint: "Een datum plus een vaste tijd of een Herhaling. Bv. Laatst onderhouden + elk jaar = volgende keer." },
  lookup: { label: "Uit een gelinkt item", hint: "Toont een veld van het item waarnaar een Verwijzing wijst. Bv. het land van het wijnhuis." },
  rollup: {
    label: "Samenvatten",
    hint: "Telt of rekent over gelinkte items: hoeveel, de som, het gemiddelde, het kleinste of grootste. Bv. hoeveel je bij een verkoper uitgaf.",
  },
} as const satisfies Record<CalcKind, { label: string; hint: string }>;

export const MATH_OPS = { "+": "plus", "-": "min", "*": "maal", "/": "gedeeld door" } as const satisfies Record<MathOp, string>;
export const COMPARE_OPS = {
  "<": "kleiner dan",
  "<=": "kleiner dan of gelijk aan",
  ">": "groter dan",
  ">=": "groter dan of gelijk aan",
  "=": "gelijk aan",
  "!=": "niet gelijk aan",
} as const satisfies Record<CompareOp, string>;
export const AGGS = {
  count: "Hoeveel",
  sum: "Som",
  avg: "Gemiddelde",
  min: "Kleinste (of vroegste)",
  max: "Grootste (of laatste)",
} as const satisfies Record<Agg, string>;
export const SINCE_UNITS = { day: "dagen", month: "maanden", year: "jaar" } as const satisfies Record<SinceUnit, string>;

/** Soorten waarmee je kan rekenen. */
export const NUMERIC: FieldType[] = ["number", "money", "score", "year", "duration"];
/** Wat je uit een gelinkt item kan tonen (geen mensen of verwijzingen: die horen bij dat item). */
export const LOOKUP_TYPES: FieldType[] = [
  "text",
  "url",
  "email",
  "phone",
  "address",
  "code",
  "number",
  "money",
  "score",
  "date",
  "date_range",
  "time",
  "duration",
  "year",
  "year_range",
  "interval",
  "select",
  "multi",
  "bool",
];

/** Een lijst zoals de berekeningen ze nodig hebben (een ItemType volstaat). */
export type CalcList = { id: string; name: string; plural: string; fields: FieldDef[] };

/** De soort van een veld zoals een berekening ze ziet: een berekening telt als haar uitkomst. */
export const typeOf = (def: FieldDef | undefined): FieldType | undefined => (def?.type === "calc" ? def.result : def?.type);
/** Opzoeken of samenvatten: rekent met andere items (de Worker vult ze in). */
export const isLinkCalc = (def: FieldDef | undefined) => def?.type === "calc" && (def.calc?.kind === "lookup" || def.calc?.kind === "rollup");

/** De velden van dit item die een berekening leest (voor de rechten: zie je er een niet, dan ook de uitkomst niet). */
export function calcSources(calc: CalcDef): string[] {
  switch (calc.kind) {
    case "math":
    case "compare":
      return [calc.a, calc.b].flatMap((o) => ("field" in o ? [o.field] : []));
    case "formula":
      return formulaKeys(calc.expr);
    case "days_until":
    case "since":
      return [calc.field];
    case "date_add":
      return "field" in calc.add ? [calc.field, calc.add.field] : [calc.field];
    case "lookup":
      return [calc.via];
    case "rollup":
      return calc.from === "links" ? [calc.via] : [];
  }
}

/**
 * Een veld met alles waarvan het afhangt (voor een berekening: de velden die ze leest, en zo verder). Wie één ervan
 * niet mag zien, krijgt de uitkomst niet.
 */
export function fieldDeps(fields: FieldDef[], key: string, seen = new Set<string>()): string[] {
  if (seen.has(key)) return [];
  seen.add(key);
  const def = fields.find((f) => f.key === key);
  const sources = def?.type === "calc" && def.calc && !isLinkCalc(def) ? calcSources(def.calc) : [];
  return [key, ...sources.flatMap((k) => fieldDeps(fields, k, seen))];
}

/**
 * De sleutels van eigen velden in een berekening vervangen (een nieuw veld krijgt pas bij het bewaren zijn sleutel,
 * en een sjabloon krijgt nieuwe id's voor zijn lijsten). `rename`: eigen sleutel → nieuwe; `refOf`: naar welke lijst
 * een eigen verwijzing wijst; `selfId`: deze lijst (een opzoeking binnen dezelfde lijst gebruikt ook eigen sleutels).
 * `list`: een andere lijst-id vervangen (bij samenvatten van wat hiernaar verwijst).
 */
export function renameCalc(
  calc: CalcDef,
  rename: (key: string) => string,
  refOf: (key: string) => string | undefined,
  selfId: string,
  list: (id: string) => string = (id) => id,
): CalcDef {
  const o = (x: Operand): Operand => ("field" in x ? { field: rename(x.field) } : x);
  const remote = (via: string, key: string) => (refOf(via) === selfId ? rename(key) : key);
  switch (calc.kind) {
    case "math":
    case "compare":
      return { ...calc, a: o(calc.a), b: o(calc.b) };
    case "formula":
      try {
        return { kind: "formula", expr: printFormula(mapRefs(parseFormula(calc.expr), rename), keyRef) };
      } catch {
        return calc;
      }
    case "days_until":
    case "since":
      return { ...calc, field: rename(calc.field) };
    case "date_add":
      return { ...calc, field: rename(calc.field), add: "field" in calc.add ? { field: rename(calc.add.field) } : calc.add };
    case "lookup":
      return { ...calc, via: rename(calc.via), field: remote(calc.via, calc.field) };
    case "rollup":
      if (calc.from === "links") return { ...calc, via: rename(calc.via), ...(calc.field ? { field: remote(calc.via, calc.field) } : {}) };
      if (calc.list === selfId) return { ...calc, list: list(calc.list), via: rename(calc.via), ...(calc.field ? { field: rename(calc.field) } : {}) };
      return { ...calc, ...(calc.list ? { list: list(calc.list) } : {}) };
  }
}

/** Zo staat een veld in een bewaarde formule: met zijn sleutel. */
const keyRef = (key: string) => `[${key}]`;

/** De sleutels in een bewaarde formule (leeg als ze niet te lezen is). */
function formulaKeys(expr: string): string[] {
  try {
    return formulaRefs(parseFormula(expr));
  } catch {
    return [];
  }
}

/**
 * Een formule zoals iemand ze typt (velden met hun naam) naar hoe ze bewaard wordt (velden met hun sleutel). Een
 * naam die geen veld is, blijft staan (de controle zegt dan welk veld niet bestaat). Gooit een fout als de formule
 * niet te lezen is.
 */
export function formulaFromLabels(text: string, fields: FieldDef[]): string {
  const byLabel = (name: string) => fields.find((f) => f.label.toLowerCase() === name.toLowerCase())?.key ?? fields.find((f) => f.key === name)?.key ?? name;
  return printFormula(mapRefs(parseFormula(text), byLabel), keyRef);
}

/** Een bewaarde formule zoals iemand ze leest en typt: [kcal per 100 g] × [Hoeveel] ÷ 100. */
export function formulaToLabels(expr: string, fields: FieldDef[]): string {
  try {
    return printFormula(parseFormula(expr), (key) => `[${fields.find((f) => f.key === key)?.label ?? key}]`, true);
  } catch {
    return expr;
  }
}

function cleanOperand(raw: unknown): Operand {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o.field === "string" && o.field) return { field: o.field };
  if (typeof o.value === "number" && Number.isFinite(o.value) && Math.abs(o.value) < 1e9) return { value: o.value };
  throw new Error("kies een veld of typ een getal");
}

/** De vorm van een berekening nakijken (zonder de andere velden te kennen). */
function cleanShape(raw: CalcDef): CalcDef {
  const o = raw as unknown as Record<string, unknown>;
  const str = (k: string) => {
    if (typeof o[k] !== "string" || !o[k]) throw new Error("kies een veld");
    return o[k] as string;
  };
  switch (o.kind) {
    case "math":
      if (!Object.hasOwn(MATH_OPS, String(o.op))) throw new Error("kies een bewerking");
      return { kind: "math", op: o.op as MathOp, a: cleanOperand(o.a), b: cleanOperand(o.b) };
    case "formula": {
      if (typeof o.expr !== "string" || !o.expr.trim()) throw new Error("typ een formule");
      if (o.expr.length > FORMULA_MAX) throw new Error(`een formule is hoogstens ${FORMULA_MAX} tekens`);
      return { kind: "formula", expr: printFormula(parseFormula(o.expr), keyRef) };
    }
    case "compare":
      if (!Object.hasOwn(COMPARE_OPS, String(o.op))) throw new Error("kies een vergelijking");
      return { kind: "compare", op: o.op as CompareOp, a: cleanOperand(o.a), b: cleanOperand(o.b) };
    case "days_until":
      return { kind: "days_until", field: str("field") };
    case "since":
      if (!Object.hasOwn(SINCE_UNITS, String(o.unit))) throw new Error("kies dagen, maanden of jaar");
      return { kind: "since", field: str("field"), unit: o.unit as SinceUnit };
    case "date_add": {
      const add = (o.add ?? {}) as Record<string, unknown>;
      if (typeof add.field === "string" && add.field) return { kind: "date_add", field: str("field"), add: { field: add.field } };
      const n = add.n;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 1000 || !["day", "week", "month", "year"].includes(String(add.unit)))
        throw new Error("kies hoeveel tijd erbij komt");
      return { kind: "date_add", field: str("field"), add: { n, unit: add.unit as IntervalUnit } };
    }
    case "lookup":
      return { kind: "lookup", via: str("via"), field: str("field") };
    case "rollup": {
      if (o.from !== "links" && o.from !== "backlinks") throw new Error("kies welke items");
      if (!Object.hasOwn(AGGS, String(o.agg))) throw new Error("kies wat je wil weten");
      const agg = o.agg as Agg;
      return {
        kind: "rollup",
        from: o.from,
        via: str("via"),
        ...(o.from === "backlinks" ? { list: str("list") } : {}),
        agg,
        ...(agg === "count" ? {} : { field: str("field") }),
      };
    }
    default:
      throw new Error("kies wat de app uitrekent");
  }
}

/**
 * Alle berekeningen van een lijst nakijken en hun uitkomst bepalen. `lists`: de lijsten waarnaar verwezen kan
 * worden (met de lijst zelf als ze al bestaat); `selfId`: de id van deze lijst. Gooit een fout met uitleg.
 */
export function checkCalcs(fields: FieldDef[], lists: CalcList[], selfId: string): FieldDef[] {
  const { fields: out, errors } = previewCalcs(fields, lists, selfId);
  const first = out.find((f) => errors[f.key]);
  if (first) throw new Error(errors[first.key]);
  return out;
}

/**
 * Zoals `checkCalcs`, maar zonder te stoppen bij een fout: elke berekening krijgt een uitkomst of een fout (voor
 * het scherm waarin je een lijst samenstelt, terwijl je typt).
 */
export function previewCalcs(fields: FieldDef[], lists: CalcList[], selfId: string): { fields: FieldDef[]; errors: Record<string, string> } {
  const out: FieldDef[] = fields.map((f) => ({ ...f }));
  const errors: Record<string, string> = {};
  const byKey = new Map(out.map((f) => [f.key, f]));
  const listById = (id: string | undefined): CalcList | undefined =>
    id === selfId ? { id: selfId, name: "", plural: "", fields: out } : lists.find((l) => l.id === id);
  const calcs = out.filter((f) => f.type === "calc");
  for (const f of calcs) {
    delete f.result;
    try {
      f.calc = cleanShape(f.calc as CalcDef);
    } catch (err) {
      errors[f.key] = `${f.label}: ${(err as Error).message}`;
    }
  }
  const settle = (f: FieldDef, final: boolean) => {
    try {
      const result = resultOf(f, byKey, listById, selfId, errors, final);
      if (result === "wait") return false;
      f.result = result;
    } catch (err) {
      errors[f.key] = (err as Error).message;
    }
    return true;
  };

  // Een berekening op een berekening: telkens wat al bekend is, tot alles een uitkomst heeft (of er een kring is).
  for (let round = 0; round <= calcs.length; round++) {
    let progress = false;
    for (const f of calcs) if (!f.result && !errors[f.key] && settle(f, false)) progress = true;
    if (!progress) break;
  }
  // Wat dan nog wacht, wacht op elkaar: een kring. Nog eens zonder wachten geeft een duidelijke fout.
  for (const f of calcs) if (!f.result && !errors[f.key]) settle(f, true);
  for (const f of calcs) {
    if (!f.unit && f.calc?.kind === "days_until") f.unit = "dagen";
    if (!f.unit && f.calc?.kind === "since") f.unit = SINCE_UNITS[f.calc.unit];
  }
  return { fields: out, errors };
}

/** De uitkomst van één berekening; "wait" als ze afhangt van een berekening die nog geen uitkomst heeft. */
function resultOf(
  f: FieldDef,
  byKey: Map<string, FieldDef>,
  listById: (id: string | undefined) => CalcList | undefined,
  selfId: string,
  errors: Record<string, string>,
  final = false,
): CalcResult | "wait" {
  const calc = f.calc!;
  const fail = (message: string): never => {
    throw new Error(`${f.label}: ${message}`);
  };
  /** Een veld van dit item, met zijn soort (of wachten op een berekening). */
  const own = (key: string): FieldDef => {
    if (key === f.key) fail("een berekening kan niet zichzelf gebruiken");
    const def = byKey.get(key);
    if (!def) fail("een gekozen veld bestaat niet (meer)");
    return def!;
  };
  const waiting = (def: FieldDef) => {
    if (def.type !== "calc" || def.result) return false;
    if (byKey.get(def.key) === def && errors[def.key]) fail(`"${def.label}" klopt nog niet`);
    if (final) fail("berekeningen mogen niet in een kring naar elkaar verwijzen");
    return true;
  };
  const numeric = (o: Operand): FieldType | "const" | "wait" => {
    if ("value" in o) return "const";
    const def = own(o.field);
    if (waiting(def)) return "wait";
    const t = typeOf(def);
    if (!t || !NUMERIC.includes(t)) fail(`"${def.label}" is geen getal, bedrag of duur`);
    return t === "score" || t === "year" ? "number" : t!;
  };
  const dateField = (key: string, allowYear = false): FieldType | "wait" => {
    const def = own(key);
    if (waiting(def)) return "wait";
    const t = typeOf(def);
    if (t !== "date" && !(allowYear && t === "year")) fail(`"${def.label}" is geen datum${allowYear ? " of jaar" : ""}`);
    return t!;
  };
  /** Een veld in een (andere) lijst dat je kan opzoeken of samenvatten (geen opzoeking op een opzoeking). */
  const remote = (list: CalcList, key: string, allowed: FieldType[]): FieldType | "wait" => {
    const def = list.fields.find((x) => x.key === key);
    if (!def) fail(`het veld bestaat niet (meer) in ${list.plural || "die lijst"}`);
    if (isLinkCalc(def)) fail("je kan geen opzoeking of samenvatting verder opzoeken");
    if (waiting(def!)) return "wait";
    const t = typeOf(def);
    if (!t || !allowed.includes(t)) fail(`"${def!.label}" kan je hier niet gebruiken`);
    return t!;
  };

  switch (calc.kind) {
    case "math": {
      const a = numeric(calc.a);
      const b = numeric(calc.b);
      if (a === "wait" || b === "wait") return "wait";
      const kinds = [a, b];
      if (calc.op === "+" || calc.op === "-") return kinds.includes("money") ? "money" : kinds.includes("duration") ? "duration" : "number";
      if (calc.op === "*")
        return kinds.includes("money") && !(a === "money" && b === "money")
          ? "money"
          : kinds.includes("duration") && !(a === "duration" && b === "duration")
            ? "duration"
            : "number";
      // Delen: bedrag ÷ getal = bedrag, bedrag ÷ bedrag = getal.
      if (a === "money" && b !== "money") return "money";
      if (a === "duration" && b !== "duration") return "duration";
      return "number";
    }
    case "formula": {
      let kind: FKind | "wait";
      try {
        kind = inferFormula(parseFormula(calc.expr), (key) => {
          const def = own(key);
          if (waiting(def)) return "wait";
          return formulaKind(def) ?? fail(`"${def.label}" is geen getal, bedrag, duur of ja/nee`);
        });
      } catch (err) {
        // Een fout van `own` of `waiting` heeft de naam van het veld al; een fout in de formule nog niet.
        const message = (err as Error).message;
        throw new Error(message.startsWith(`${f.label}: `) ? message : `${f.label}: ${message}`);
      }
      return kind === "wait" ? "wait" : kind === "const" ? "number" : kind;
    }
    case "compare": {
      if (numeric(calc.a) === "wait" || numeric(calc.b) === "wait") return "wait";
      return "bool";
    }
    case "days_until":
      return dateField(calc.field) === "wait" ? "wait" : "number";
    case "since":
      return dateField(calc.field, true) === "wait" ? "wait" : "number";
    case "date_add": {
      if (dateField(calc.field) === "wait") return "wait";
      if ("field" in calc.add) {
        const def = own(calc.add.field);
        if (def.type !== "interval") fail(`"${def.label}" is geen Herhaling`);
      }
      return "date";
    }
    case "lookup": {
      const via = own(calc.via);
      if (via.type !== "item") fail(`"${via.label}" is geen Verwijzing`);
      const list = listById(via.ref_type);
      if (!list) fail("de gelinkte lijst bestaat hier niet");
      return remote(list!, calc.field, LOOKUP_TYPES);
    }
    case "rollup": {
      let list: CalcList | undefined;
      if (calc.from === "links") {
        const via = own(calc.via);
        if (via.type !== "item" && via.type !== "items") fail(`"${via.label}" is geen Verwijzing`);
        list = listById(via.ref_type);
      } else {
        list = listById(calc.list);
        const via = list?.fields.find((x) => x.key === calc.via);
        if (!list || !via || (via.type !== "item" && via.type !== "items") || via.ref_type !== selfId)
          fail("kies een lijst met een Verwijzing naar deze lijst");
      }
      if (!list) fail("de gelinkte lijst bestaat hier niet");
      if (calc.agg === "count") return "number";
      const allowed: FieldType[] = calc.agg === "min" || calc.agg === "max" ? [...NUMERIC, "date"] : NUMERIC;
      const t = remote(list!, calc.field!, allowed);
      if (t === "wait") return "wait";
      return t === "score" || t === "year" ? (calc.agg === "min" || calc.agg === "max" ? t : "number") : t;
    }
  }
}

/** Wat een veld in een formule is (zie shared/formula.ts); undefined als je het er niet in kan gebruiken. */
function formulaKind(def: FieldDef | undefined): FKind | undefined {
  const t = typeOf(def);
  if (t === "money" || t === "duration" || t === "bool") return t;
  return t && NUMERIC.includes(t) ? "number" : undefined;
}

// ---------- in woorden ----------

const AGG_WORDS = { count: "Hoeveel", sum: "Som", avg: "Gemiddelde", min: "Kleinste", max: "Grootste" } as const satisfies Record<Agg, string>;

/**
 * Wat een berekening doet, in woorden (voor een tooltip): "Aantal maal Prijs", "Dagen tot Vervalt op", "Som van
 * Bedrag van de Uitgaven die hiernaar verwijzen". `lists`: de andere lijsten (voor opzoeken en samenvatten).
 */
export function describeCalc(def: FieldDef, fields: FieldDef[], lists: CalcList[] = []): string {
  const calc = def.calc;
  if (!calc) return "";
  const label = (key: string | undefined, among: FieldDef[] = fields) => among.find((f) => f.key === key)?.label ?? "?";
  const operand = (o: Operand) => ("field" in o ? label(o.field) : String(o.value).replace(".", ","));
  const listOf = (id: string | undefined) => lists.find((l) => l.id === id);
  switch (calc.kind) {
    case "math":
      return `${operand(calc.a)} ${MATH_OPS[calc.op]} ${operand(calc.b)}`;
    case "formula":
      try {
        return printFormula(parseFormula(calc.expr), (key) => label(key), true);
      } catch {
        return calc.expr;
      }
    case "compare":
      return `Ja als ${operand(calc.a)} ${COMPARE_OPS[calc.op]} ${operand(calc.b)}`;
    case "days_until":
      return `Dagen tot ${label(calc.field)}`;
    case "since":
      return `Hoeveel ${SINCE_UNITS[calc.unit]} sinds ${label(calc.field)}`;
    case "date_add": {
      const add = "field" in calc.add ? label(calc.add.field) : `${calc.add.n} ${INTERVAL_WORDS[calc.add.unit][calc.add.n === 1 ? 0 : 1]}`;
      return `${label(calc.field)} plus ${add}`;
    }
    case "lookup": {
      const via = fields.find((f) => f.key === calc.via);
      const list = listOf(via?.ref_type);
      return `${label(calc.field, list?.fields ?? fields)} van ${via?.label ?? "?"}`;
    }
    case "rollup": {
      if (calc.from === "links") {
        const via = fields.find((f) => f.key === calc.via);
        const list = listOf(via?.ref_type);
        const field = label(calc.field, list?.fields ?? fields);
        return calc.agg === "count" ? `Hoeveel items in ${via?.label ?? "?"}` : `${AGG_WORDS[calc.agg]} van ${field} in ${via?.label ?? "?"}`;
      }
      const list = listOf(calc.list);
      const plural = list?.plural ?? "items";
      const which = `de ${plural} die hiernaar verwijzen`;
      return calc.agg === "count"
        ? `Hoeveel ${plural} hiernaar verwijzen`
        : `${AGG_WORDS[calc.agg]} van ${label(calc.field, list?.fields ?? fields)} van ${which}`;
    }
  }
}

const INTERVAL_WORDS = { day: ["dag", "dagen"], week: ["week", "weken"], month: ["maand", "maanden"], year: ["jaar", "jaar"] } as const satisfies Record<
  IntervalUnit,
  readonly [string, string]
>;

// ---------- uitrekenen ----------

const num = (v: FieldValue | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const DAY = 86_400_000;
const isoDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** Een datum plus een aantal dagen, weken, maanden of jaren (31 januari + 1 maand = 28 of 29 februari). */
export function addToDate(iso: string, n: number, unit: IntervalUnit): string {
  const d = new Date(isoDay(iso));
  if (unit === "day" || unit === "week") return new Date(d.getTime() + n * (unit === "week" ? 7 : 1) * DAY).toISOString().slice(0, 10);
  const months = unit === "year" ? n * 12 : n;
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return target.toISOString().slice(0, 10);
}

/** Hele dagen, maanden of jaren tussen twee datums (zoals een leeftijd: een jaar is pas om op de verjaardag). */
export function between(from: string, to: string, unit: SinceUnit): number {
  if (unit === "day") return Math.round((isoDay(to) - isoDay(from)) / DAY);
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  const months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  return unit === "month" ? months : Math.trunc(months / 12);
}

const round = (value: number, result: CalcResult | undefined) =>
  result === "money" || result === "duration" ? Math.round(value) : Math.round(value * 1000) / 1000;

/**
 * De berekeningen binnen een item uitrekenen (alles behalve opzoeken en samenvatten: die staan er al in, van de
 * Worker). Een berekening waarvan een veld ontbreekt, blijft leeg. Geeft de waarden met de uitkomsten erbij.
 */
export function computeLocal(defs: FieldDef[], data: Attributes, today = new Date().toISOString().slice(0, 10)): Attributes {
  const out: Attributes = { ...data };
  const local = defs.filter((d) => d.type === "calc" && d.calc && d.result && !isLinkCalc(d));
  for (const d of local) delete out[d.key];
  const operand = (o: Operand, d: FieldDef, other: Operand): number | undefined => {
    if ("field" in o) return num(out[o.field]);
    // Een getal bij een bedrag optellen of aftrekken is in euro; bij een duur in minuten.
    const calc = d.calc as Extract<CalcDef, { kind: "math" | "compare" }>;
    const otherDef = "field" in other ? defs.find((x) => x.key === other.field) : undefined;
    const otherType = typeOf(otherDef);
    if (otherType === "money" && (calc.kind === "compare" || calc.op === "+" || calc.op === "-")) return Math.round(o.value * 100);
    return o.value;
  };
  // In een paar rondes, zodat een berekening op een berekening ook lukt (de volgorde van de velden maakt niet uit).
  for (let pass = 0; pass < local.length; pass++) {
    let changed = false;
    for (const d of local) {
      if (out[d.key] !== undefined) continue;
      const value = computeOne(d, out, today, operand, defs);
      if (value === undefined) continue;
      out[d.key] = value;
      changed = true;
    }
    if (!changed) break;
  }
  return out;
}

function computeOne(
  d: FieldDef,
  data: Attributes,
  today: string,
  operand: (o: Operand, d: FieldDef, other: Operand) => number | undefined,
  defs: FieldDef[],
): FieldValue | undefined {
  const calc = d.calc!;
  switch (calc.kind) {
    case "formula": {
      const defOf = (key: string) => defs.find((x) => x.key === key);
      try {
        const value = evalFormula(
          parseFormula(calc.expr),
          (key) => {
            const v = data[key];
            return typeof v === "number" || typeof v === "boolean" ? v : undefined;
          },
          (key) => formulaKind(defOf(key)) ?? "number",
        );
        return typeof value === "number" ? round(value, d.result) : value;
      } catch {
        return undefined;
      }
    }
    case "math": {
      const a = operand(calc.a, d, calc.b);
      const b = operand(calc.b, d, calc.a);
      if (a === undefined || b === undefined) return undefined;
      const value = calc.op === "+" ? a + b : calc.op === "-" ? a - b : calc.op === "*" ? a * b : b === 0 ? undefined : a / b;
      return value === undefined || !Number.isFinite(value) ? undefined : round(value, d.result);
    }
    case "compare": {
      const a = operand(calc.a, d, calc.b);
      const b = operand(calc.b, d, calc.a);
      if (a === undefined || b === undefined) return undefined;
      return { "<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b, "=": a === b, "!=": a !== b }[calc.op];
    }
    case "days_until": {
      const v = data[calc.field];
      return typeof v === "string" ? between(today, v, "day") : undefined;
    }
    case "since": {
      const v = data[calc.field];
      if (typeof v === "number") return calc.unit === "year" ? Number(today.slice(0, 4)) - v : undefined;
      return typeof v === "string" ? between(v, today, calc.unit) : undefined;
    }
    case "date_add": {
      const v = data[calc.field];
      if (typeof v !== "string") return undefined;
      const add = "field" in calc.add ? (data[calc.add.field] as Interval | undefined) : calc.add;
      return add && typeof add === "object" && "unit" in add ? addToDate(v, add.n, add.unit) : undefined;
    }
    default:
      return undefined;
  }
}

/** Samenvatten: hoeveel, som, gemiddelde, kleinste of grootste van de waarden (getallen of datums). */
export function aggregate(agg: Agg, values: FieldValue[], count: number, result: CalcResult | undefined): FieldValue | undefined {
  if (agg === "count") return count;
  const list = values.filter((v): v is number | string => typeof v === "number" || typeof v === "string");
  if (!list.length) return agg === "sum" ? 0 : undefined;
  if (agg === "min" || agg === "max") return list.reduce((best, v) => ((agg === "min" ? v < best : v > best) ? v : best));
  const numbers = list.filter((v): v is number => typeof v === "number");
  const sum = numbers.reduce((s, v) => s + v, 0);
  return round(agg === "sum" ? sum : sum / numbers.length, result);
}
