import assert from "node:assert/strict";
import { test } from "node:test";
import { aliasesOf, cents, matchCandidate, matchName, niceName, readLines, validDate, withAlias, type Candidate } from "../shared/receipt.ts";

const aardappelen: Candidate = { id: "a", name: "Aardappelen", aliases: [], measure: { unit: "kg", pack: 5, pack_name: "zak" } };
const melk: Candidate = { id: "m", name: "Melk halfvol", aliases: ["BOERENMELK HV 1L"], measure: { unit: "l" } };
const yoghurt: Candidate = { id: "y", name: "Yoghurt", aliases: [], measure: { unit: "stuk", piece: 125 } };
const koffie: Candidate = { id: "k", name: "Koffiebonen", aliases: [], measure: null };

test("op naam koppelen: dezelfde, de langste erin, of waar ze in staat", () => {
  const c = [aardappelen, melk, yoghurt];
  assert.equal(matchName(c, "AARDAPPELEN 5KG"), "a");
  assert.equal(matchName(c, "Griekse yoghurt nature"), "y");
  assert.equal(matchName(c, "melk"), "m");
  assert.equal(matchName(c, "brood"), null);
  // Een naam van een ticket wint.
  assert.equal(matchCandidate(c, "boerenmelk hv 1l")?.id, "m");
});

test("lijnen in de eenheid van het ding", () => {
  const lines = readLines(
    [
      { name: "AARDAPPELEN 5KG", quantity: 1, size: "5 kg", price: 4.99 },
      { name: "AARDAPPELEN", quantity: 2, size: "", price: 9.98 },
      { name: "BOERENMELK HV 1L", quantity: 2, size: "1 l", price: 2.04 },
      { name: "YOGHURT 4X125G", quantity: 1, size: "4x125 g", price: 1.99 },
      { name: "COLA 6X33CL", quantity: 1, size: "6x33 cl", price: 5.49 },
      { name: "KOFFIEBONEN", quantity: 1, size: "", price: 16.49 },
      { name: "", quantity: 1, size: "", price: 1 },
    ],
    [aardappelen, melk, yoghurt, koffie],
  );
  assert.deepEqual(
    lines.map((l) => [l.thing, l.amount, l.unit, l.price]),
    [
      ["a", 5, "kg", 499],
      ["a", 10, "kg", 998],
      ["m", 2, "l", 204],
      ["y", 4, "stuk", 199],
      [null, 1.98, "l", 549],
      ["k", 1, null, 1649],
    ],
  );
});

test("namen van tickets onthouden", () => {
  assert.deepEqual(aliasesOf("A | B;C"), ["A", "B", "C"]);
  assert.equal(withAlias("A", "B"), "A | B");
  assert.equal(withAlias("A | b", "B"), null);
  assert.equal(withAlias(undefined, "X"), "X");
});

test("bedragen, datums en namen", () => {
  assert.equal(cents(4.99), 499);
  assert.equal(cents(-1), null);
  assert.equal(validDate("2026-11-05", "2026-11-06"), "2026-11-05");
  assert.equal(validDate("2026-11-07", "2026-11-06"), null);
  assert.equal(niceName("COLA 6X33CL"), "Cola");
  assert.equal(niceName("Griekse yoghurt"), "Griekse yoghurt");
});
