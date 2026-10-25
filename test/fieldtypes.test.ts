import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanFields,
  cleanValue,
  FIELD_GROUPS,
  FIELD_TYPES,
  formatDuration,
  formatFieldValue,
  formatInterval,
  parseDuration,
  parseFieldText,
  parseInterval,
  rangeStatus,
  referencedItems,
  referencedPeople,
  type FieldDef,
  type FieldType,
} from "../shared/fields.ts";

const def = (type: FieldType, extra: Partial<FieldDef> = {}): FieldDef => ({ key: "v", label: "Veld", type, ...extra });

test("elke veldsoort heeft een groep en uitleg", () => {
  for (const [type, t] of Object.entries(FIELD_TYPES)) {
    assert.ok(Object.hasOwn(FIELD_GROUPS, t.group), type);
    assert.ok(t.hint.length > 10, type);
  }
});

test("webadres, e-mail, telefoon, adres", () => {
  assert.equal(cleanValue(def("url"), "https://colruyt.be/nl"), "https://colruyt.be/nl");
  assert.equal(cleanValue(def("url"), "colruyt.be"), "https://colruyt.be");
  assert.equal(cleanValue(def("url"), "javascript:alert(1)"), null);
  assert.equal(cleanValue(def("url"), "geen link"), null);
  assert.equal(formatFieldValue(def("url"), "https://www.colruyt.be/"), "colruyt.be");
  assert.equal(cleanValue(def("email"), " jana@example.be "), "jana@example.be");
  assert.equal(cleanValue(def("email"), "jana@"), null);
  assert.equal(cleanValue(def("phone"), "+32 470 12 34 56"), "+32 470 12 34 56");
  assert.equal(cleanValue(def("phone"), "03/123.45.67"), "03/123.45.67");
  assert.equal(cleanValue(def("phone"), "bel me"), null);
  assert.equal(cleanValue(def("phone"), "123"), null);
  assert.equal(cleanValue(def("address"), " Kerkstraat 1, 2000 Antwerpen "), "Kerkstraat 1, 2000 Antwerpen");
});

test("uur en duur", () => {
  assert.equal(cleanValue(def("time"), "9:05"), "09:05");
  assert.equal(cleanValue(def("time"), "24:00"), null);
  assert.equal(parseFieldText(def("time"), "18u30"), "18:30");
  assert.equal(parseFieldText(def("time"), "18u"), "18:00");
  assert.equal(parseFieldText(def("time"), "7.45"), "07:45");
  assert.equal(parseDuration("1:30"), 90);
  assert.equal(parseDuration("1u30"), 90);
  assert.equal(parseDuration("1 u 30 min"), 90);
  assert.equal(parseDuration("1,5 uur"), 90);
  assert.equal(parseDuration("45 min"), 45);
  assert.equal(parseDuration("2 dagen"), 2880);
  assert.equal(parseDuration("90"), 90);
  assert.ok(Number.isNaN(parseDuration("lang")));
  assert.equal(formatDuration(90), "1 u 30 min");
  assert.equal(formatDuration(45), "45 min");
  assert.equal(formatDuration(120), "2 u");
  assert.equal(formatDuration(3000), "2 d 2 u");
  assert.equal(formatFieldValue(def("duration"), 75), "1 u 15 min");
  assert.equal(cleanValue(def("duration"), -5), null);
});

test("periode (datums)", () => {
  assert.deepEqual(cleanValue(def("date_range"), ["2026-03-20", "2026-03-12"]), ["2026-03-12", "2026-03-20"]);
  assert.deepEqual(cleanValue(def("date_range"), [null, "2026-03-20"]), [null, "2026-03-20"]);
  assert.equal(cleanValue(def("date_range"), [null, null]), null);
  assert.deepEqual(parseFieldText(def("date_range"), "12/03/2026 - 20/03/2026"), ["2026-03-12", "2026-03-20"]);
  assert.deepEqual(parseFieldText(def("date_range"), "12/03/2026 tot 20/03/2026"), ["2026-03-12", "2026-03-20"]);
  assert.deepEqual(parseFieldText(def("date_range"), "vanaf 12/03/2026"), ["2026-03-12", null]);
  assert.deepEqual(parseFieldText(def("date_range"), "tot 20/03/2026"), [null, "2026-03-20"]);
  assert.equal(formatFieldValue(def("date_range"), ["2026-03-12", "2026-03-20"]), "12/03/2026 – 20/03/2026");
  assert.equal(rangeStatus(["2026-03-12", "2026-03-20"], 2026, "2026-03-15"), "now");
  assert.equal(rangeStatus(["2026-03-12", "2026-03-20"], 2026, "2026-03-21"), "past");
  assert.equal(rangeStatus(["2026-03-12", null], 2026, "2026-03-01"), "later");
  // Jaren blijven werken zoals voorheen.
  assert.equal(rangeStatus([2024, 2030], 2026), "now");
});

