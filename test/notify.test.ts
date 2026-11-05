import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanNotify, isMuted, notifyMessage, notifyTargets } from "../shared/notify.ts";
import type { FieldDef } from "../shared/fields.ts";

const fields: FieldDef[] = [
  { key: "bedrag", label: "Bedrag", type: "money" },
  { key: "betaald_door", label: "Betaald door", type: "person" },
  { key: "verdeling", label: "Verdeling", type: "share" },
];

test("melding bij een nieuw item: aan iedereen of aan wie in een veld met mensen staat", () => {
  assert.deepEqual(cleanNotify({ to: "all" }, fields), { to: "all" });
  assert.deepEqual(cleanNotify({ to: "field", field: "verdeling" }, fields), { to: "field", field: "verdeling" });
  assert.equal(cleanNotify({ to: "field", field: "bedrag" }, fields), null, "een bedrag heeft geen mensen");
  assert.equal(cleanNotify({ to: "field", field: "weg" }, fields), null);
  assert.equal(cleanNotify({ to: "iedereen" }), null);
  assert.equal(cleanNotify(null), null);
});

test("wie erin staat: een persoon, personen of een verdeling", () => {
  assert.deepEqual(notifyTargets({ to: "field", field: "betaald_door" }, { betaald_door: "p1" }), ["p1"]);
  assert.deepEqual(
    notifyTargets({ to: "field", field: "verdeling" }, { verdeling: [{ person_id: "p1", share: 50 }, { person_id: "p2", share: 50 }] }),
    ["p1", "p2"],
  );
  assert.deepEqual(notifyTargets({ to: "field", field: "verdeling" }, {}), []);
  assert.equal(notifyTargets({ to: "all" }, {}), "all");
  assert.equal(isMuted(["boven"], ["hier", "boven"]), true, "stil boven = ook stil in een subproject");
  assert.equal(isMuted(["ander"], ["hier", "boven"]), false);
});

test("de tekst: één item, of meer kort na elkaar", () => {
  assert.deepEqual(notifyMessage({ author: "Jana", name: "Uitgave", plural: "Uitgaven", itemName: "Pizza", count: 1, detail: "€ 40,00" }), {
    title: "Jana voegde uitgave toe",
    body: "Pizza · € 40,00",
  });
  assert.equal(notifyMessage({ author: "Jana", name: "Uitgave", plural: "Uitgaven", itemName: "Pizza", count: 3 }).title, "Jana voegde 3 uitgaven toe");
});
