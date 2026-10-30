import assert from "node:assert/strict";
import { test } from "node:test";
import { epcPayload, formatIban, isValidIban, normalizeIban } from "../shared/payment.ts";

test("een IBAN nakijken en tonen", () => {
  assert.ok(isValidIban("BE68 5390 0754 7034"));
  assert.ok(isValidIban("be68539007547034"));
  assert.ok(isValidIban("NL91 ABNA 0417 1643 00"));
  assert.ok(!isValidIban("BE68 5390 0754 7035"));
  assert.ok(!isValidIban("1234"));
  assert.equal(normalizeIban(" be68-5390 0754 7034 "), "BE68539007547034");
  assert.equal(formatIban("BE68539007547034"), "BE68 5390 0754 7034");
});

test("een betaal-QR (EPC)", () => {
  assert.equal(
    epcPayload({ name: "Jaan Naets", iban: "BE68 5390 0754 7034" }, 3500, "Thuis: terugbetaling Skireis"),
    "BCD\n002\n1\nSCT\n\nJaan Naets\nBE68539007547034\nEUR35.00\n\n\nThuis: terugbetaling Skireis",
  );
  assert.equal(epcPayload({ name: "X", iban: "BE68 5390 0754 7035" }, 100, ""), null);
  assert.equal(epcPayload({ name: "X", iban: "BE68539007547034" }, 0, ""), null);
  assert.equal(epcPayload({ name: "X", iban: "BE68539007547034" }, 12.5, ""), null);
  // Geen regeleinden in naam of mededeling (die zouden de velden verschuiven).
  assert.ok(epcPayload({ name: "A\nB", iban: "BE68539007547034" }, 100, "x\ny")!.includes("\nA B\n"));
});
