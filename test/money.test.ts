import assert from "node:assert/strict";
import { test } from "node:test";
import { fromEcbXml, parseForeign, toEuroCents } from "../shared/money.ts";

test("een bedrag in een vreemde munt lezen", () => {
  assert.deepEqual(parseForeign("45 USD"), { amount: 45, currency: "USD" });
  assert.deepEqual(parseForeign("usd 45,50"), { amount: 45.5, currency: "USD" });
  assert.deepEqual(parseForeign("$45.50"), { amount: 45.5, currency: "USD" });
  assert.deepEqual(parseForeign("£ 1.234,56"), { amount: 1234.56, currency: "GBP" });
  assert.deepEqual(parseForeign("1,234.56 chf"), { amount: 1234.56, currency: "CHF" });
  assert.deepEqual(parseForeign("2.500 CZK"), { amount: 2500, currency: "CZK" });
  // Gewoon een bedrag in euro (zonder munt), of iets anders: geen vreemde munt.
  assert.equal(parseForeign("45"), null);
  assert.equal(parseForeign("12,50"), null);
  assert.equal(parseForeign("USD"), null);
  assert.equal(parseForeign("$ 4 USD"), null);
  assert.equal(parseForeign("0 USD"), null);
});

test("omrekenen met de koersen van de ECB", () => {
  const rates = fromEcbXml(`<Cube><Cube time='2026-10-30'><Cube currency='USD' rate='1.1172'/><Cube currency='GBP' rate='0.83380'/></Cube></Cube>`)!;
  assert.deepEqual(rates, { date: "2026-10-30", rates: { USD: 1.1172, GBP: 0.8338 } });
  assert.equal(toEuroCents(45, "USD", rates), 4028);
  assert.equal(toEuroCents(10, "GBP", rates), 1199);
  assert.equal(toEuroCents(10, "EUR", rates), 1000);
  assert.equal(toEuroCents(10, "XYZ", rates), null);
  assert.equal(fromEcbXml("<niets/>"), null);
});
