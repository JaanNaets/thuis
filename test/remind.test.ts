import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLocal } from "../shared/calc.ts";
import { cleanFields, type FieldDef } from "../shared/fields.ts";
import { everyText, nextDate, remindersDue, repeatsDue, whenText } from "../shared/remind.ts";

const upkeep: FieldDef[] = [
  { key: "elke", label: "Om de", type: "interval" },
  { key: "laatst", label: "Laatst gedaan", type: "date" },
  { key: "volgende", label: "Volgende keer", type: "calc", result: "date", remind: 7, calc: { kind: "date_add", field: "laatst", add: { field: "elke" } } },
  { key: "verjaardag", label: "Verjaardag", type: "date", remind: 1, yearly: true },
  { key: "tegen", label: "Tegen", type: "date", remind: 0 },
];

test("herinneren: zoveel dagen vooraf, ook een berekende datum", () => {
  const data = computeLocal(upkeep, { elke: { n: 1, unit: "year" }, laatst: "2025-11-06" }, "2026-10-30");
  assert.equal(data.volgende, "2026-11-06");
  assert.deepEqual(remindersDue(upkeep, data, "2026-10-30"), [{ key: "volgende", label: "Volgende keer", date: "2026-11-06", days: 7 }]);
  assert.deepEqual(remindersDue(upkeep, data, "2026-10-31"), []);
  assert.deepEqual(remindersDue(upkeep, { tegen: "2026-10-30" }, "2026-10-30"), [{ key: "tegen", label: "Tegen", date: "2026-10-30", days: 0 }]);
  assert.deepEqual(remindersDue(upkeep, { tegen: "geen datum" }, "2026-10-30"), []);
});

test("herinneren: elk jaar (een verjaardag), ook 29 februari", () => {
  assert.equal(nextDate("1990-10-31", true, "2026-10-30"), "2026-10-31");
  assert.equal(nextDate("1990-03-01", true, "2026-10-30"), "2027-03-01");
  assert.equal(nextDate("2000-02-29", true, "2026-10-30"), "2027-02-28");
  assert.equal(nextDate("2000-02-29", true, "2027-10-30"), "2028-02-29");
  assert.equal(nextDate("1990-03-01", false, "2026-10-30"), "1990-03-01");
  assert.deepEqual(remindersDue(upkeep, { verjaardag: "1990-10-31" }, "2026-10-30"), [{ key: "verjaardag", label: "Verjaardag", date: "2026-10-31", days: 1 }]);
  // Over de jaarwissel.
  assert.deepEqual(remindersDue(upkeep, { verjaardag: "1985-01-01" }, "2026-12-31")[0].date, "2027-01-01");
  assert.equal(whenText(0, "2026-10-30"), "vandaag");
  assert.equal(whenText(1, "2026-10-31"), "morgen (31/10)");
  assert.equal(whenText(7, "2026-11-06"), "over 7 dagen (6/11)");
});

test("herinneren: enkel bij een datum, en elk jaar enkel bij een gewone datum", () => {
  const clean = cleanFields([
    { key: "a", label: "A", type: "date", remind: 3, yearly: true },
    { key: "b", label: "B", type: "text", remind: 3 },
    { key: "c", label: "C", type: "date", remind: -1 },
    { key: "d", label: "D", type: "date", remind: 2.5 },
    { key: "e", label: "E", type: "calc", remind: 7, yearly: true, calc: { kind: "days_until", field: "a" } },
    { key: "f", label: "F", type: "date", yearly: true },
  ]);
  assert.deepEqual(
    clean.map((f) => [f.key, f.remind, f.yearly]),
    [
      ["a", 3, true],
      ["b", undefined, undefined],
      ["c", undefined, undefined],
      ["d", undefined, undefined],
      ["e", 7, undefined],
      ["f", undefined, undefined],
    ],
  );
});

test("herhalen: de volgende keer, en inhalen als de app niet liep", () => {
  assert.deepEqual(repeatsDue("2026-10-30", { n: 1, unit: "month" }, "2026-10-30"), { dates: ["2026-10-30"], next: "2026-11-30" });
  assert.deepEqual(repeatsDue("2026-11-01", { n: 1, unit: "month" }, "2026-10-30"), { dates: [], next: "2026-11-01" });
  // Drie maanden gemist: drie keer, en 31 januari blijft het einde van de maand.
  assert.deepEqual(repeatsDue("2026-01-31", { n: 1, unit: "month" }, "2026-04-15"), {
    dates: ["2026-01-31", "2026-02-28", "2026-03-31"],
    next: "2026-04-30",
  });
  assert.deepEqual(repeatsDue("2026-10-16", { n: 2, unit: "week" }, "2026-10-30"), { dates: ["2026-10-16", "2026-10-30"], next: "2026-11-13" });
  // Lang niet gelopen: hooguit een maand dagelijks inhalen, daarna gewoon verder.
  const long = repeatsDue("2025-01-01", { n: 1, unit: "day" }, "2026-10-30");
  assert.equal(long.dates.length, 31);
  assert.equal(long.next, "2026-10-31");
  assert.equal(everyText({ n: 1, unit: "month" }), "elke maand");
  assert.equal(everyText({ n: 2, unit: "week" }), "om de 2 weken");
  assert.equal(everyText({ n: 1, unit: "year" }), "elk jaar");
});
