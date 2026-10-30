// Formules: een berekening die je zelf schrijft, zoals [kcal per 100 g] × [Hoeveel] ÷ 100. Velden staan tussen
// vierkante haakjes; verder getallen (1,5 of 1.5), + − × ÷, haakjes, vergelijkingen (< ≤ > ≥ = ≠) en een paar
// functies: afronden(x; decimalen), min(…), max(…), als(voorwaarde; dan; anders) en of(a; b): het eerste dat
// ingevuld is (bv. de kcal van het product, anders die van het recept). Argumenten scheid je met ";".
//
// Nooit eval: de formule wordt gelezen tot een boom, nagekeken (`inferFormula`) en zo uitgerekend (`evalFormula`).
// Bewaard met de sleutels van de velden ([kcal_100] * [gram] / 100); wie ze leest of typt, ziet de namen.

import type { CompareOp } from "./calc.ts";

export type FnName = "afronden" | "min" | "max" | "als" | "of";
export type FNode =
  | { t: "num"; v: number }
  | { t: "field"; ref: string }
  | { t: "neg"; a: FNode }
  | { t: "op"; op: "+" | "-" | "*" | "/"; a: FNode; b: FNode }
  | { t: "cmp"; op: CompareOp; a: FNode; b: FNode }
  | { t: "fn"; name: FnName; args: FNode[] };

/**
 * Wat een deel van een formule is: een getal, een bedrag (in cent), een duur (in minuten), ja/nee, of een los getal
 * dat zich aanpast aan wat ernaast staat (`[Prijs] + 2` is twee euro, `[Prijs] × 2` is maal twee).
 */
export type FKind = "number" | "money" | "duration" | "bool" | "const";

export const FORMULA_MAX = 300;
const MAX_NODES = 120;
const FUNCTIONS: Record<FnName, { min: number; max: number }> = {
  afronden: { min: 1, max: 2 },
  min: { min: 1, max: 20 },
  max: { min: 1, max: 20 },
  als: { min: 3, max: 3 },
  of: { min: 2, max: 5 },
};

// ---------- lezen ----------

type Token =
  | { k: "num"; v: number }
  | { k: "field"; name: string }
  | { k: "name"; name: string }
  | { k: "op"; op: string }
  | { k: "(" }
  | { k: ")" }
  | { k: ";" };

const OP_ALIASES: Record<string, string> = { "×": "*", "·": "*", "÷": "/", ":": "/", "−": "-", "–": "-", "≤": "<=", "≥": ">=", "≠": "!=", "<>": "!=", "==": "=" };

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "[") {
      const end = text.indexOf("]", i + 1);
      if (end < 0) throw new Error("een [ wordt niet gesloten met ]");
      const name = text.slice(i + 1, end).trim();
      if (!name) throw new Error("tussen [ en ] hoort de naam van een veld");
      out.push({ k: "field", name });
      i = end + 1;
      continue;
    }
    const number = /^\d+(?:[.,]\d+)?/.exec(text.slice(i));
    if (number) {
      out.push({ k: "num", v: Number(number[0].replace(",", ".")) });
      i += number[0].length;
      continue;
    }
    const word = /^[A-Za-zÀ-ÖØ-öø-ÿ]+/.exec(text.slice(i));
    if (word) {
      out.push({ k: "name", name: word[0].toLowerCase() });
      i += word[0].length;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (["<=", ">=", "<>", "!=", "=="].includes(two)) {
      out.push({ k: "op", op: OP_ALIASES[two] ?? two });
      i += 2;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === ";") {
      out.push({ k: ch });
      i++;
      continue;
    }
    if ("+-*/<>=×·÷:−–≤≥≠".includes(ch)) {
      out.push({ k: "op", op: OP_ALIASES[ch] ?? ch });
      i++;
      continue;
    }
    if (ch === ",") throw new Error('scheid wat tussen haakjes staat met ";" (een komma is voor decimalen)');
    throw new Error(`"${ch}" begrijp ik niet`);
  }
  return out;
}

const COMPARE = ["<", "<=", ">", ">=", "=", "!="];

