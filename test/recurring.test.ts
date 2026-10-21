import assert from "node:assert/strict";
import { test } from "node:test";
import { dueDates, nextOccurrence, occurrence } from "../shared/recurring.ts";

test("maandelijks: de dag blijft, ook na een korte maand", () => {
  assert.equal(occurrence("2026-01-31", "monthly", 1), "2026-02-28");
  assert.equal(occurrence("2026-01-31", "monthly", 2), "2026-03-31");
  assert.equal(occurrence("2024-01-31", "monthly", 1), "2024-02-29");
  assert.equal(occurrence("2026-11-15", "monthly", 3), "2027-02-15");
});

test("week, kwartaal en jaar", () => {
  assert.equal(occurrence("2026-12-28", "weekly", 1), "2027-01-04");
  assert.equal(occurrence("2026-01-15", "quarterly", 4), "2027-01-15");
  assert.equal(occurrence("2024-02-29", "yearly", 1), "2025-02-28");
  assert.equal(occurrence("2024-02-29", "yearly", 4), "2028-02-29");
});

test("volgende keer na een datum", () => {
  assert.equal(nextOccurrence("2026-01-31", "monthly", "2026-02-28"), "2026-03-31");
  assert.equal(nextOccurrence("2026-01-31", "monthly", "2026-01-30"), "2026-01-31");
  assert.equal(nextOccurrence("2020-01-05", "monthly", "2026-10-20"), "2026-11-05");
  assert.equal(nextOccurrence("2026-10-01", "weekly", "2026-10-21"), "2026-10-22");
});

test("wat nu ingeboekt moet worden", () => {
  assert.deepEqual(dueDates("2026-08-01", "monthly", "2026-08-01", "2026-10-20", null), ["2026-08-01", "2026-09-01", "2026-10-01"]);
  assert.deepEqual(dueDates("2026-08-01", "monthly", "2026-08-01", "2026-10-20", "2026-09-15"), ["2026-08-01", "2026-09-01"]);
  assert.deepEqual(dueDates("2026-11-01", "monthly", "2026-11-01", "2026-10-20", null), []);
  assert.equal(dueDates("2000-01-01", "weekly", "2000-01-01", "2026-10-20", null).length, 60);
});
