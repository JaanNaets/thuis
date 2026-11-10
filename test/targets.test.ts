// Waar je iets toevoegt en waarmee je logt (shared/targets.ts): de + toont wat er gebeurde, bij een ding de formulieren
// die erbij horen, en wat er van je tekst overblijft naast de naam van een ding.
import assert from "node:assert/strict";
import { test } from "node:test";
import { baseKind, type KindInfo } from "../shared/model.ts";
import { buildTargets, logForms, logPath, pricedFirst, receiptLists, restAfter, withoutPrice, type Targets } from "../shared/targets.ts";

const list = (id: string, name: string, one: string | null, stock = false) => ({ id, name, one, icon: null, color: null, stock });
const kind = (id: string, list_id: string, base: KindInfo["base"], name: string, planned = false): KindInfo => ({ ...baseKind(base), id, list_id, name, planned });

const t: Targets = {
  lists: [
    list("WIJNEN", "Wijnen", "Wijn", true),
    list("VOORRAAD", "Voorraad", "Product", true),
    list("RESTAURANTS", "Restaurants", "Restaurant"),
    list("UITGAVEN", "Uitgaven", null),
    list("BOODSCHAPPEN", "Boodschappen", null),
    list("KELDER", "Gedeelde wijnkelder", "Wijn", true),
    list("WINKELS", "Winkels", "Winkel"),
  ],
  kinds: [
    ...(["aankoop", "gebruik", "dienst", "activiteit", "meting", "overdracht"] as const).map(baseKind),
    kind("proeverij", "WIJNEN", "gebruik", "Proeverij"),
    kind("weg", "VOORRAAD", "gebruik", "Weggegooid"),
    kind("uiteten", "RESTAURANTS", "dienst", "Uit eten"),
    kind("aankoop-u", "UITGAVEN", "aankoop", "Aankoop"),
    kind("boodschap", "BOODSCHAPPEN", "aankoop", "Boodschap", true),
    kind("aankoop-k", "KELDER", "aankoop", "Aankoop"),
    kind("proeverij-k", "KELDER", "gebruik", "Proeverij"),
    // Een lijst die je enkel ziet (niet in `lists`): haar formulieren tellen niet mee.
    kind("vreemd", "ANDERE", "aankoop", "Aankoop"),
  ],
  used: [{ list_id: "BOODSCHAPPEN", kind: "boodschap", n: 5, last: "2026-11-09" }],
};

test("de +: geen Loggen in een lijst die eigen formulieren heeft, wel in een lijst zonder", () => {
  const keys = buildTargets(t).map((x) => x.key);
  assert.ok(!keys.includes("log:WIJNEN"));
  assert.ok(!keys.includes("log:UITGAVEN"));
  assert.ok(keys.includes("log:WINKELS"));
  assert.ok(keys.includes("ding:RESTAURANTS"));
  assert.equal(buildTargets(t).find((x) => x.key === "ding:RESTAURANTS")?.name, "Restaurant");
});

test("bij een ding: de eigen formulieren, en met voorraad die van lijsten zonder dingen die de voorraad veranderen", () => {
  const wijn = logForms(t, "WIJNEN");
  // Eerst het eigen formulier, dan wat je het meest gebruikt (Boodschap), niet de Aankoop van de gedeelde wijnkelder.
  assert.deepEqual(
    wijn.map((f) => [f.label, f.list_id, f.hint]),
    [
      ["Proeverij", "WIJNEN", null],
      ["Boodschap", "BOODSCHAPPEN", "Boodschappen"],
      ["Aankoop", "UITGAVEN", "Uitgaven"],
    ],
  );
  // Zonder voorraad enkel het eigen formulier; zonder eigen formulieren Loggen (met de basissoorten).
  assert.deepEqual(logForms(t, "RESTAURANTS").map((f) => f.label), ["Uit eten"]);
  assert.deepEqual(logForms(t, "WINKELS").map((f) => [f.label, f.kind]), [["Loggen", null]]);
  // Twee formulieren met dezelfde naam: de lijst erbij. De eigen in hun volgorde (zoals de server ze geeft).
  assert.deepEqual(logForms(t, "KELDER").map((f) => f.label), ["Aankoop · Gedeelde wijnkelder", "Proeverij", "Boodschap", "Aankoop · Uitgaven"]);
  // Wat je bij de + verborg niet, en een lijst waar je niet logt heeft niets.
  assert.deepEqual(logForms(t, "VOORRAAD", (id) => id !== "BOODSCHAPPEN").map((f) => f.label), ["Weggegooid", "Aankoop"]);
  assert.deepEqual(logForms(t, "ANDERE"), []);
});

test("het pad: de gebeurtenis komt in de lijst van het formulier, met het ding als lijn en je tekst", () => {
  const aankoop = logForms(t, "WIJNEN").find((f) => f.list_id === "UITGAVEN")!;
  assert.equal(logPath(aankoop, "CHABLIS", "54 euro"), "/lijsten/UITGAVEN/loggen?soort=aankoop-u&ding=CHABLIS&tekst=54+euro");
  assert.equal(logPath(logForms(t, "WINKELS")[0], "COLRUYT"), "/lijsten/WINKELS/loggen?ding=COLRUYT");
});

test("met een bedrag eerst de formulieren met geld; een nieuwe naam zonder bedrag", () => {
  const wijn = logForms(t, "WIJNEN");
  assert.deepEqual(pricedFirst(wijn, "chablis").map((f) => f.label), ["Proeverij", "Boodschap", "Aankoop"]);
  assert.deepEqual(pricedFirst(wijn, "chablis 54 euro").map((f) => f.label), ["Aankoop", "Proeverij", "Boodschap"]);
  assert.equal(withoutPrice("chablis 54 euro"), "chablis");
  assert.equal(withoutPrice("€ 4,99 yoghurt"), "yoghurt");
  assert.equal(withoutPrice("melk 2"), "melk 2");
});

test("wat er van je tekst overblijft naast een ding", () => {
  assert.equal(restAfter("chablis 54 euro", "Chablis"), "54 euro");
  assert.equal(restAfter("Foru", "Het Forum"), "");
  assert.equal(restAfter("het forum 4 sterren", "Het Forum"), "4 sterren");
  assert.equal(restAfter("Crémant 2", "Crémant de Loire"), "2");
  assert.equal(restAfter("halfvolle melk", "Melk"), "halfvolle");
});

test("een kasticket: in een lijst met een eigen aankoop die niet gepland begint", () => {
  assert.deepEqual(receiptLists(t).map((l) => l.id), ["UITGAVEN", "KELDER"]);
  // Zonder zo'n lijst: de lijsten die voorraad tellen.
  assert.deepEqual(receiptLists({ ...t, kinds: t.kinds.filter((k) => k.base !== "aankoop" || !k.list_id) }).map((l) => l.id), ["WIJNEN", "VOORRAAD", "KELDER"]);
});
