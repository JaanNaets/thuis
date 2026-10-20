import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryFromTags, suggestionFromOff } from "../shared/products.ts";
import { checkCustomShares, computeBalances, splitEqual, suggestTransfers } from "../shared/split.ts";
import { expiresSoon, isLow, pickConsumeLocation, roundQuantity, summarizeLevels } from "../shared/stock.ts";
import { descendantIds, flattenTree, rootOf } from "../shared/tree.ts";

test("gelijk verdelen: de restcent draagt wie betaalde", () => {
  assert.deepEqual(splitEqual(1001, ["a", "b"], "a"), [
    { member_id: "a", share_cents: 501 },
    { member_id: "b", share_cents: 500 },
  ]);
  assert.deepEqual(splitEqual(1000, ["a", "b", "c"], "b"), [
    { member_id: "a", share_cents: 333 },
    { member_id: "b", share_cents: 334 },
    { member_id: "c", share_cents: 333 },
  ]);
  // Wie betaalde maar niet (meer) actief is, deelt toch mee.
  assert.equal(splitEqual(900, ["a", "b"], "x").length, 3);
});

test("zelf verdelen: moet precies kloppen", () => {
  assert.equal(checkCustomShares(1000, [{ member_id: "a", share_cents: 700 }, { member_id: "b", share_cents: 300 }]), null);
  assert.match(checkCustomShares(1000, [{ member_id: "a", share_cents: 700 }])!, /niet gelijk/);
  assert.match(
    checkCustomShares(1000, [{ member_id: "a", share_cents: 500 }, { member_id: "a", share_cents: 500 }])!,
    /twee keer/,
  );
  assert.match(checkCustomShares(0, [{ member_id: "a", share_cents: -1 }, { member_id: "b", share_cents: 1 }])!, /positief/);
});

test("saldo's: aankopen en terugbetalingen", () => {
  // Jaan betaalde 100 euro gelijk verdeeld, Sam 30 euro gelijk verdeeld.
  const balances = computeBalances(
    ["jaan", "sam"],
    [
      { payer: "jaan", member: "jaan", cents: 5000 },
      { payer: "jaan", member: "sam", cents: 5000 },
      { payer: "sam", member: "sam", cents: 1500 },
      { payer: "sam", member: "jaan", cents: 1500 },
    ],
    [],
  );
  assert.equal(balances.get("jaan"), 3500);
  assert.equal(balances.get("sam"), -3500);
  assert.deepEqual(suggestTransfers(balances), [{ from: "sam", to: "jaan", amount_cents: 3500 }]);

  // Sam stort 35 euro terug: iedereen staat op nul.
  const after = computeBalances(
    ["jaan", "sam"],
    [
      { payer: "jaan", member: "sam", cents: 5000 },
      { payer: "sam", member: "jaan", cents: 1500 },
    ],
    [{ from: "sam", to: "jaan", cents: 3500 }],
  );
  assert.equal(after.get("jaan"), 0);
  assert.equal(after.get("sam"), 0);
  assert.deepEqual(suggestTransfers(after), []);
});

test("overschrijvingen met drie personen", () => {
  const balances = new Map([
    ["a", 6000],
    ["b", -4000],
    ["c", -2000],
  ]);
  assert.deepEqual(suggestTransfers(balances), [
    { from: "b", to: "a", amount_cents: 4000 },
    { from: "c", to: "a", amount_cents: 2000 },
  ]);
});

const LOCATIONS = [
  { id: "berging", parent_id: null, name: "Berging", sort_order: 30 },
  { id: "keuken", parent_id: null, name: "Keuken", sort_order: 10 },
  { id: "diepvries", parent_id: "keuken", name: "Diepvries", sort_order: 20 },
  { id: "koelkast", parent_id: "keuken", name: "Koelkast", sort_order: 10 },
  { id: "lade", parent_id: "koelkast", name: "Groentelade", sort_order: 0 },
];

test("bomen: volgorde, diepte en pad", () => {
  const flat = flattenTree(LOCATIONS);
  assert.deepEqual(
    flat.map((n) => [n.path, n.depth]),
    [
      ["Keuken", 0],
      ["Keuken › Koelkast", 1],
      ["Keuken › Koelkast › Groentelade", 2],
      ["Keuken › Diepvries", 1],
      ["Berging", 0],
    ],
  );
  assert.deepEqual([...descendantIds(LOCATIONS, "keuken")].sort(), ["diepvries", "keuken", "koelkast", "lade"]);
  assert.equal(rootOf(LOCATIONS, "lade")?.id, "keuken");

  // Een lus mag niets laten vastlopen.
  const loop = [
    { id: "a", parent_id: "b", name: "A", sort_order: 0 },
    { id: "b", parent_id: "a", name: "B", sort_order: 0 },
  ];
  assert.equal(flattenTree(loop).length, 0);
  assert.equal(rootOf(loop, "a")?.id !== undefined, true);
});

test("voorraad: waar nemen we iets weg", () => {
  const levels = [
    { location_id: "koelkast", quantity: 2, next_expiry: "2026-11-01" },
    { location_id: "diepvries", quantity: 5, next_expiry: null },
    { location_id: "kelder", quantity: 1, next_expiry: "2026-10-25" },
    { location_id: "leeg", quantity: 0, next_expiry: "2026-10-01" },
  ];
  assert.equal(pickConsumeLocation(levels, "diepvries")?.location_id, "kelder");
  const noExpiry = levels.map((l) => ({ ...l, next_expiry: null }));
  assert.equal(pickConsumeLocation(noExpiry, "koelkast")?.location_id, "koelkast");
  assert.equal(pickConsumeLocation(noExpiry, null)?.location_id, "diepvries");
  assert.equal(pickConsumeLocation([], null), undefined);

  assert.deepEqual(summarizeLevels(levels), { quantity: 8, next_expiry: "2026-10-01" });
  assert.equal(roundQuantity(0.1 + 0.2), 0.3);
  assert.equal(isLow(1, 2), true);
  assert.equal(isLow(2, 2), false);
  assert.equal(isLow(0, null), false);
  assert.equal(expiresSoon("2026-10-26", "2026-10-19"), true);
  assert.equal(expiresSoon("2026-10-27", "2026-10-19"), false);
  assert.equal(expiresSoon("2026-10-01", "2026-10-19"), true);
});

test("Open Food Facts: naam, merk en categorie", () => {
  assert.equal(categoryFromTags(["en:frozen-foods", "en:frozen-vegetables"]), "item-diepvries");
  assert.equal(categoryFromTags(["en:dairies", "en:milks"]), "item-zuivel");
  assert.equal(categoryFromTags(["en:plant-based-foods"]), "item-voeding");
  assert.equal(categoryFromTags([]), null);

  assert.deepEqual(
    suggestionFromOff({
      status: 1,
      product: {
        product_name: "Halfvolle melk",
        product_name_nl: " Halfvolle  melk ",
        brands: "Boni Selection, Colruyt",
        quantity: "1 l",
        categories_tags: ["en:dairies", "en:milks"],
      },
    }),
    { name: "Halfvolle melk", brand: "Boni Selection", quantity_text: "1 l", category_id: "item-zuivel", source: "openfoodfacts" },
  );
  assert.equal(suggestionFromOff({ status: 0 }), null);
  assert.equal(suggestionFromOff({ status: 1, product: {} }), null);
  assert.equal(suggestionFromOff("onzin"), null);
});
