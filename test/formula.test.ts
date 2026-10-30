import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCalcs, computeLocal, describeCalc, fieldDeps, formulaFromLabels, formulaToLabels, renameCalc } from "../shared/calc.ts";
import type { FieldDef } from "../shared/fields.ts";
import { formulaRefs, parseFormula, printFormula } from "../shared/formula.ts";

const formula = (key: string, label: string, expr: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  type: "calc",
  calc: { kind: "formula", expr },
  ...extra,
});

const food: FieldDef[] = [
  { key: "kcal_100", label: "kcal per 100 g", type: "number", unit: "kcal" },
  { key: "gram", label: "Hoeveel", type: "number", unit: "g" },
  { key: "prijs", label: "Prijs", type: "money" },
  { key: "aantal", label: "Aantal", type: "number" },
  { key: "duur", label: "Duurt", type: "duration" },
  { key: "klaar", label: "Klaar", type: "bool" },
  { key: "naam", label: "Notitie", type: "text" },
  formula("kcal", "Kcal", "[kcal_100] * [gram] / 100", { unit: "kcal" }),
];

const result = (fields: FieldDef[], key: string) => checkCalcs(fields, [], "self").find((f) => f.key === key)!.result;
const compute = (fields: FieldDef[], data: Record<string, unknown>, key: string) =>
  computeLocal(checkCalcs(fields, [], "self"), data as never)[key];

test("formule lezen: volgorde, haakjes, komma's en namen", () => {
  const n = parseFormula("[a] + [b] × 2");
  assert.equal(printFormula(n, (r) => `[${r}]`), "[a] + [b] * 2");
  assert.equal(printFormula(parseFormula("([a] + [b]) × 2"), (r) => `[${r}]`), "([a] + [b]) * 2");
  assert.equal(printFormula(parseFormula("[a] − ([b] − [c])"), (r) => r), "a - (b - c)");
  assert.equal(printFormula(parseFormula("1,21 * [a]"), (r) => r, true), "1,21 × a");
  assert.equal(printFormula(parseFormula("AFRONDEN([a] ÷ 3; 1)"), (r) => r), "afronden(a / 3; 1)");
  assert.deepEqual(formulaRefs(parseFormula("als([a] ≤ [b]; [a]; [c] + [a])")), ["a", "b", "c"]);
});