test("herhaling", () => {
  assert.deepEqual(cleanValue(def("interval"), { n: 3, unit: "month" }), { n: 3, unit: "month" });
  assert.equal(cleanValue(def("interval"), { n: 0, unit: "month" }), null);
  assert.equal(cleanValue(def("interval"), { n: 2, unit: "eeuw" }), null);
  assert.deepEqual(parseInterval("elke 3 maanden"), { n: 3, unit: "month" });
  assert.deepEqual(parseInterval("maandelijks"), { n: 1, unit: "month" });
  assert.deepEqual(parseInterval("om de 2 weken"), { n: 2, unit: "week" });
  assert.deepEqual(parseInterval("elk jaar"), { n: 1, unit: "year" });
  assert.equal(parseInterval("soms"), null);
  assert.equal(formatInterval({ n: 1, unit: "year" }), "elk jaar");
  assert.equal(formatInterval({ n: 1, unit: "week" }), "elke week");
  assert.equal(formatInterval({ n: 6, unit: "month" }), "elke 6 maanden");
});

test("personen, verwijzingen en takenlijst", () => {
  assert.deepEqual(cleanValue(def("people"), ["a", "b", "a", "x y"]), ["a", "b"]);
  assert.equal(cleanValue(def("people"), []), null);
  assert.deepEqual(cleanValue(def("items", { ref_type: "t" }), ["i1", "i2"]), ["i1", "i2"]);
  const defs = [def("people"), { ...def("items", { ref_type: "t" }), key: "w" }];
  assert.deepEqual(referencedPeople(defs, { v: ["a", "b"] }), ["a", "b"]);
  assert.deepEqual(referencedItems(defs, { w: ["i1", "i2"] }), [
    { id: "i1", ref_type: "t", key: "w" },
    { id: "i2", ref_type: "t", key: "w" },
  ]);
  const names = { person: (id: string) => id.toUpperCase(), item: (id: string) => `#${id}` };
  assert.equal(formatFieldValue(def("people"), ["a", "b"], names), "A, B");
  assert.equal(formatFieldValue(def("items"), ["i1"], names), "#i1");
  assert.deepEqual(cleanValue(def("checklist"), [{ text: " Paspoort ", done: true }, { text: "" }, { text: "Lader" }]), [
    { text: "Paspoort", done: true },
    { text: "Lader", done: false },
  ]);
  assert.deepEqual(parseFieldText(def("checklist"), "[x] Paspoort\nLader; Zonnecrème"), [
    { text: "Paspoort", done: true },
    { text: "Lader", done: false },
    { text: "Zonnecrème", done: false },
  ]);
  assert.equal(
    formatFieldValue(def("checklist"), [
      { text: "a", done: true },
      { text: "b", done: false },
    ]),
    "1 van 2 klaar",
  );
});

test("velden met verwijzingen of een berekening", () => {
  assert.throws(() => cleanFields([{ key: "w", label: "Wijnen", type: "items" }]), /verwijst/);
  assert.deepEqual(cleanFields([{ key: "w", label: "Wijnen", type: "items", ref_type: "t1" }])[0].ref_type, "t1");
  assert.throws(() => cleanFields([{ key: "c", label: "Totaal", type: "calc" }]), /uitrekent/);
  const [calc] = cleanFields([{ key: "c", label: "Totaal", type: "calc", unit: "fl", calc: { kind: "days_until", field: "d" } }]);
  assert.equal(calc.unit, "fl");
  assert.deepEqual(calc.calc, { kind: "days_until", field: "d" });
  // Een berekening wordt nooit bewaard.
  assert.equal(cleanValue(calc, 12), null);
});