/** Een formule lezen tot een boom. `[naam]` wordt een veld met die naam (zie `mapRefs` om namen om te zetten). */
export function parseFormula(text: string): FNode {
  if (text.length > FORMULA_MAX) throw new Error(`een formule is hoogstens ${FORMULA_MAX} tekens`);
  const tokens = tokenize(text);
  if (!tokens.length) throw new Error("typ een formule");
  let pos = 0;
  let nodes = 0;
  const node = <T extends FNode>(n: T): T => {
    if (++nodes > MAX_NODES) throw new Error("de formule is te lang");
    return n;
  };
  const peek = () => tokens[pos];
  const isOp = (t: Token | undefined, ...ops: string[]) => t?.k === "op" && ops.includes(t.op);

  const expr = (): FNode => {
    const a = sum();
    const t = peek();
    if (t?.k === "op" && COMPARE.includes(t.op)) {
      pos++;
      return node({ t: "cmp", op: t.op as CompareOp, a, b: sum() });
    }
    return a;
  };
  const sum = (): FNode => {
    let a = product();
    while (isOp(peek(), "+", "-")) {
      const op = (tokens[pos++] as { op: "+" | "-" }).op;
      a = node({ t: "op", op, a, b: product() });
    }
    return a;
  };
  const product = (): FNode => {
    let a = unary();
    while (isOp(peek(), "*", "/")) {
      const op = (tokens[pos++] as { op: "*" | "/" }).op;
      a = node({ t: "op", op, a, b: unary() });
    }
    return a;
  };
  const unary = (): FNode => {
    if (isOp(peek(), "-")) {
      pos++;
      return node({ t: "neg", a: unary() });
    }
    if (isOp(peek(), "+")) pos++;
    return atom();
  };
  const atom = (): FNode => {
    const t = tokens[pos++];
    if (!t) throw new Error("de formule stopt te vroeg");
    if (t.k === "num") return node({ t: "num", v: t.v });
    if (t.k === "field") return node({ t: "field", ref: t.name });
    if (t.k === "(") {
      const inner = expr();
      if (tokens[pos++]?.k !== ")") throw new Error("een haakje wordt niet gesloten");
      return inner;
    }
    if (t.k === "name") {
      if (!Object.hasOwn(FUNCTIONS, t.name)) throw new Error(`"${t.name}" ken ik niet; een veld zet je tussen [ en ]`);
      if (tokens[pos++]?.k !== "(") throw new Error(`na ${t.name} komt een haakje`);
      const args = [expr()];
      while (peek()?.k === ";") {
        pos++;
        args.push(expr());
      }
      if (tokens[pos++]?.k !== ")") throw new Error(`het haakje van ${t.name} wordt niet gesloten`);
      return node({ t: "fn", name: t.name as FnName, args });
    }
    throw new Error(t.k === ")" ? "er staat een haakje te veel" : "hier verwacht ik een getal, een [veld] of een haakje");
  };

  const root = expr();
  if (pos < tokens.length) throw new Error(tokens[pos].k === ")" ? "er staat een haakje te veel" : "na het einde van de som staat nog iets");
  return root;
}

/** Alle velden in een formule (zonder dubbels). */
export function formulaRefs(node: FNode): string[] {
  const out = new Set<string>();
  const walk = (n: FNode) => {
    if (n.t === "field") out.add(n.ref);
    else if (n.t === "neg") walk(n.a);
    else if (n.t === "op" || n.t === "cmp") (walk(n.a), walk(n.b));
    else if (n.t === "fn") n.args.forEach(walk);
  };
  walk(node);
  return [...out];
}

/** Elk veld een andere naam of sleutel geven (naam ↔ sleutel, een nieuwe sleutel bij bewaren). */
export function mapRefs(node: FNode, fn: (ref: string) => string): FNode {
  switch (node.t) {
    case "num":
      return node;
    case "field":
      return { t: "field", ref: fn(node.ref) };
    case "neg":
      return { t: "neg", a: mapRefs(node.a, fn) };
    case "op":
    case "cmp":
      return { ...node, a: mapRefs(node.a, fn), b: mapRefs(node.b, fn) };
    case "fn":
      return { ...node, args: node.args.map((a) => mapRefs(a, fn)) };
  }
}

const LEVEL = { cmp: 1, sum: 2, product: 3, neg: 4, atom: 5 };
const levelOf = (n: FNode) =>
  n.t === "cmp" ? LEVEL.cmp : n.t === "op" ? (n.op === "+" || n.op === "-" ? LEVEL.sum : LEVEL.product) : n.t === "neg" ? LEVEL.neg : LEVEL.atom;

