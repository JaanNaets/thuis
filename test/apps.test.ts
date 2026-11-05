import assert from "node:assert/strict";
import { test } from "node:test";
import { aiAllowed, appPath, cleanAppSettings, cleanDestination, destinationLabel, destinationPath, keepReachable, type Reach } from "../shared/apps.ts";

const reach: Reach = {
  boards: [
    { id: "main", name: "Overzicht" },
    { id: "k1", name: "Keuken" },
  ],
  projects: new Map([
    ["p1", { name: "Pelletkachel", lists: new Map([["b", { name: "Bijvulling", plural: "Bijvullen", create: true }], ["o", { name: "Onderhoud", plural: "Onderhoud", create: false }]]) }],
  ]),
};

test("bestemmingen: nagekeken, als pad en met een naam", () => {
  assert.equal(cleanDestination({ kind: "board", board: "../x" }), null);
  assert.equal(cleanDestination({ kind: "raar" }), null);
  assert.deepEqual(cleanDestination({ kind: "form", project: "p1", list: "b", text: "  3 zakken  pellets " }), { kind: "form", project: "p1", list: "b", text: "3 zakken pellets" });
  assert.equal(destinationPath({ kind: "board", board: "k1" }), "/?bord=k1");
  assert.equal(destinationPath({ kind: "list", project: "p1", list: "b" }), "/projecten/p1?lijst=b");
  assert.equal(destinationPath({ kind: "form", project: "p1", list: "b", text: "3 zakken" }), "/projecten/p1/nieuw?lijst=b&tekst=3%20zakken");
  assert.equal(destinationLabel({ kind: "board", board: "k1" }, reach), "Keuken");
  assert.equal(destinationLabel({ kind: "list", project: "p1", list: "b" }, reach), "Bijvullen");
  assert.equal(destinationLabel({ kind: "form", project: "p1", list: "b" }, reach), "Bijvulling toevoegen");
  assert.equal(appPath("a1"), "/app/a1");
});

test("app-instellingen: nagekeken, met nieuwe ids, en wat je niet meer bereikt valt weg", () => {
  let n = 0;
  const s = cleanAppSettings(
    {
      apps: [
        { id: "a1", name: " Pellets ", to: { kind: "form", project: "p1", list: "b" } },
        { id: "a1", name: "Dubbel", to: { kind: "agenda" } },
        { name: "Geen bestemming" },
        { name: "Onderhoud", to: { kind: "form", project: "p1", list: "o" } },
        { name: "Weg", to: { kind: "project", project: "p9" } },
      ],
      shortcuts: [{ name: "Keuken", to: { kind: "board", board: "k1" } }, { name: "x", to: { kind: "raar" } }],
      share: { kind: "receipt", project: "p1", list: "b" },
    },
    () => `n${++n}`,
  );
  assert.deepEqual(s.apps.map((a) => [a.id, a.name]), [["a1", "Pellets"], ["n1", "Dubbel"], ["n2", "Onderhoud"], ["n3", "Weg"]]);
  assert.deepEqual(s.shortcuts, [{ name: "Keuken", to: { kind: "board", board: "k1" } }]);
  const kept = keepReachable(s, reach);
  // Onderhoud: geen recht om toe te voegen; Weg: geen project meer.
  assert.deepEqual(kept.apps.map((a) => a.name), ["Pellets", "Dubbel"]);
  assert.deepEqual(kept.share, { kind: "receipt", project: "p1", list: "b" });
  assert.deepEqual(keepReachable({ ...s, share: { kind: "receipt", project: "p1", list: "o" } }, reach).share, { kind: "ask" });
  assert.deepEqual(cleanAppSettings(null), { apps: [], shortcuts: null, share: { kind: "ask" }, ai: true, muted: [] });
  assert.deepEqual(cleanAppSettings({ muted: ["p1", "p1", "../x", 3] }).muted, ["p1"]);
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
