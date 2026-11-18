import assert from "node:assert/strict";
import { test } from "node:test";
import { aiAllowed, appPath, cleanAppSettings, cleanDestination, destinationLabel, destinationPath, keepReachable, legacyForm, mutedBy, sameDestination, shownIn, type Reach, type ReachForm, orderTags } from "../shared/apps.ts";

const form = (name: string, base: string, fills: string[], edit = true, receipt = false): ReachForm => ({ name, base, fills, edit, receipt });
const reach: Reach = {
  boards: [
    { id: "main", name: "Overzicht" },
    { id: "k1", name: "Keuken" },
  ],
  lists: new Map([
    ["pel", { name: "Pellets", one: "Voorraad", edit: true }],
    ["wijn", { name: "Wijnen", one: "Wijn", edit: false }],
  ]),
  forms: new Map([
    ["bij", form("Bijvulling", "aankoop", ["pel"], true, true)],
    ["gew", form("Gewicht", "meting", [])],
    ["wijn-aankoop", form("Aankoop", "aankoop", [], true, true)],
    ["proef", form("Proeverij", "gebruik", ["wijn"], false)],
  ]),
};

test("bestemmingen: nagekeken, als pad en met een naam", () => {
  assert.equal(cleanDestination({ kind: "board", board: "../x" }), null);
  assert.equal(cleanDestination({ kind: "raar" }), null);
  // De vaste weergaven (Geld, Agenda, …) zijn borden geworden: zo'n bestemming valt weg.
  assert.equal(cleanDestination({ kind: "view", view: "geld" }), null);
  assert.equal(cleanDestination({ kind: "agenda" }), null);
  assert.deepEqual(cleanDestination({ kind: "form", form: "bij", text: "  3 zakken  pellets " }), { kind: "form", form: "bij", text: "3 zakken pellets" });
  assert.deepEqual(cleanDestination({ kind: "item", list: "pel", text: "x" }), { kind: "item", list: "pel", text: "x" });
  // Van vroeger: een lijst met een soort (de lijst blijft om het formulier terug te vinden), of een item toevoegen.
  assert.deepEqual(cleanDestination({ kind: "form", list: "pel", type: "aankoop" }), { kind: "form", form: "aankoop", list: "pel" });
  assert.deepEqual(cleanDestination({ kind: "form", list: "pel", item: true, type: "bij" }), { kind: "item", list: "pel" });
  assert.equal(destinationPath({ kind: "board", board: "k1" }), "/bord/k1");
  assert.equal(destinationPath({ kind: "list", list: "pel" }), "/lijsten/pel");
  assert.equal(destinationPath({ kind: "form", form: "bij", text: "3 zakken" }), "/loggen?formulier=bij&tekst=3+zakken");
  assert.equal(destinationPath({ kind: "item", list: "pel" }), "/lijsten/pel/nieuw");
  assert.equal(destinationLabel({ kind: "board", board: "k1" }, reach), "Keuken");
  assert.equal(destinationLabel({ kind: "list", list: "pel" }, reach), "Pellets");
  assert.equal(destinationLabel({ kind: "form", form: "bij" }, reach), "Bijvulling loggen");
  assert.equal(destinationLabel({ kind: "item", list: "pel" }, reach), "Voorraad toevoegen");
  assert.equal(appPath("a1"), "/app/a1");
  assert.equal(sameDestination({ kind: "form", form: "bij", text: "x " }, { kind: "form", form: "bij", text: "x" }), true);
  assert.equal(sameDestination({ kind: "list", list: "pel" }, { kind: "list", list: "jaan" }), false);
});

test("app-instellingen: nagekeken, met nieuwe ids, en wat je niet meer bereikt valt weg", () => {
  let n = 0;
  const s = cleanAppSettings(
    {
      apps: [
        { id: "a1", name: " Pellets ", to: { kind: "form", list: "pel", type: "aankoop" } },
        { id: "a1", name: "Dubbel", to: { kind: "board", board: "main" } },
        { name: "Geld", to: { kind: "view", view: "geld" } },
        { name: "Geen bestemming" },
        { name: "Wijn", to: { kind: "form", list: "wijn", item: true } },
        { name: "Weg", to: { kind: "list", list: "weg" } },
      ],
      shortcuts: [{ name: "Keuken", to: { kind: "board", board: "k1" } }, { name: "x", to: { kind: "raar" } }],
      share: { kind: "receipt", list: "pel" },
    },
    () => `n${++n}`,
  );
  assert.deepEqual(s.apps.map((a) => [a.id, a.name]), [["a1", "Pellets"], ["n1", "Dubbel"], ["n2", "Wijn"], ["n3", "Weg"]]);
  assert.deepEqual(s.shortcuts, [{ name: "Keuken", to: { kind: "board", board: "k1" } }]);
  const kept = keepReachable(s, reach);
  // Wijn: geen recht om toe te voegen; Weg: geen lijst meer. Pellets van vroeger (een lijst met een vertrekpunt) wordt
  // het formulier dat die lijst invult met dat vertrekpunt.
  assert.deepEqual(kept.apps.map((a) => a.name), ["Pellets", "Dubbel"]);
  assert.deepEqual(kept.apps[0].to, { kind: "form", form: "bij" });
  assert.deepEqual(kept.share, { kind: "receipt", form: "bij" });
  assert.deepEqual(keepReachable({ ...s, share: { kind: "receipt", form: "aankoop", list: "wijn" } }, reach).share, { kind: "receipt", form: "wijn-aankoop" });
  assert.deepEqual(keepReachable({ ...s, share: { kind: "receipt", form: "gew" } }, reach).share, { kind: "ask" }, "Gewicht leest geen kasticket");
  assert.deepEqual(cleanAppSettings(null), { apps: [], shortcuts: null, share: { kind: "ask" }, ai: true, muted: [], hidden: { menu: [], add: [] }, tag_order: [] });
  assert.deepEqual(cleanAppSettings({ muted: ["pel", "pel", "../x", 3] }).muted, ["pel"]);
});