const PRETTY_OPS: Record<string, string> = { "*": "×", "/": "÷", "-": "−", "<=": "≤", ">=": "≥", "!=": "≠" };

/**
 * Een formule als tekst. `ref`: hoe een veld er staat ("[kcal_100]" om te bewaren, "[kcal per 100 g]" of de naam
 * zonder haakjes om te tonen). `pretty`: met × ÷ − en een decimale komma.
 */
export function printFormula(node: FNode, ref: (ref: string) => string, pretty = false): string {
  const op = (o: string) => (pretty ? (PRETTY_OPS[o] ?? o) : o);
  const wrap = (child: FNode, min: number) => (levelOf(child) < min ? `(${print(child)})` : print(child));
  const print = (n: FNode): string => {
    switch (n.t) {
      case "num":
        return pretty ? String(n.v).replace(".", ",") : String(n.v);
      case "field":
        return ref(n.ref);
      case "neg":
        return `${op("-")}${wrap(n.a, LEVEL.neg)}`;
      case "op": {
        const level = levelOf(n);
        // Rechts van − en ÷ telt de volgorde: a − (b − c) blijft tussen haakjes.
        const right = n.op === "-" || n.op === "/" ? level + 1 : level;
        return `${wrap(n.a, level)} ${op(n.op)} ${wrap(n.b, right)}`;
      }
      case "cmp":
        return `${wrap(n.a, LEVEL.sum)} ${op(n.op)} ${wrap(n.b, LEVEL.sum)}`;
      case "fn":
        return `${n.name}(${n.args.map(print).join("; ")})`;
    }
  };
  return print(node);
}

// ---------- nakijken ----------

const unify = (kinds: FKind[]): FKind => {
  const real = kinds.filter((k) => k !== "const");
  if (!real.length) return "const";
  return real.includes("money") ? "money" : real.includes("duration") ? "duration" : "number";
};

/**
 * Wat een formule oplevert (een bedrag, een getal, ja/nee, ...), of "wait" als een veld nog geen uitkomst heeft (een
 * berekening die zelf nog wacht). `kindOf`: wat een veld is; gooit een fout als je het niet in een formule kan
 * gebruiken. Gooit een fout met uitleg als de formule niet klopt.
 */
export function inferFormula(node: FNode, kindOf: (ref: string) => FKind | "wait"): FKind | "wait" {
  let waiting = false;
  const notBool = (k: FKind) => {
    if (k === "bool") throw new Error("een vergelijking (ja/nee) kan je enkel in als(…) gebruiken, of als hele formule");
    return k;
  };
  const infer = (n: FNode): FKind => {
    switch (n.t) {
      case "num":
        return "const";
      case "field": {
        const k = kindOf(n.ref);
        if (k === "wait") {
          waiting = true;
          return "number";
        }
        return k;
      }
      case "neg":
        return notBool(infer(n.a));
      case "op": {
        const a = notBool(infer(n.a));
        const b = notBool(infer(n.b));
        if (n.op === "+" || n.op === "-") return unify([a, b]);
        if (a === "const" && b === "const") return "const";
        if (n.op === "*") {
          if (a === "money" || b === "money") return a === "money" && b === "money" ? "number" : "money";
          if (a === "duration" || b === "duration") return a === "duration" && b === "duration" ? "number" : "duration";
          return "number";
        }
        // Delen: bedrag ÷ getal = bedrag, bedrag ÷ bedrag = getal.
        if (a === "money" && b !== "money") return "money";
        if (a === "duration" && b !== "duration") return "duration";
        return "number";
      }
      case "cmp":
        notBool(infer(n.a));
        notBool(infer(n.b));
        return "bool";
      case "fn": {
        const spec = FUNCTIONS[n.name];
        if (n.args.length < spec.min || n.args.length > spec.max)
          throw new Error(
            n.name === "als"
              ? "als(…) heeft drie delen: als(voorwaarde; dan; anders)"
              : n.name === "afronden"
                ? "afronden(…) heeft een getal en eventueel het aantal decimalen"
                : n.name === "of"
                  ? "of(…) heeft minstens twee delen: of([Dit]; [anders dit])"
                  : `${n.name}(…) heeft minstens één getal`,
          );
        if (n.name === "als") {
          if (infer(n.args[0]) !== "bool") throw new Error("het eerste deel van als(…) is een vergelijking, zoals [Aantal] < 3");
          return unify([notBool(infer(n.args[1])), notBool(infer(n.args[2]))]);
        }
        if (n.name === "afronden") {
          const decimals = n.args[1];
          if (decimals && !(decimals.t === "num" && Number.isInteger(decimals.v) && decimals.v <= 6))
            throw new Error("afronden(…; decimalen): de decimalen zijn een geheel getal van 0 tot 6");
          return notBool(infer(n.args[0]));
        }
        return unify(n.args.map((a) => notBool(infer(a))));
      }
    }
  };
  const kind = infer(node);
  return waiting ? "wait" : kind;
}

