import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDef } from "../shared/fields.ts";
import { quickFill, readDate } from "../shared/quickfill.ts";

const eten: FieldDef[] = [
  { key: "datum", label: "Datum", type: "date", today: true },
  { key: "maaltijd", label: "Maaltijd", type: "select", options: ["Ontbijt", "Middag", "Avond", "Tussendoor"] },
  { key: "wat", label: "Wat", type: "item", ref_type: "V1", ref_also: ["V2"], free: true },
  { key: "hoeveel", label: "Hoeveel", type: "number", unit: "g" },
  { key: "wie", label: "Wie", type: "person" },
];
const ctx = {
  today: "2026-11-04",
  people: [
    { id: "p1", name: "Jaan Naets" },
    { id: "p2", name: "Jana" },
  ],
  items: (key: string) => (key === "wat" ? [{ id: "i1", name: "Komkommer" }, { id: "i2", name: "Griekse yoghurt" }] : []),
  skip: ["Eten"],
};

test("datums: kort, lang, woorden en weekdagen", () => {
  assert.deepEqual(readDate(["21-10"], "2026-11-04"), { date: "2026-10-21", n: 1 });
  assert.deepEqual(readDate(["21/10/25"], "2026-11-04"), { date: "2025-10-21", n: 1 });
  assert.deepEqual(readDate(["gisteren"], "2026-11-04"), { date: "2026-11-03", n: 1 });
  // 4 november 2026 is een woensdag: maandag is twee dagen eerder, woensdag is vandaag.
  assert.deepEqual(readDate(["maandag"], "2026-11-04"), { date: "2026-11-02", n: 1 });
  assert.deepEqual(readDate(["woensdag"], "2026-11-04"), { date: "2026-11-04", n: 1 });
  assert.deepEqual(readDate(["21", "okt"], "2026-11-04"), { date: "2026-10-21", n: 2 });
  assert.equal(readDate(["31-02"], "2026-11-04"), null);
  assert.equal(readDate(["komkommer"], "2026-11-04"), null);
});

test("21-10 eten komkommer: datum en het item, de naam van de lijst telt niet", () => {
  const r = quickFill("21-10 eten komkommer", eten, ctx);
  assert.deepEqual(r.data, { datum: "2026-10-21", wat: "i1" });
  assert.equal(r.name, "Komkommer");
  assert.equal(r.sentence, false);
});

test("wat niet in de lijst staat, wordt vrije tekst (en de naam)", () => {
  const r = quickFill("gisteren avond croissant 80g jana", eten, ctx);
  assert.deepEqual(r.data, { datum: "2026-11-03", maaltijd: "Avond", hoeveel: 80, wie: "p2", wat: { text: "croissant" } });
  assert.equal(r.name, "Croissant");
});

test("een naam van meer woorden, een getal met eenheid apart", () => {
  const r = quickFill("griekse yoghurt 150 g ontbijt", eten, ctx);
  assert.deepEqual(r.data, { wat: "i2", hoeveel: 150, maaltijd: "Ontbijt" });
  assert.equal(r.name, "Griekse yoghurt");
});

test("een hele zin gaat naar de AI; wat de code vond, blijft", () => {
  const r = quickFill("21-10 ik at een halve pizza met mama op restaurant", eten, ctx);
  assert.equal(r.data.datum, "2026-10-21");
  assert.equal(r.sentence, true);
  assert.equal(r.name, null);
  assert.equal(r.data.wat, undefined);
});

test("bedragen, uren en duur", () => {
  const uitgave: FieldDef[] = [
    { key: "bedrag", label: "Bedrag", type: "money" },
    { key: "uur", label: "Uur", type: "time" },
    { key: "duur", label: "Duur", type: "duration" },
    { key: "terug", label: "Terugbetaald", type: "bool" },
  ];
  assert.deepEqual(quickFill("€ 5,20 18u30 45 min terugbetaald colruyt", uitgave, ctx).data, { bedrag: 520, uur: "18:30", duur: 45, terug: true });
  assert.deepEqual(quickFill("12,5 euro", uitgave, ctx).data, { bedrag: 1250 });
  assert.equal(quickFill("12,5 euro colruyt", uitgave, ctx).name, "Colruyt");
});

test("een datum zonder datumveld komt niet in de naam", () => {
  const zonder = eten.filter((f) => f.type !== "date");
  const r = quickFill("21-10 eten komkommer", zonder, ctx);
  assert.deepEqual(r.data, { wat: "i1" });
  assert.equal(r.name, "Komkommer");
});
