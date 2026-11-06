import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDef, FieldValue } from "../shared/fields.ts";
import { formSuggestions, hasPiece, insertSuggestion, matchSuggestions, moveTargets, moveValue, nameIn, nameMatches, quickFill, readDate, suggestionLists, typedFragments, withoutPieces, wordAt, type Suggestion } from "../shared/quickfill.ts";

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

test("welke tekst in welk veld kwam (om te tonen, te verplaatsen of terug te nemen)", () => {
  const r = quickFill("gisteren 2 zakken Jana", [
    { key: "datum", label: "Datum", type: "date" },
    { key: "zakken", label: "Zakken", type: "number", unit: "zakken" },
    { key: "wie", label: "Wie", type: "person" },
  ], ctx);
  assert.deepEqual(r.parts, { datum: ["gisteren"], zakken: ["2 zakken"], wie: ["Jana"] });
  assert.deepEqual(quickFill("komkommer 200 g", eten, { ...ctx, items: () => [] }).parts, { hoeveel: ["200 g"], wat: ["komkommer"], name: ["komkommer"] });
});

test("ingrediënten uit één zin: een lijst met komma's, of één stuk als niets anders het kan nemen", () => {
  const recept: FieldDef[] = [
    { key: "porties", label: "Porties", type: "number" },
    { key: "ingredienten", label: "Ingrediënten", type: "amounts", ref_type: "V" },
  ];
  const stock = { ...ctx, items: (k: string) => (k === "ingredienten" ? [{ id: "a", name: "Aardappelen" }, { id: "e", name: "Eieren" }] : []) };
  const r = quickFill("4 porties 400 g aardappelen, 2 eieren, zout", recept, stock);
  assert.deepEqual(r.data, {
    porties: 4,
    ingredienten: [{ item: "a", amount: 400, unit: "g" }, { item: "e", amount: 2 }, { text: "zout" }],
  });
  assert.equal(r.name, null);
  // Eén stuk bij een recept: een ingrediënt; bij Eten (met een verwijzing naar dezelfde lijst) een product en een gewicht.
  assert.deepEqual(quickFill("1,5 kg aardappelen", recept, stock).data, { ingredienten: [{ item: "a", amount: 1.5, unit: "kg" }] });
  const maaltijd: FieldDef[] = [{ key: "voorraad", label: "Uit voorraad", type: "item", ref_type: "V" }, { key: "gram", label: "Hoeveel", type: "number", unit: "g" }, ...recept];
  const both = { ...ctx, items: (k: string) => [{ id: "a", name: "Aardappelen" }, { id: "e", name: "Eieren" }].filter(() => k !== "") };
  assert.deepEqual(quickFill("200 g aardappelen", maaltijd, both).data, { gram: 200, voorraad: "a" });
  assert.deepEqual(quickFill("200 g aardappelen, 2 eieren", maaltijd, both).data, {
    ingredienten: [{ item: "a", amount: 200, unit: "g" }, { item: "e", amount: 2 }],
  });
});

test("stukken uit de tekst halen en waarden naar een ander veld", () => {
  assert.equal(withoutPieces("40 euro 2 zakken Pellets", ["2 zakken", "pellets"]), "40 euro");
  assert.equal(withoutPieces("rode wijn rood", ["rood"]), "rode wijn");
  assert.ok(hasPiece("2 zakken Pellets", "pellets"));
  assert.ok(!hasPiece("2 zakken Pelletskorrels", "pellets"));
  const fields: FieldDef[] = [
    { key: "bedrag", label: "Bedrag", type: "money" },
    { key: "stuks", label: "Aantal", type: "number" },
    { key: "datum", label: "Datum", type: "date" },
    { key: "tht", label: "Houdbaar tot", type: "date" },
    { key: "van", label: "Van", type: "person" },
    { key: "aan", label: "Aan", type: "person" },
    { key: "soort", label: "Soort", type: "select", options: ["Rood", "Wit"] },
    { key: "kleur", label: "Kleur", type: "select", options: ["Rood", "Blauw"] },
  ];
  const keys = (key: string, v: FieldValue) => moveTargets(fields, key, v).map((f) => f.key);
  assert.deepEqual(keys("stuks", 2), ["bedrag"]);
  assert.deepEqual(keys("datum", "2026-11-04"), ["tht"]);
  assert.deepEqual(keys("van", "p1"), ["aan"]);
  assert.deepEqual(keys("soort", "Rood"), ["kleur"]);
  assert.deepEqual(keys("soort", "Wit"), []);
  assert.equal(moveValue(fields[0], fields[1], 4000), 40);
  assert.equal(moveValue(fields[1], fields[0], 2.5), 250);
  assert.deepEqual(wordAt("40 euro 2 zakken", 9), { word: "2", start: 8, end: 9 });
  assert.equal(wordAt("40 euro ", 8), null);
});

test("een persoon ook op een ander woord van de naam, als maar één zo heet", () => {
  const who: FieldDef[] = [{ key: "wie", label: "Wie", type: "person" }];
  const two = { ...ctx, people: [{ id: "a", name: "Pellet Jaan" }, { id: "b", name: "Pellet Jana" }] };
  assert.deepEqual(quickFill("jana", who, two).data, { wie: "b" });
  // Een familienaam die bij beiden past: dan niet.
  const family = { ...ctx, people: [{ id: "a", name: "Jaan Naets" }, { id: "b", name: "Jana Naets" }] };
  assert.deepEqual(quickFill("naets", who, family).data, {});
});

