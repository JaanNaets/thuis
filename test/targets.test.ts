// Waar je iets toevoegt en waarmee je logt (shared/targets.ts): de + toont wat er gebeurde, bij een item de formulieren
// die erbij horen, en wat er van je tekst overblijft naast de naam van een item.
import assert from "node:assert/strict";
import { test } from "node:test";
import { presetDoes } from "../shared/cells.ts";
import { baseKind, baseParts, type KindInfo, type LineRole } from "../shared/model.ts";
import { buildTargets, logForms, logPath, pricedFirst, receiptForms, restAfter, withoutPrice, type Targets } from "../shared/targets.ts";

const list = (id: string, name: string, one: string | null, stock = false) => ({ id, name, one, icon: null, color: null, stock });
/** Een formulier met een groep lijnen uit één lijst (Proeverij: uit Wijnen). */
const from = (id: string, base: KindInfo["base"], name: string, role: LineRole, listId: string): KindInfo => ({
  ...baseKind(base),
  id,
  name,
  parts: { ...baseParts(base), groups: [{ role, label: name, lists: [listId] }] },
});

const t: Targets = {
  lists: [
    list("WIJNEN", "Wijnen", "Wijn", true),
    list("VOORRAAD", "Voorraad", "Product", true),
    list("RESTAURANTS", "Restaurants", "Restaurant"),
    list("UITGAVEN", "Uitgaven", "Persoon"),
    list("KELDER", "Gedeelde wijnkelder", "Wijn", true),
    list("WINKELS", "Winkels", "Winkel"),
  ],
  kinds: [
    from("proeverij", "gebruik", "Proeverij", "uit", "WIJNEN"),
    from("weg", "gebruik", "Weggegooid", "uit", "VOORRAAD"),
    from("uiteten", "dienst", "Uit eten", "voor", "RESTAURANTS"),
    // Een aankoop die het saldo in Uitgaven bijhoudt en telt in elke voorraad.
    { ...baseKind("aankoop"), id: "aankoop-u", name: "Aankoop", parts: baseParts("aankoop"), does: presetDoes("aankoop", "UITGAVEN") },
    { ...baseKind("aankoop"), id: "boodschap", name: "Boodschap", planned: true },
    from("proeverij-k", "gebruik", "Proeverij", "uit", "KELDER"),
  ],
  used: [{ list_id: null, kind: "boodschap", n: 5, last: "2026-11-09" }],
};

test("de +: een formulier om te loggen, en per lijst met items een nieuw item", () => {
  const all = buildTargets(t);
  const keys = all.map((x) => x.key);
  assert.ok(keys.includes("soort:proeverij"));
  assert.ok(keys.includes("item:RESTAURANTS"));
  assert.equal(all.find((x) => x.key === "item:RESTAURANTS")?.name, "Restaurant");
  // Waar een formulier invult, staat erbij; wat je het meest gebruikt, eerst.
  assert.equal(all.find((x) => x.key === "soort:aankoop-u")?.hint, "Uitgaven");
  assert.equal(all[0].key, "soort:boodschap");
});

test("bij een item: de formulieren die de lijst invullen, en met voorraad die de voorraad veranderen", () => {
  const wijn = logForms(t, "WIJNEN");
  // Eerst het formulier dat Wijnen uitdrukkelijk invult, dan wat je het meest gebruikt (Boodschap).
  assert.deepEqual(
    wijn.map((f) => f.kind.id),
    ["proeverij", "boodschap", "aankoop-u"],
  );
  // Zonder voorraad enkel wat de lijst invult; een lijst die niets invult, heeft niets.
  assert.deepEqual(logForms(t, "RESTAURANTS").map((f) => f.label), ["Uit eten"]);
  assert.deepEqual(logForms(t, "WINKELS"), []);
  assert.deepEqual(logForms(t, "KELDER").map((f) => f.kind.id), ["proeverij-k", "boodschap", "aankoop-u"]);
  // Wat je bij de + verborg niet, en een lijst waar je niet logt heeft niets.
  assert.deepEqual(logForms(t, "VOORRAAD", (id) => id !== "boodschap").map((f) => f.label), ["Weggegooid", "Aankoop"]);
  assert.deepEqual(logForms(t, "ANDERE"), []);
  // Uitgaven: de aankoop houdt er het saldo bij.
  assert.deepEqual(logForms(t, "UITGAVEN").map((f) => f.kind.id), ["aankoop-u"]);
});

test("het pad: loggen met het formulier, met het item als lijn, je tekst en waar je vandaan komt", () => {
  const aankoop = logForms(t, "WIJNEN").find((f) => f.kind.id === "aankoop-u")!;
  assert.equal(logPath(aankoop.kind, "CHABLIS", "54 euro"), "/loggen?formulier=aankoop-u&item=CHABLIS&tekst=54+euro");
  // Vanuit Wijnen een aankoop: een nieuwe wijn in een lijn komt in Wijnen.
  assert.equal(logPath(aankoop.kind, undefined, "", "WIJNEN"), "/loggen?formulier=aankoop-u&nieuw=WIJNEN");
});

test("met een bedrag eerst de formulieren met geld; een nieuwe naam zonder bedrag", () => {
  const wijn = logForms(t, "WIJNEN");
  assert.deepEqual(pricedFirst(wijn, "chablis").map((f) => f.kind.id), ["proeverij", "boodschap", "aankoop-u"]);
  assert.deepEqual(pricedFirst(wijn, "chablis 54 euro").map((f) => f.kind.id), ["aankoop-u", "proeverij", "boodschap"]);
  assert.equal(withoutPrice("chablis 54 euro"), "chablis");
  assert.equal(withoutPrice("€ 4,99 yoghurt"), "yoghurt");
  assert.equal(withoutPrice("melk 2"), "melk 2");
});

test("wat er van je tekst overblijft naast een item", () => {
  assert.equal(restAfter("chablis 54 euro", "Chablis"), "54 euro");
  assert.equal(restAfter("Foru", "Het Forum"), "");
  assert.equal(restAfter("het forum 4 sterren", "Het Forum"), "4 sterren");
  assert.equal(restAfter("Crémant 2", "Crémant de Loire"), "2");
  assert.equal(restAfter("halfvolle melk", "Melk"), "halfvolle");
});

test("een kasticket: met een formulier dat koopt en niet gepland begint", () => {
  assert.deepEqual(receiptForms(t).map((k) => k.id), ["aankoop-u"]);
});