test("formule lezen: fouten met uitleg, nooit code", () => {
  assert.throws(() => parseFormula(""), /typ een formule/);
  assert.throws(() => parseFormula("[a] +"), /stopt te vroeg/);
  assert.throws(() => parseFormula("([a] + 1"), /niet gesloten/);
  assert.throws(() => parseFormula("[a] + 1)"), /te veel/);
  assert.throws(() => parseFormula("[a"), /\[ wordt niet gesloten/);
  assert.throws(() => parseFormula("min(1, 2)"), /;/);
  assert.throws(() => parseFormula("alert(1)"), /ken ik niet/);
  assert.throws(() => parseFormula("[a] & 1"), /begrijp ik niet/);
  assert.throws(() => parseFormula("x".repeat(400)), /hoogstens/);
});

test("formule nakijken: de uitkomst volgt de velden", () => {
  assert.equal(result(food, "kcal"), "number");
  assert.equal(result([...food, formula("x", "X", "[prijs] * 1.21")], "x"), "money");
  assert.equal(result([...food, formula("x", "X", "[prijs] / [prijs]")], "x"), "number");
  assert.equal(result([...food, formula("x", "X", "[prijs] + 2")], "x"), "money");
  assert.equal(result([...food, formula("x", "X", "[duur] * 2")], "x"), "duration");
  assert.equal(result([...food, formula("x", "X", "[aantal] <= 2")], "x"), "bool");
  assert.equal(result([...food, formula("x", "X", "als([klaar]; 0; [aantal])")], "x"), "number");
  // Een formule op een formule.
  assert.equal(result([...food, formula("x", "X", "afronden([kcal] / 4)")], "x"), "number");
});

test("formule nakijken: fouten met de naam van het veld", () => {
  const bad = (expr: string) => () => checkCalcs([...food, formula("x", "X", expr)], [], "self");
  assert.throws(bad("[naam] * 2"), /X: "Notitie" is geen getal/);
  assert.throws(bad("[weg] * 2"), /X: een gekozen veld bestaat niet/);
  assert.throws(bad("[x] + 1"), /zichzelf/);
  assert.throws(bad("([aantal] < 2) + 1"), /X: een vergelijking/);
  assert.throws(bad("als([aantal]; 1; 2)"), /X: het eerste deel van als/);
  assert.throws(bad("als([klaar]; 1)"), /X: als\(…\) heeft drie delen/);
  assert.throws(bad("afronden([aantal]; [aantal])"), /decimalen/);
  assert.throws(bad("[aantal] +"), /X: de formule stopt te vroeg/);
  // Een kring.
  assert.throws(() => checkCalcs([...food, formula("x", "X", "[y] + 1"), formula("y", "Y", "[x] + 1")], [], "self"), /kring/);
});

test("formule uitrekenen", () => {
  assert.equal(compute(food, { kcal_100: 250, gram: 40 }, "kcal"), 100);
  assert.equal(compute(food, { kcal_100: 250 }, "kcal"), undefined);
  // Een getal bij een bedrag telt in euro; bij een vermenigvuldiging is het gewoon een getal.
  assert.equal(compute([...food, formula("x", "X", "[prijs] + 2")], { prijs: 1050 }, "x"), 1250);
  assert.equal(compute([...food, formula("x", "X", "[prijs] * 2")], { prijs: 1050 }, "x"), 2100);
  assert.equal(compute([...food, formula("x", "X", "([prijs] + 1) * [aantal]")], { prijs: 250, aantal: 3 }, "x"), 1050);
  assert.equal(compute([...food, formula("x", "X", "max([prijs]; 5)")], { prijs: 250 }, "x"), 500);
  // Afronden: een bedrag in euro.
  assert.equal(compute([...food, formula("x", "X", "afronden([prijs] / 3)")], { prijs: 1000 }, "x"), 300);
  assert.equal(compute([...food, formula("x", "X", "afronden([aantal] / 3; 2)")], { aantal: 10 }, "x"), 3.33);
  assert.equal(compute([...food, formula("x", "X", "als([klaar]; 0; [aantal])")], { aantal: 4, klaar: true }, "x"), 0);
  assert.equal(compute([...food, formula("x", "X", "als([aantal] > 3; [prijs]; 1)")], { aantal: 2, prijs: 700 }, "x"), 100);
  assert.equal(compute([...food, formula("x", "X", "[aantal] <= 2")], { aantal: 2 }, "x"), true);
  assert.equal(compute([...food, formula("x", "X", "[aantal] / 0")], { aantal: 2 }, "x"), undefined);
  assert.equal(compute([...food, formula("x", "X", "-[aantal] + 1")], { aantal: 2 }, "x"), -1);
});

test("formule: namen ↔ sleutels, hernoemen, afhankelijkheden, in woorden", () => {
  const stored = formulaFromLabels("[KCAL per 100 g] × [Hoeveel] ÷ 100", food);
  assert.equal(stored, "[kcal_100] * [gram] / 100");
  assert.equal(formulaToLabels(stored, food), "[kcal per 100 g] × [Hoeveel] ÷ 100");
  // Een onbekende naam blijft staan; de controle zegt welk veld niet bestaat.
  assert.equal(formulaFromLabels("[Onbekend] + 1", food), "[Onbekend] + 1");
  assert.throws(() => formulaFromLabels("[a] +", food), /stopt te vroeg/);

  const renamed = renameCalc({ kind: "formula", expr: stored }, (k) => (k === "gram" ? "hoeveel" : k), () => undefined, "self");
  assert.deepEqual(renamed, { kind: "formula", expr: "[kcal_100] * [hoeveel] / 100" });
  assert.deepEqual(fieldDeps(food, "kcal"), ["kcal", "kcal_100", "gram"]);
  assert.equal(describeCalc(food.find((f) => f.key === "kcal")!, food), "kcal per 100 g × Hoeveel ÷ 100");
});

test("formule: of(…) neemt het eerste dat ingevuld is", () => {
  const fields: FieldDef[] = [
    ...food,
    { key: "recept_kcal", label: "Recept kcal", type: "number" },
    formula("x", "X", "of([kcal_100]; [recept_kcal]) * [gram] / 100"),
  ];
  assert.equal(result(fields, "x"), "number");
  assert.equal(compute(fields, { kcal_100: 200, recept_kcal: 100, gram: 50 }, "x"), 100);
  assert.equal(compute(fields, { recept_kcal: 100, gram: 50 }, "x"), 50);
  assert.equal(compute(fields, { gram: 50 }, "x"), undefined);
  assert.throws(() => checkCalcs([...food, formula("x", "X", "of([gram])")], [], "self"), /minstens twee/);
  // Een getal naast een bedrag telt in euro, ook in of(…).
  assert.equal(compute([...food, formula("x", "X", "of([prijs]; 2)")], {}, "x"), 200);
});