test("lezen met AI: staat aan tenzij je ze uitdrukkelijk uitzette, en blijft bij het nakijken", () => {
  assert.equal(aiAllowed(null), true);
  assert.equal(aiAllowed({}), true);
  assert.equal(aiAllowed({ ai: "nee" }), true);
  assert.equal(aiAllowed({ ai: 0 }), true);
  assert.equal(aiAllowed({ ai: false }), false);
  const off = cleanAppSettings({ ai: false });
  assert.equal(off.ai, false);
  assert.equal(keepReachable(off, reach).ai, false);
  assert.equal(cleanAppSettings({ ai: true }).ai, true);
});

test("lijsten verbergen: per plek, nagekeken, en wat je niet meer ziet valt weg", () => {
  const s = cleanAppSettings({ hidden: { menu: ["l1", "l1", "<bad>"], add: ["l2", 4] } });
  assert.deepEqual(s.hidden, { menu: ["l1"], add: ["l2"] });
  assert.equal(shownIn(s.hidden, "menu", "l1"), false);
  assert.equal(shownIn(s.hidden, "add", "l1"), true);
  assert.deepEqual(cleanAppSettings(null).hidden, { menu: [], add: [] });
  const reach = { boards: [], lists: new Map([["l1", { name: "Winkels", one: "Winkel", edit: true }]]), forms: new Map() };
  assert.deepEqual(keepReachable(s, reach).hidden, { menu: ["l1"], add: [] });
});

test("stil: het formulier zelf, of via een van zijn tags", () => {
  const form = { id: "proef", tags: ["huis", "eten"] };
  assert.equal(mutedBy([], form), null);
  assert.equal(mutedBy(["proef", "eten"], form), "self");
  assert.equal(mutedBy(["eten"], form), "eten");
  assert.equal(mutedBy(["ander"], form), null);
});

test("een formulier van vroeger terugvinden: het zelf, dat van de omzetting, of een dat de lijst invult", () => {
  assert.equal(legacyForm(reach.forms, "bij", undefined), "bij");
  assert.equal(legacyForm(reach.forms, "aankoop", "wijn"), "wijn-aankoop");
  assert.equal(legacyForm(reach.forms, "aankoop", "pel"), "bij");
  assert.equal(legacyForm(reach.forms, "", "wijn"), "proef");
  assert.equal(legacyForm(reach.forms, "", "wijn", (f) => f.edit), null);
  assert.equal(legacyForm(reach.forms, "dienst", "pel"), null);
});

test("tags: jouw volgorde (de rest op naam), en een verborgen tag blijft verborgen zolang je ze ziet", () => {
  const tags = [
    { id: "t1", name: "Wijnkelder" },
    { id: "t2", name: "Huis" },
    { id: "t3", name: "auto" },
    { id: "t4", name: "Biohoeve" },
  ];
  assert.deepEqual(orderTags(tags, ["t1", "t2"]).map((t) => t.name), ["Wijnkelder", "Huis", "auto", "Biohoeve"]);
  assert.deepEqual(orderTags(tags, []).map((t) => t.name), ["auto", "Biohoeve", "Huis", "Wijnkelder"]);
  assert.deepEqual(orderTags(tags, ["weg", "t4"]).map((t) => t.id), ["t4", "t3", "t2", "t1"]);
  const s = cleanAppSettings({ tag_order: ["t2", "t2", "t1", "../x"], hidden: { menu: ["t1", "pel"], add: ["t1"] } });
  assert.deepEqual(s.tag_order, ["t2", "t1"]);
  const kept = keepReachable(s, { ...reach, tags: new Set(["t1"]) });
  assert.deepEqual(kept.hidden.menu, ["t1", "pel"], "een tag in het menu blijft verborgen");
  assert.deepEqual(kept.hidden.add, [], "bij de + gaat het per lijst");
  assert.deepEqual(kept.tag_order, ["t1"], "een tag die je niet meer ziet, valt uit je volgorde");
});
