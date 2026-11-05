import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDef } from "../shared/fields.ts";
import { formSuggestions, insertSuggestion, matchSuggestions, nameIn, nameMatches, quickFill, readDate, suggestionLists, typedFragments, type Suggestion } from "../shared/quickfill.ts";

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

test("meer datums: in de volgorde van de datumvelden, daarna een periode", () => {
  const velden: FieldDef[] = [
    { key: "gekocht", label: "Gekocht", type: "date" },
    { key: "geleverd", label: "Geleverd", type: "date" },
    { key: "garantie", label: "Garantie tot", type: "date" },
  ];
  assert.deepEqual(quickFill("1-10 5-10 1-10-2028", velden, ctx).data, { gekocht: "2026-10-01", geleverd: "2026-10-05", garantie: "2028-10-01" });
  const reis: FieldDef[] = [{ key: "wanneer", label: "Wanneer", type: "date_range" }];
  assert.deepEqual(quickFill("12-7 26-7 toscane", reis, ctx).data, { wanneer: ["2026-07-12", "2026-07-26"] });
  // Een periode met één datum blijft open aan de kant die je niet gaf (het formulier vraagt de rest).
  assert.deepEqual(quickFill("12-7 toscane", reis, ctx).data, { wanneer: ["2026-07-12", null] });
});

test("zoeken op naam en namen in een tekst (verwijzingen op de server)", () => {
  assert.equal(nameMatches("Crème fraîche", "creme"), true);
  assert.equal(nameMatches("Crème fraîche", "fraich cre"), true);
  assert.equal(nameMatches("Crème fraîche", "room"), false);
  assert.equal(nameIn("Appels", "21-10 appels, 2"), true);
  assert.equal(nameIn("Rode appels", "gisteren rode appels gegeten"), true);
  assert.equal(nameIn("App", "21-10 appels 2"), false);
  assert.equal(nameIn("", "iets"), false);
});

test("keuzes terwijl je typt: het woord bij de cursor, ook met de woorden ervoor", () => {
  const t = "2 zakken pel";
  assert.deepEqual(typedFragments(t, t.length), [
    { query: "zakken pel", start: 2, end: 12 },
    { query: "pel", start: 9, end: 12 },
  ]);
  // Midden in een woord: tot het einde van dat woord.
  assert.deepEqual(typedFragments("pellets 2", 3), [{ query: "pellets", start: 0, end: 7 }]);
  // Na een spatie, één letter of een getal: niets te kiezen.
  assert.deepEqual(typedFragments("pellets ", 8), []);
  assert.deepEqual(typedFragments("p", 1), []);
  assert.deepEqual(typedFragments("21-10", 5), []);
  assert.deepEqual(typedFragments("", 0), []);
});

test("keuzes terwijl je typt: uit alle velden, de beste eerst", () => {
  const fields: FieldDef[] = [
    ...eten,
    { key: "bio", label: "Bio", type: "bool" },
    { key: "ingredienten", label: "Ingrediënten", type: "amounts", ref_type: "V1" },
    { key: "tekst", label: "Tekst", type: "amounts" },
  ];
  const local = formSuggestions(fields, ctx.people, ["Boterham met kaas", "Boterham met kaas"], "Wat");
  assert.deepEqual(
    local.filter((s) => s.field === "maaltijd").map((s) => s.text),
    ["Ontbijt", "Middag", "Avond", "Tussendoor"],
  );
  assert.ok(local.some((s) => s.field === "bio" && s.value === true));
  assert.equal(local.filter((s) => s.field === "name").length, 1);
  // Items vraagt de app per groep lijsten aan de server (wat en ingrediënten elk apart).
  assert.deepEqual(
    suggestionLists(fields).map((g) => [g.lists, g.fields.map((f) => f.key)]),
    [
      [["V1", "V2"], ["wat"]],
      [["V1"], ["ingredienten"]],
    ],
  );
  const items: Suggestion[] = [
    { field: "wat", label: "Wat", text: "Pellets", value: "i9" },
    { field: "wat", label: "Wat", text: "Appelpellets", value: "i8" },
    { field: "wat", label: "Wat", text: "Rode wijn", value: "i7" },
    { field: "wat", label: "Wat", text: "Witte wijn", value: "i6" },
  ];
  const all = [...local, ...items];
  // "pel": eerst wat ermee begint, dan wat het ergens bevat.
  const t = "2 zakken pel";
  const found = matchSuggestions(all, typedFragments(t, t.length))!;
  assert.deepEqual(
    found.suggestions.map((s) => s.text),
    ["Pellets", "Appelpellets"],
  );
  assert.deepEqual(insertSuggestion(t, found.start, found.end, "Pellets"), { text: "2 zakken Pellets ", caret: 17 });
  // Twee woorden: enkel Rode wijn, en het hele stuk wordt vervangen.
  const wine = matchSuggestions(all, typedFragments("rode wi", 7))!;
  assert.deepEqual([wine.start, wine.suggestions.map((s) => s.text)], [0, ["Rode wijn"]]);
  // Personen (Jana en Jaan Naets) en een keuze; een eerdere naam als laatste.
  assert.deepEqual(
    matchSuggestions(all, typedFragments("ja", 2))!.suggestions.map((s) => s.text),
    ["Jana", "Jaan Naets"],
  );
  assert.deepEqual(
    matchSuggestions(all, typedFragments("bo", 2))!.suggestions.map((s) => [s.text, s.label]),
    [["Boterham met kaas", "Wat"]],
  );
  assert.equal(matchSuggestions(all, typedFragments("xyz", 3)), null);
});

test("een getal met het label van het veld erachter: 4 porties", () => {
  const fields: FieldDef[] = [
    { key: "gram", label: "Hoeveel", type: "number", unit: "g" },
    { key: "porties", label: "Porties", type: "number" },
  ];
  const r = quickFill("4 porties 200 g", fields, { ...ctx, items: () => [] });
  assert.deepEqual(r.data, { porties: 4, gram: 200 });
  assert.equal(r.name, null);
  // Een eenheid wint van een label.
  assert.deepEqual(quickFill("2 g", [{ key: "g", label: "G", type: "number" }, ...fields], { ...ctx, items: () => [] }).data, { gram: 2 });
});

test("2 zakken: het verpakkingswoord hoort bij het getal", () => {
  const fields: FieldDef[] = [
    { key: "bedrag", label: "Bedrag", type: "money" },
    { key: "stuks", label: "Aantal", type: "number" },
  ];
  const r = quickFill("40 euro 2 zakken", fields, { ...ctx, items: () => [] });
  assert.deepEqual(r.data, { bedrag: 4000, stuks: 2 });
  assert.equal(r.name, null);
});
