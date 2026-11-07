import assert from "node:assert/strict";
import { test } from "node:test";
import { aiAllowed, appPath, cleanAppSettings, cleanDestination, destinationLabel, destinationPath, keepReachable, mutedBy, sameDestination, shownIn, type Reach } from "../shared/apps.ts";

const reach: Reach = {
  boards: [
    { id: "main", name: "Overzicht" },
    { id: "k1", name: "Keuken" },
  ],
  lists: new Map([
    ["pel", { name: "Pellets", one: "Voorraad", edit: true, kinds: new Map([["bij", "Bijvulling"]]) }],
    ["jaan", { name: "Jaan", one: null, edit: true, kinds: new Map([["gew", "Gewicht"]]) }],
    ["wijn", { name: "Wijnen", one: "Wijn", edit: false, kinds: new Map() }],
  ]),
};

test("bestemmingen: nagekeken, als pad en met een naam", () => {
  assert.equal(cleanDestination({ kind: "board", board: "../x" }), null);
  assert.equal(cleanDestination({ kind: "raar" }), null);
  // De vaste weergaven (Geld, Agenda, …) zijn borden geworden: zo'n bestemming valt weg.
  assert.equal(cleanDestination({ kind: "view", view: "geld" }), null);
  assert.equal(cleanDestination({ kind: "agenda" }), null);
  assert.deepEqual(cleanDestination({ kind: "form", list: "pel", type: "bij", text: "  3 zakken  pellets " }), { kind: "form", list: "pel", type: "bij", text: "3 zakken pellets" });
  assert.deepEqual(cleanDestination({ kind: "form", list: "pel", thing: true, type: "bij" }), { kind: "form", list: "pel", thing: true });
  assert.equal(destinationPath({ kind: "board", board: "k1" }), "/bord/k1");
  assert.equal(destinationPath({ kind: "list", list: "pel" }), "/lijsten/pel");
  assert.equal(destinationPath({ kind: "form", list: "pel", type: "bij", text: "3 zakken" }), "/lijsten/pel/loggen?soort=bij&tekst=3+zakken");
  assert.equal(destinationPath({ kind: "form", list: "pel", thing: true }), "/lijsten/pel/nieuw");
  assert.equal(destinationLabel({ kind: "board", board: "k1" }, reach), "Keuken");
  assert.equal(destinationLabel({ kind: "list", list: "pel" }, reach), "Pellets");
  assert.equal(destinationLabel({ kind: "form", list: "pel", type: "bij" }, reach), "Bijvulling loggen");
  assert.equal(destinationLabel({ kind: "form", list: "pel", thing: true }, reach), "Voorraad toevoegen");
  assert.equal(appPath("a1"), "/app/a1");
  assert.equal(sameDestination({ kind: "form", list: "pel", type: "bij", text: "x " }, { kind: "form", list: "pel", type: "bij", text: "x" }), true);
  assert.equal(sameDestination({ kind: "list", list: "pel" }, { kind: "list", list: "jaan" }), false);
});

test("app-instellingen: nagekeken, met nieuwe ids, en wat je niet meer bereikt valt weg", () => {
  let n = 0;
  const s = cleanAppSettings(
    {
      apps: [
        { id: "a1", name: " Pellets ", to: { kind: "form", list: "pel", type: "bij" } },
        { id: "a1", name: "Dubbel", to: { kind: "board", board: "main" } },
        { name: "Geld", to: { kind: "view", view: "geld" } },
        { name: "Geen bestemming" },
        { name: "Wijn", to: { kind: "form", list: "wijn", thing: true } },
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
  // Wijn: geen recht om toe te voegen; Weg: geen lijst meer.
  assert.deepEqual(kept.apps.map((a) => a.name), ["Pellets", "Dubbel"]);
  assert.deepEqual(kept.share, { kind: "receipt", list: "pel" });
  assert.deepEqual(keepReachable({ ...s, share: { kind: "receipt", list: "wijn" } }, reach).share, { kind: "ask" });
  assert.deepEqual(cleanAppSettings(null), { apps: [], shortcuts: null, share: { kind: "ask" }, ai: true, muted: [], hidden: { menu: [], add: [] } });
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
  const reach = { boards: [], lists: new Map([["l1", { name: "Winkels", one: "Winkel", edit: true, kinds: new Map() }]]) };
  assert.deepEqual(keepReachable(s, reach).hidden, { menu: ["l1"], add: [] });
});

test("stil: de lijst zelf, of via een van haar tags", () => {
  const list = { id: "wijn", tags: ["huis", "eten"] };
  assert.equal(mutedBy([], list), null);
  assert.equal(mutedBy(["wijn", "eten"], list), "list");
  assert.equal(mutedBy(["eten"], list), "eten");
  assert.equal(mutedBy(["ander"], list), null);
});