test("Eten: een getal gaat naar Hoeveel, nooit vanzelf naar kcal per 100 g of de portie", () => {
  const eten: FieldDef[] = [
    { key: "kcal_100", label: "kcal per 100 g", type: "number", unit: "kcal", product: "kcal" },
    { key: "portie", label: "Portie", type: "number", unit: "g", product: "serving" },
    { key: "gram", label: "Hoeveel", type: "number", unit: "g", portion: "portie" },
    { key: "eiwit_100", label: "Eiwit per 100 g", type: "number", unit: "g", product: "protein" },
  ];
  const none = { ...ctx, items: () => [] };
  assert.deepEqual(quickFill("banaan 120 g", eten, none).data, { gram: 120 });
  assert.deepEqual(quickFill("pizza 300", eten, none).data, { gram: 300 });
  assert.deepEqual(quickFill("soep 250g", eten, none).data, { gram: 250 });
  assert.equal(quickFill("pizza 300 kcal", eten, none).data.kcal_100, undefined);
  // Met een gekende portie: "2 porties" blijft omrekenen naar Hoeveel.
  assert.deepEqual(quickFill("2 porties soep", eten, { ...none, values: (k: string) => (k === "portie" ? 250 : undefined) }).data, { gram: 500 });
});

test("Een getal met een gewoon woord erachter is een aantal, geen gewicht", () => {
  const eten: FieldDef[] = [
    { key: "kcal_100", label: "kcal per 100 g", type: "number", unit: "kcal", product: "kcal" },
    { key: "gram", label: "Hoeveel", type: "number", unit: "g", portion: "portie" },
  ];
  const none = { ...ctx, items: () => [] };
  const r = quickFill("2 boterhammen", eten, none);
  assert.deepEqual(r.data, {});
  assert.equal(r.name, "2 boterhammen");
  // Een hele zin gaat naar ✨, ook zonder gewicht erin.
  assert.equal(quickFill("2 boterhammen met kaas", eten, none).sentence, true);
  // Een getal met een eenheid of op het einde blijft hoeveel; een datum erna ook.
  assert.deepEqual(quickFill("soep 300 g", eten, none).data, { gram: 300 });
  assert.deepEqual(quickFill("pizza 300 gisteren", eten, none).data.gram, 300);
  // Water in ml: "water 500" blijft 500 ml.
  assert.deepEqual(quickFill("water 500", [{ key: "ml", label: "Hoeveel", type: "number", unit: "ml" }], none).data, { ml: 500 });
});

test("een aankoop typen: 'yoghurt Colruyt 6 stuks 120 gram 6 euro' in een boodschap, een product en een uitgave", () => {
  const text = "yoghurt Colruyt 6 stuks 120 gram 6 euro";
  const shopCtx = { today: "2026-11-06", people: [], items: (k: string) => (k === "winkel" ? [{ id: "w1", name: "Colruyt" }] : []) };
  const boodschap: FieldDef[] = [
    { key: "product", label: "Product", type: "item", ref_type: "voorraad", free: true, copy: true },
    { key: "hoeveel", label: "Hoeveel", type: "number" },
    { key: "gekocht", label: "Gekocht", type: "bool" },
    { key: "winkel", label: "Winkel", type: "item", ref_type: "winkels", free: true },
  ];
  // De winkel wordt nooit de naam; de maat en het bedrag (geen plaats) vallen weg.
  const shop = quickFill(text, boodschap, shopCtx);
  assert.equal(shop.name, "Yoghurt");
  assert.deepEqual(shop.data, { hoeveel: 6, winkel: "w1", product: { text: "yoghurt" } });
  const voorraad: FieldDef[] = [
    { key: "aantal", label: "Aantal", type: "number", counter: true, measure: { unit: "eenheid", piece: "inhoud", pack: "per_verpakking" } },
    { key: "eenheid", label: "Eenheid", type: "select", options: ["stuk", "kg", "g", "zak"] },
    { key: "per_verpakking", label: "Per verpakking", type: "number" },
    { key: "inhoud", label: "Inhoud per stuk", type: "number", unit: "g" },
  ];
  // "6 stuks" is het aantal in stuks, "120 gram" de inhoud per stuk; "6 euro" nooit een getal of een naam.
  const product = quickFill(text, voorraad, shopCtx);
  assert.equal(product.name, "Yoghurt Colruyt");
  assert.deepEqual(product.data, { aantal: 6, eenheid: "stuk", inhoud: 120 });
  const uitgave: FieldDef[] = [
    { key: "bedrag", label: "Bedrag", type: "money" },
    { key: "wat", label: "Wat", type: "item", ref_type: "voorraad", free: true, adjust: { field: "aantal", by: "hoeveel", sign: 1, unit_by: "eenheid" } },
    { key: "hoeveel", label: "Hoeveel", type: "number" },
    { key: "eenheid", label: "Eenheid", type: "select", options: ["stuk", "kg", "g", "zak"] },
    { key: "winkel", label: "Winkel", type: "item", ref_type: "winkels", free: true },
  ];
  // "120 gram" is nooit € 120.
  const buy = quickFill(text, uitgave, shopCtx);
  assert.equal(buy.name, "Yoghurt");
  assert.deepEqual(buy.data, { hoeveel: 6, eenheid: "stuk", bedrag: 600, winkel: "w1", wat: { text: "yoghurt" } });
  // "2 zakken pellets 13 euro": de eenheid zak, en een kale prijs gaat nog altijd naar het bedrag.
  assert.deepEqual(quickFill("pellets 2 zakken 13", uitgave, shopCtx).data, { hoeveel: 2, eenheid: "zak", bedrag: 1300, wat: { text: "pellets" } });
});
