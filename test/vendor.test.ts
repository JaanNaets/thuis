import assert from "node:assert/strict";
import { test } from "node:test";
import {
  displayWebsite,
  formatCompanyNumber,
  formatIban,
  isValidCompanyNumber,
  isValidIban,
  normalizeCompanyNumber,
  normalizeIban,
  normalizeWebsite,
} from "../shared/vendor.ts";

test("IBAN: spaties en kleine letters maken niet uit, de controle wel", () => {
  assert.equal(normalizeIban("be68 5390 0754 7034"), "BE68539007547034");
  assert.equal(isValidIban("BE68 5390 0754 7034"), true);
  assert.equal(isValidIban("NL91ABNA0417164300"), true);
  // Eén cijfer fout: de mod-97-test valt om.
  assert.equal(isValidIban("BE68 5390 0754 7035"), false);
  // Belgisch IBAN met een cijfer te weinig.
  assert.equal(isValidIban("BE68 5390 0754 703"), false);
  assert.equal(isValidIban("geen iban"), false);
  assert.equal(formatIban("be68539007547034"), "BE68 5390 0754 7034");
});

test("ondernemingsnummer: met of zonder BE, punten en voorloopnul", () => {
  assert.equal(normalizeCompanyNumber("BE 0403.170.701"), "0403170701");
  assert.equal(normalizeCompanyNumber("403170701"), "0403170701");
  assert.equal(isValidCompanyNumber("BE0403.170.701"), true);
  assert.equal(isValidCompanyNumber("0417 497 106"), true);
  assert.equal(isValidCompanyNumber("0403.170.702"), false);
  // Begint met een 2: bestaat niet.
  assert.equal(isValidCompanyNumber("2403170701"), false);
  // Buitenlands: enkel de vorm.
  assert.equal(isValidCompanyNumber("NL123456789B01"), true);
  assert.equal(formatCompanyNumber("0403170701"), "0403.170.701");
  assert.equal(formatCompanyNumber("nl 123456789b01"), "NL123456789B01");
});

test("website: https erbij en netjes tonen", () => {
  assert.equal(normalizeWebsite("coolblue.be"), "https://coolblue.be");
  assert.equal(normalizeWebsite("http://hubo.be"), "http://hubo.be");
  assert.equal(normalizeWebsite("  "), "");
  assert.equal(displayWebsite("https://www.coolblue.be/nl/"), "coolblue.be/nl");
});
