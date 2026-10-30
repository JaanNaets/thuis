import assert from "node:assert/strict";
import { test } from "node:test";
import { canAgenda, monthGrid, occurrences, shiftMonth } from "../shared/agenda.ts";
import { cleanFields, type FieldDef } from "../shared/fields.ts";

const date: FieldDef = { key: "d", label: "Datum", type: "date" };
const birthday: FieldDef = { key: "v", label: "Verjaardag", type: "date", yearly: true, remind: 1 };
const trip: FieldDef = { key: "p", label: "Periode", type: "date_range" };

test("agenda: een datum, elk jaar, of een stuk van een periode", () => {
  assert.deepEqual(occurrences(date, "2026-11-03", "2026-10-26", "2026-12-06"), [{ start: "2026-11-03" }]);
  assert.deepEqual(occurrences(date, "2026-12-07", "2026-10-26", "2026-12-06"), []);
  assert.deepEqual(occurrences(birthday, "1990-11-03", "2026-10-26", "2026-12-06"), [{ start: "2026-11-03" }]);
  assert.deepEqual(occurrences(birthday, "1990-01-02", "2026-12-28", "2027-02-07"), [{ start: "2027-01-02" }]);
  assert.deepEqual(occurrences(birthday, "1990-05-02", "2026-10-26", "2026-12-06"), []);
  assert.deepEqual(occurrences(trip, ["2026-10-20", "2026-10-28"], "2026-10-26", "2026-12-06"), [{ start: "2026-10-26", end: "2026-10-28" }]);
  assert.deepEqual(occurrences(trip, ["2026-11-10", null], "2026-10-26", "2026-12-06"), [{ start: "2026-11-10" }]);
  assert.deepEqual(occurrences(trip, ["2026-12-30", "2027-01-05"], "2026-10-26", "2026-12-06"), []);
});

test("agenda: de maandkalender loopt van maandag tot zondag", () => {
  const days = monthGrid("2026-10");
  assert.equal(days[0], "2026-09-28");
  assert.equal(days.at(-1), "2026-11-01");
  assert.equal(days.length, 35);
  assert.equal(monthGrid("2026-02").length, 35);
  assert.equal(monthGrid("2027-02")[0], "2027-02-01");
  assert.equal(monthGrid("2027-02").length, 28);
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
});

test("agenda: enkel bij een datum, een periode of een berekende datum", () => {
  assert.ok(canAgenda(date));
  assert.ok(canAgenda(trip));
  assert.ok(canAgenda({ type: "calc", result: "date" }));
  assert.ok(!canAgenda({ type: "calc", result: "number" }));
  const clean = cleanFields([
    { key: "a", label: "A", type: "date", agenda: true },
    { key: "b", label: "B", type: "date_range", agenda: true },
    { key: "c", label: "C", type: "text", agenda: true },
    { key: "d", label: "D", type: "calc", agenda: true, calc: { kind: "days_until", field: "a" } },
  ]);
  assert.deepEqual(
    clean.map((f) => [f.key, f.agenda]),
    [
      ["a", true],
      ["b", true],
      ["c", undefined],
      ["d", true],
    ],
  );
});
