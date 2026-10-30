import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDef } from "../shared/fields.ts";
import { cleanView, conditionText, matchesView, periodRange, sortItems, viewFields, weekday, weekOfMonth, type ViewDef } from "../shared/views.ts";

const names = { person: (id: string) => ({ a: "Jaan", b: "Ana" })[id] ?? "?", item: (id: string) => ({ c: "Colruyt", d: "Aldi" })[id] ?? "?" };
const ctx = { today: "2026-10-30", me: "a", names };
const base: FieldDef[] = [
  { key: "bedrag", label: "Bedrag", type: "money" },
  { key: "datum", label: "Datum", type: "date" },
  { key: "door", label: "Betaald door", type: "person" },
  { key: "voor", label: "Verdeling", type: "share" },
  { key: "cat", label: "Categorie", type: "select", options: ["Boodschappen", "Wonen", "Vrije tijd"] },
  { key: "winkel", label: "Winkel", type: "item" },
  { key: "klaar", label: "Klaar", type: "bool" },
  { key: "dubbel", label: "Dubbel", type: "calc", result: "money", calc: { kind: "math", op: "*", a: { field: "bedrag" }, b: { n: 2 } } },
];
const fields = viewFields(base, "Omschrijving");
const items = [
  { name: "Huur", data: { bedrag: 95000, datum: "2026-10-01", door: "a", cat: "Wonen", dubbel: 190000 }, tag_ids: ["t1"], created_at: "2026-10-01 08:00:00" },
  { name: "Brood", data: { bedrag: 310, datum: "2026-10-28", door: "b", cat: "Boodschappen", winkel: "c", voor: [{ person_id: "a", share: 50 }, { person_id: "b", share: 50 }] }, tag_ids: [], created_at: "2026-10-28 09:00:00" },
  { name: "Cinema", data: { bedrag: 2400, datum: "2026-09-20", door: "a", cat: "Vrije tijd", klaar: true }, tag_ids: ["t2"], created_at: "2026-09-20 20:00:00" },
  { name: "Melk", data: { bedrag: 120, door: "b", winkel: "d" }, tag_ids: [], created_at: "2026-10-30 07:00:00" },
];
const pick = (view: Partial<ViewDef>) => items.filter((i) => matchesView(i, { match: "all", conditions: [], ...view }, fields, ctx)).map((i) => i.name);

test("periodes: vanaf vrijdag 30 oktober 2026", () => {
  assert.deepEqual(periodRange({ p: "today" }, "2026-10-30"), ["2026-10-30", "2026-10-30"]);
  assert.deepEqual(periodRange({ p: "this_week" }, "2026-10-30"), ["2026-10-26", "2026-11-01"]);
  assert.deepEqual(periodRange({ p: "last_week" }, "2026-10-30"), ["2026-10-19", "2026-10-25"]);
  assert.deepEqual(periodRange({ p: "this_week" }, "2026-11-01"), ["2026-10-26", "2026-11-01"]);
  assert.deepEqual(periodRange({ p: "last_month" }, "2026-10-30"), ["2026-09-01", "2026-09-30"]);
  assert.deepEqual(periodRange({ p: "next_month" }, "2026-12-15"), ["2027-01-01", "2027-01-31"]);
  assert.deepEqual(periodRange({ p: "last_month" }, "2026-03-31"), ["2026-02-01", "2026-02-28"]);
  assert.deepEqual(periodRange({ p: "last_days", n: 7 }, "2026-10-30"), ["2026-10-24", "2026-10-30"]);
  assert.deepEqual(periodRange({ p: "before_today" }, "2026-10-30"), [null, "2026-10-29"]);
  assert.deepEqual(periodRange({ p: "range", from: "2026-01-01" }, "2026-10-30"), ["2026-01-01", null]);
  assert.equal(weekOfMonth("2026-10-07"), 1);
  assert.equal(weekOfMonth("2026-10-08"), 2);
  assert.equal(weekOfMonth("2026-10-31"), 5);
  assert.equal(weekday("2026-10-30"), 5);
  assert.equal(weekday("2026-11-01"), 7);
});

test("filteren: datums relatief en als patroon", () => {
  assert.deepEqual(pick({ conditions: [{ field: "datum", op: "in", value: { p: "this_week" } }] }), ["Brood"]);
  assert.deepEqual(pick({ conditions: [{ field: "datum", op: "in", value: { p: "last_month" } }] }), ["Cinema"]);
  assert.deepEqual(pick({ conditions: [{ field: "datum", op: "in", value: { p: "this_month" } }] }), ["Huur", "Brood"]);
  assert.deepEqual(pick({ conditions: [{ field: "datum", op: "week_of_month", value: 1 }] }), ["Huur"]);
  assert.deepEqual(pick({ conditions: [{ field: "datum", op: "weekday", value: [3] }] }), ["Brood"]);
  assert.deepEqual(pick({ conditions: [{ field: "datum", op: "empty" }] }), ["Melk"]);
  assert.deepEqual(pick({ conditions: [{ field: "_created", op: "in", value: { p: "today" } }] }), ["Melk"]);
});