// ---------- uitrekenen ----------

type Val = { v: number | boolean; k: FKind };

/**
 * Een formule uitrekenen. `value`: de waarde van een veld (een bedrag in cent, een duur in minuten, ja/nee);
 * `kindOf`: wat een veld is. Ontbreekt een veld, of deel je door nul, dan geen uitkomst.
 */
export function evalFormula(node: FNode, value: (ref: string) => number | boolean | undefined, kindOf: (ref: string) => FKind): number | boolean | undefined {
  const kinds = (n: FNode) => inferFormula(n, kindOf) as FKind;
  // Een los getal naast een bedrag is in euro (de waarden zijn in cent).
  const as = (x: Val, unit: FKind) => (x.k === "const" && unit === "money" ? (x.v as number) * 100 : (x.v as number));
  const run = (n: FNode): Val | undefined => {
    switch (n.t) {
      case "num":
        return { v: n.v, k: "const" };
      case "field": {
        const v = value(n.ref);
        return v === undefined ? undefined : { v, k: kindOf(n.ref) };
      }
      case "neg": {
        const a = run(n.a);
        return a && { v: -(a.v as number), k: a.k };
      }
      case "op": {
        const a = run(n.a);
        const b = run(n.b);
        if (!a || !b) return undefined;
        const k = kinds(n);
        if (n.op === "+" || n.op === "-") {
          const unit = unify([a.k, b.k]);
          const v = n.op === "+" ? as(a, unit) + as(b, unit) : as(a, unit) - as(b, unit);
          return { v, k };
        }
        const x = a.v as number;
        const y = b.v as number;
        if (n.op === "*") return { v: x * y, k };
        // Bedrag ÷ bedrag is een verhouding; bedrag ÷ getal blijft in cent.
        return y === 0 ? undefined : { v: x / y, k };
      }
      case "cmp": {
        const a = run(n.a);
        const b = run(n.b);
        if (!a || !b) return undefined;
        const unit = unify([a.k, b.k]);
        const x = as(a, unit);
        const y = as(b, unit);
        const v = { "<": x < y, "<=": x <= y, ">": x > y, ">=": x >= y, "=": x === y, "!=": x !== y }[n.op];
        return { v, k: "bool" };
      }
      case "fn": {
        if (n.name === "als") {
          const cond = run(n.args[0]);
          if (!cond) return undefined;
          const unit = unify([kinds(n.args[1]), kinds(n.args[2])]);
          const chosen = run(n.args[cond.v ? 1 : 2]);
          return chosen && { v: as(chosen, unit), k: unit };
        }
        if (n.name === "of") {
          // Het eerste dat ingevuld is; een leeg veld telt niet.
          const unit = unify(n.args.map(kinds));
          for (const arg of n.args) {
            const x = run(arg);
            if (x) return { v: as(x, unit), k: unit };
          }
          return undefined;
        }
        if (n.name === "afronden") {
          const x = run(n.args[0]);
          if (!x) return undefined;
          const decimals = n.args[1]?.t === "num" ? n.args[1].v : 0;
          const factor = 10 ** decimals;
          // Een bedrag rond je af in euro, niet in cent.
          const scale = x.k === "money" ? 100 : 1;
          return { v: (Math.round(((x.v as number) / scale) * factor) / factor) * scale, k: x.k };
        }
        const args = n.args.map(run);
        if (args.some((a) => !a)) return undefined;
        const unit = unify(args.map((a) => a!.k));
        const values = args.map((a) => as(a!, unit));
        return { v: n.name === "min" ? Math.min(...values) : Math.max(...values), k: unit };
      }
    }
  };
  const out = run(node);
  if (!out) return undefined;
  if (typeof out.v === "boolean") return out.v;
  return Number.isFinite(out.v) ? out.v : undefined;
}
