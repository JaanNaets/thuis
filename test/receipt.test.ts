import assert from "node:assert/strict";
import { test } from "node:test";
import { findDates, isComplete, normalizeGuess, parseAmount, parseReceiptText } from "../shared/receipt.ts";

const TODAY = new Date("2026-10-20T12:00:00Z");

test("bedragen in Belgische en Engelse notatie", () => {
  assert.equal(parseAmount("649,00"), 64900);
  assert.equal(parseAmount("1.234,56"), 123456);
  assert.equal(parseAmount("1 234,56"), 123456);
  assert.equal(parseAmount("€ 12.50"), 1250);
  assert.equal(parseAmount("-1,20"), -120);
  assert.equal(parseAmount("abc"), null);
});

test("datums: dag/maand/jaar, ISO en maandnamen", () => {
  assert.deepEqual(findDates("19/10/2026 14:32", TODAY), ["2026-10-19"]);
  assert.deepEqual(findDates("12.10.26", TODAY), ["2026-10-12"]);
  assert.deepEqual(findDates("2026-10-12", TODAY), ["2026-10-12"]);
  assert.deepEqual(findDates("12 okt. 2026", TODAY), ["2026-10-12"]);
  assert.deepEqual(findDates("1 oktober 2026", TODAY), ["2026-10-01"]);
  // Onmogelijke of toekomstige datums tellen niet mee.
  assert.deepEqual(findDates("31/02/2026 en 01/01/2031", TODAY), []);
});

test("Colruyt-kasticket (zoals OCR het leest)", () => {
  const text = `COLRUYT LAAGSTE PRIJZEN
Halle - Ninoofsesteenweg
BANANEN                 1,99
MELK HALFVOL 1L         0,95
Subtotaal              23,47
Korting Xtra           -1,20
Totaal                 22,27
Bancontact             22,27
BTW 6%      21,01      1,26
19/10/2026  14:32  Kassa 3`;
  const g = parseReceiptText(text, TODAY);
  assert.equal(g.store, "Colruyt");
  assert.equal(g.amount_cents, 2227);
  assert.equal(g.purchased_on, "2026-10-19");
  assert.equal(g.category, "Boodschappen");
  assert.equal(g.description, "Boodschappen Colruyt");
  assert.ok(isComplete(g));
});

test("Coolblue-factuur (tekst uit PDF): factuurdatum, niet de vervaldatum", () => {
  const text = `Coolblue België NV
Factuur
Factuurnummer 2026-10-0042
Vervaldatum 15 oktober 2026
Factuurdatum 1 oktober 2026
Bosch Serie 6 WGG244A9NL 1 € 649,00
Totaal excl. btw € 536,36
Btw 21% € 112,64
Totaal incl. btw € 649,00`;
  const g = parseReceiptText(text, TODAY);
  assert.equal(g.store, "Coolblue");
  assert.equal(g.purchased_on, "2026-10-01");
  assert.equal(g.amount_cents, 64900);
  assert.equal(g.category, "Elektronica");
});

test("'Te betalen' wint van 'Totaal' als er nog korting af gaat", () => {
  const text = `DELHAIZE
TOTAAL 56,10
Korting -2,00
TE BETALEN 54,10
12-10-2026`;
  assert.equal(parseReceiptText(text, TODAY).amount_cents, 5410);
});

test("bedrag op de volgende regel (gebeurt in PDF's)", () => {
  assert.equal(parseReceiptText("Totaal te betalen\n€ 1.299,00\n01/09/2026", TODAY).amount_cents, 129900);
});

test("onvolledig ticket: dan is de AI aan de beurt", () => {
  const g = parseReceiptText("Bakkerij Peeters\nBrood 3,20", TODAY);
  assert.equal(g.amount_cents, null);
  assert.ok(!isComplete(g));
});

test("AI-antwoord wordt nagekeken en genormaliseerd", () => {
  const g = normalizeGuess({ store: "MEDIA MARKT GENT", date: "2026-10-12", total: 379.99, category: "Elektronica", description: "Koptelefoon Sony" }, TODAY);
  assert.deepEqual(g, {
    store: "MediaMarkt",
    purchased_on: "2026-10-12",
    amount_cents: 37999,
    description: "Koptelefoon Sony",
    category: "Elektronica",
  });

  const bad = normalizeGuess({ store: "  ", date: "2031-01-01", total: -5, category: "Snoep" }, TODAY);
  assert.deepEqual(bad, { store: null, purchased_on: null, amount_cents: null, description: null, category: null });

  assert.equal(normalizeGuess({ store: "BAKKERIJ PEETERS", total: "12,40" }, TODAY).store, "Bakkerij Peeters");
  assert.equal(normalizeGuess({ total: "12,40" }, TODAY).amount_cents, 1240);
  assert.equal(normalizeGuess("geen json", TODAY).store, null);
});

test("lijnen van een kasticket, tot aan het totaal", async () => {
  const { parseReceiptLines } = await import("../shared/receipt.ts");
  const text = `COLRUYT HALLE
Edingensesteenweg 196
Halfvolle melk 1L        1,09 A
2 x Bananen              2,38
Bier Jupiler 24x25cl    17,49 C
Korting Jupiler         -2,00
SUBTOTAAL               18,96
Bancontact              18,96
BTW 6%                   0,20`;
  assert.deepEqual(parseReceiptLines(text), [
    { description: "Halfvolle melk 1L", amount_cents: 109 },
    { description: "Bananen", amount_cents: 238 },
    { description: "Bier Jupiler 24x25cl", amount_cents: 1749 },
    { description: "Korting Jupiler", amount_cents: -200 },
  ]);
});
