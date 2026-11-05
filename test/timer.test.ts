import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTimers, cleanAttributes, cleanFields, formatFieldValue, timerMinutes, type FieldDef } from "../shared/fields.ts";
import { computeChart } from "../shared/charts.ts";

const fields: FieldDef[] = cleanFields([
  { key: "vasten", label: "Vasten", type: "timer", timer_goal: 960, timer_into: "duur" },
  { key: "duur", label: "Duur", type: "duration" },
]);

test("timer: nagekeken (UTC-tijdstippen, einde na begin) en de duur in Duur in", () => {
  assert.deepEqual(fields[0], { key: "vasten", label: "Vasten", type: "timer", timer_goal: 960, timer_into: "duur" });
  assert.deepEqual(cleanAttributes(fields, { vasten: { start: "2026-11-04T19:00:00Z", end: "2026-11-05T11:30:00Z" } }).vasten, {
    start: "2026-11-04T19:00:00Z",
    end: "2026-11-05T11:30:00Z",
  });
  assert.deepEqual(cleanAttributes(fields, { vasten: { start: "2026-11-05T11:00:00Z", end: "2026-11-05T10:00:00Z" } }).vasten, { start: "2026-11-05T11:00:00Z" }, "een einde voor het begin valt weg");
  assert.equal(cleanAttributes(fields, { vasten: { start: "gisteren" } }).vasten, undefined);
  const data = applyTimers(fields, { vasten: { start: "2026-11-04T19:00:00Z", end: "2026-11-05T11:30:00Z" } });
  assert.equal(data.duur, 990);
  assert.equal(formatFieldValue(fields[0], data.vasten), "16 u 30 min");
  // Loopt nog: geen duur, wel hoe lang al.
  assert.equal(applyTimers(fields, { vasten: { start: "2026-11-05T10:00:00Z" } }).duur, undefined);
  assert.equal(timerMinutes({ start: "2026-11-05T10:00:00Z" }, Date.parse("2026-11-05T11:15:00Z")), 75);
  // Mag je Duur niet wijzigen, dan blijft het.
  assert.equal(applyTimers(fields, { vasten: { start: "2026-11-04T19:00:00Z", end: "2026-11-05T11:30:00Z" } }, () => false).duur, undefined);
  // Duur in naar iets dat geen Duur is, valt weg.
  assert.equal(cleanFields([{ key: "t", label: "T", type: "timer", timer_into: "n" }, { key: "n", label: "N", type: "number" }])[0].timer_into, undefined);
});

test("timer in een grafiek: per dag waarop hij startte (in België)", () => {
  const items = [
    { name: "a", data: { vasten: { start: "2026-11-04T23:30:00Z", end: "2026-11-05T15:00:00Z" }, duur: 930 }, tag_ids: [], created_at: "2026-11-04 23:30:00" },
    { name: "b", data: { vasten: { start: "2026-11-03T18:00:00Z", end: "2026-11-04T10:00:00Z" }, duur: 960 }, tag_ids: [], created_at: "2026-11-03 18:00:00" },
  ];
  const data = computeChart({ form: "bars", agg: "sum", field: "duur", date: "vasten", step: "day", count: 3 }, fields, items, { people: [], item: () => undefined, tags: [] }, "2026-11-05")!;
  // 23:30 UTC op 4/11 is 00:30 op 5/11 in België.
  assert.deepEqual(data.series[0].values, [960, 0, 930]);
});