test("filteren: getallen, keuzes, personen (ook jij), verwijzingen, tags, tekst", () => {
  assert.deepEqual(pick({ conditions: [{ field: "bedrag", op: "gt", value: 2000 }] }), ["Huur", "Cinema"]);
  assert.deepEqual(pick({ conditions: [{ field: "bedrag", op: "between", value: [100, 400] }] }), ["Brood", "Melk"]);
  assert.deepEqual(pick({ conditions: [{ field: "dubbel", op: "ge", value: 100000 }] }), ["Huur"]);
  assert.deepEqual(pick({ conditions: [{ field: "cat", op: "any_of", value: ["Wonen", "Vrije tijd"] }] }), ["Huur", "Cinema"]);
  assert.deepEqual(pick({ conditions: [{ field: "door", op: "any_of", value: ["me"] }] }), ["Huur", "Cinema"]);
  assert.deepEqual(pick({ conditions: [{ field: "voor", op: "any_of", value: ["me"] }] }), ["Brood"]);
  assert.deepEqual(pick({ conditions: [{ field: "winkel", op: "none_of", value: ["c"] }] }), ["Huur", "Cinema", "Melk"]);
  assert.deepEqual(pick({ conditions: [{ field: "_tags", op: "any_of", value: ["t1", "t2"] }] }), ["Huur", "Cinema"]);
  assert.deepEqual(pick({ conditions: [{ field: "_name", op: "contains", value: "IN" }] }), ["Cinema"]);
  assert.deepEqual(pick({ conditions: [{ field: "klaar", op: "is_false" }] }), ["Huur", "Brood", "Melk"]);
  // Eén van de voorwaarden.
  assert.deepEqual(
    pick({
      match: "any",
      conditions: [
        { field: "cat", op: "any_of", value: ["Wonen"] },
        { field: "door", op: "any_of", value: ["b"] },
      ],
    }),
    ["Huur", "Brood", "Melk"],
  );
  // Een veld dat de lezer niet ziet, telt niet mee.
  assert.equal(matchesView(items[1], { match: "all", conditions: [{ field: "bedrag", op: "gt", value: 99999 }] }, fields.filter((f) => f.key !== "bedrag"), ctx), true);
});

test("sorteren: op getal, op keuze (in de volgorde van de keuzes), leeg achteraan", () => {
  const by = (sort: ViewDef["sort"]) => sortItems(items, sort, fields, names).map((i) => i.name);
  assert.deepEqual(by([{ field: "bedrag", dir: "desc" }]), ["Huur", "Cinema", "Brood", "Melk"]);
  assert.deepEqual(by([{ field: "datum", dir: "asc" }]), ["Cinema", "Huur", "Brood", "Melk"]);
  assert.deepEqual(by([{ field: "datum", dir: "desc" }]), ["Brood", "Huur", "Cinema", "Melk"]);
  assert.deepEqual(by([{ field: "cat", dir: "asc" }]), ["Brood", "Huur", "Cinema", "Melk"]);
  assert.deepEqual(by([{ field: "winkel", dir: "asc" }]), ["Melk", "Brood", "Huur", "Cinema"]);
  assert.deepEqual(by(undefined), ["Huur", "Brood", "Cinema", "Melk"]);
});

test("weergave nakijken: enkel bestaande velden en passende vergelijkingen", () => {
  const view = cleanView(
    {
      match: "any",
      conditions: [{ field: "datum", op: "in", value: { p: "last_days", n: 30, extra: 1 } }, { field: "door", op: "any_of", value: ["me", "me"] }],
      sort: [{ field: "datum", dir: "desc" }, { field: "bestaat-niet", dir: "asc" }],
      columns: ["bedrag", "_name", "datum"],
      mode: "agenda",
      date: "datum",
      hack: true,
    },
    fields,
  );
  assert.deepEqual(view, {
    match: "any",
    conditions: [
      { field: "datum", op: "in", value: { p: "last_days", n: 30 } },
      { field: "door", op: "any_of", value: ["me"] },
    ],
    sort: [{ field: "datum", dir: "desc" }],
    columns: ["bedrag", "datum"],
    mode: "agenda",
    date: "datum",
  });
  assert.throws(() => cleanView({ conditions: [{ field: "bedrag", op: "contains", value: "x" }] }, fields), /vergelijking/);
  assert.throws(() => cleanView({ conditions: [{ field: "x", op: "empty" }] }, fields), /niet \(meer\) bestaat/);
  assert.throws(() => cleanView({ conditions: [{ field: "datum", op: "in", value: { p: "ooit" } }] }, fields), /periode/);
  assert.throws(() => cleanView({ conditions: [{ field: "bedrag", op: "gt" }] }, fields), /getal/);
  assert.throws(() => cleanView({ conditions: [{ field: "datum", op: "weekday", value: [8] }] }, fields), /dag van de week/);
  assert.deepEqual(cleanView({}, fields), { match: "all", conditions: [] });
});

test("voorwaarden in woorden", () => {
  const def = (k: string) => fields.find((f) => f.key === k)!;
  assert.equal(conditionText({ field: "datum", op: "in", value: { p: "this_week" } }, def("datum"), names), "Datum valt in deze week");
  assert.equal(conditionText({ field: "datum", op: "week_of_month", value: 1 }, def("datum"), names), "Datum valt in week 1 van de maand");
  assert.equal(conditionText({ field: "door", op: "any_of", value: ["me", "b"] }, def("door"), names), "Betaald door is een van jij, Ana");
  assert.equal(conditionText({ field: "bedrag", op: "gt", value: 2000 }, def("bedrag"), names).replace(/\s/g, " "), "Bedrag groter dan € 20,00");
  assert.equal(conditionText({ field: "datum", op: "in", value: { p: "last_days", n: 30 } }, def("datum"), names), "Datum valt in de laatste 30 dagen");
});
