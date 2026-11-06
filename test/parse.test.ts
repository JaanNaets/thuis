import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDef } from "../shared/fields.ts";
import { readDate, readEvent, readTime, type ParseThing } from "../shared/parse.ts";

const TODAY = "2026-11-06"; // een vrijdag
const pasta: ParseThing = { id: "p", name: "Pasta", unit: "g", role: "uit" };
const yoghurt: ParseThing = { id: "y", name: "Yoghurt", unit: "stuk", role: "in" };
const aardappelen: ParseThing = { id: "a", name: "Aardappelen", unit: "kg", role: "in" };
const melk: ParseThing = { id: "m", name: "Melk", unit: "l", role: "in" };
const melkHalfvol: ParseThing = { id: "mh", name: "Melk halfvol", unit: "l", role: "in" };
const colruyt: ParseThing = { id: "c", name: "Colruyt", role: "bij" };
const sprinter: ParseThing = { id: "s", name: "Mercedes Sprinter", role: "voor" };
const liter: FieldDef = { key: "liter", label: "Liter", type: "number" };
const km: FieldDef = { key: "km", label: "Km-stand", type: "number", unit: "km" };
const kcal: FieldDef = { key: "kcal", label: "Kcal", type: "number", unit: "kcal" };
const gewicht: FieldDef = { key: "waarde", label: "Gewicht", type: "number", unit: "kg" };

const ctx = (things: ParseThing[], fields: FieldDef[] = [], money = false) => ({ today: TODAY, money, fields, things });

test("datums en uren", () => {
  assert.equal(readDate(["gisteren"], TODAY)?.date, "2026-11-05");
  assert.equal(readDate(["maandag"], TODAY)?.date, "2026-11-02");
  assert.deepEqual(readDate(["21", "okt"], TODAY), { date: "2026-10-21", n: 2 });
  assert.equal(readDate(["31/02"], TODAY), null);
  assert.equal(readTime("18u"), "18:00");
  assert.equal(readTime("18u30"), "18:30");
  assert.equal(readTime("8:05"), "08:05");
  assert.equal(readTime("25:00"), null);
  assert.equal(readTime("18"), null);
});

test("gegeten: een ding met hoeveelheid na of voor de naam", () => {
  const a = readEvent("pasta 300 g", ctx([pasta]));
  assert.deepEqual(a.lines, [{ thing: pasta, amount: 300, unit: "g", price: null }]);
  assert.equal(a.name, "");
  const b = readEvent("2 yoghurt gisteren om 8u", ctx([yoghurt]));
  assert.deepEqual(b.lines, [{ thing: yoghurt, amount: 2, unit: null, price: null }]);
  assert.equal(b.day, "2026-11-05");
  assert.equal(b.time, "08:00");
  const c = readEvent("300g pasta", ctx([pasta]));
  assert.equal(c.lines[0].amount, 300);
  assert.equal(c.lines[0].unit, "g");
});

test("een kasticket in één zin: winkel, dingen, hoeveelheden en prijzen", () => {
  const r = readEvent("colruyt yoghurt 6 3,56 aardappelen 1 zak 4,99 € 46,31", ctx([colruyt, yoghurt, aardappelen], [], true));
  assert.deepEqual(
    r.lines.map((l) => [l.thing.id, l.amount, l.unit, l.price]),
    [
      ["c", null, null, null],
      ["y", 6, null, 356],
      ["a", 1, "zak", 499],
    ],
  );
  assert.equal(r.amount, 4631);
  assert.equal(r.name, "");
});

test("de langste naam wint", () => {
  const r = readEvent("melk halfvol 2 l", ctx([melk, melkHalfvol]));
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].thing.id, "mh");
  assert.equal(r.lines[0].unit, "l");
});

test("tankbeurt: bedrag, getallen met de naam of eenheid van een veld", () => {
  const r = readEvent("sprinter 84,50 52 liter 182400 km", ctx([sprinter], [liter, km], true));
  assert.equal(r.amount, 8450);
  assert.deepEqual(r.data, { liter: 52, km: 182400 });
  assert.deepEqual(r.lines, [{ thing: sprinter, amount: null, unit: null, price: null }]);
  assert.equal(r.name, "");
});

test("een bedrag zonder ding: een rond getal is euro bij een soort met geld", () => {
  const r = readEvent("carwash 12", ctx([], [], true));
  assert.equal(r.amount, 1200);
  assert.equal(r.name, "carwash");
  assert.equal(readEvent("carwash 12 euro", ctx([], [], true)).amount, 1200);
  assert.equal(readEvent("12 euro carwash", ctx([], [], false)).amount, 1200);
});

test("een meting of een eigen getal", () => {
  assert.deepEqual(readEvent("82,4", ctx([], [gewicht])).data, { waarde: 82.4 });
  assert.deepEqual(readEvent("gewicht 82,4 kg", ctx([], [gewicht])).data, { waarde: 82.4 });
  const r = readEvent("broodje kaas 450 kcal", ctx([], [kcal]));
  assert.deepEqual(r.data, { kcal: 450 });
  assert.equal(r.name, "broodje kaas");
});

test("wat overblijft is de omschrijving; losse woordjes niet", () => {
  assert.equal(readEvent("bij colruyt", ctx([colruyt], [], true)).name, "");
  assert.equal(readEvent("verjaardag van oma", ctx([])).name, "verjaardag van oma");
});

test("een woord uit de naam volstaat, de hele naam gaat voor", () => {
  const rioja: ParseThing = { id: "r", name: "Rioja Reserva 2019", role: "in" };
  assert.equal(readEvent("rioja 2", ctx([rioja])).lines[0]?.amount, 2);
  assert.equal(readEvent("2019 fles", ctx([rioja])).lines.length, 0);
  const r = readEvent("melk halfvol", ctx([melkHalfvol, { id: "x", name: "Halfvol yoghurt", role: "in" }]));
  assert.deepEqual(r.lines.map((l) => l.thing.id), ["mh"]);
});
