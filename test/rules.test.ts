import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDef } from "../shared/fields.ts";
import { applyRuleDefaults, balances, cleanRules, defaultShares, movementOf, settleUp, splitCents, type SplitRule } from "../shared/rules.ts";
import { PROJECT_TEMPLATES, typeTemplate, type TypeTemplate } from "../shared/templates.ts";

const fields: FieldDef[] = [
  { key: "bedrag", label: "Bedrag", type: "money" },
  { key: "door", label: "Betaald door", type: "person" },
  { key: "voor", label: "Verdeling", type: "share" },
  { key: "aan", label: "Aan", type: "person" },
  { key: "datum", label: "Datum", type: "date" },
];
const split: SplitRule = { kind: "split", amount: "bedrag", payer: "door", for: "voor" };

test("regels nakijken tegen de velden", () => {
  assert.deepEqual(cleanRules(undefined, fields), []);
  assert.deepEqual(cleanRules([split], fields), [split]);
  assert.deepEqual(cleanRules([{ kind: "settle", amount: "bedrag", from: "door", to: "aan" }], fields), [
    { kind: "settle", amount: "bedrag", from: "door", to: "aan" },
  ]);
  assert.throws(() => cleanRules([{ ...split, amount: "datum" }], fields), /Bedrag/);
  assert.throws(() => cleanRules([{ ...split, payer: "weg" }], fields), /Betaald door/);
  assert.throws(() => cleanRules([{ kind: "settle", amount: "bedrag", from: "door", to: "door" }], fields), /verschillende/);
  assert.throws(() => cleanRules([split, split], fields), /één regel/);
  assert.throws(() => cleanRules([{ kind: "stock" }], fields), /Onbekende/);
  // Een standaardverdeling wordt procenten die samen 100 zijn.
  assert.deepEqual(
    cleanRules(
      [
        {
          ...split,
          default: [
            { person_id: "a", share: 3 },
            { person_id: "b", share: 2 },
          ],
        },
      ],
      fields,
    )[0],
    {
      ...split,
      default: [
        { person_id: "a", share: 60 },
        { person_id: "b", share: 40 },
      ],
    },
  );
});

test("sjablonen: regels passen bij hun velden", () => {
  for (const template of Object.values(PROJECT_TEMPLATES)) {
    for (const t of template.types as readonly TypeTemplate[]) {
      if (!t.rules) continue;
      const defs = t.fields.map(({ ref: _ref, ...f }) => f as FieldDef);
      assert.deepEqual(cleanRules(t.rules, defs), t.rules, `${t.name}`);
    }
  }
  assert.equal(typeTemplate("terugbetaling")?.plural, "Terugbetalingen");
  assert.equal(typeTemplate("bestaat-niet"), undefined);
});

test("een bedrag verdelen tot op de cent", () => {
  const equal = [
    { person_id: "a", share: 33.33 },
    { person_id: "b", share: 33.33 },
    { person_id: "c", share: 33.34 },
  ];
  const sum = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
  // € 10,00 over drie: wie betaalde, draagt de cent die overschiet.
  const ten = splitCents(1000, equal, "a");
  assert.equal(sum(ten), 1000);
  assert.deepEqual(Object.fromEntries(ten), { a: 334, b: 333, c: 333 });
  assert.equal(sum(splitCents(1001, equal, "b")), 1001);
  assert.deepEqual(
    Object.fromEntries(
      splitCents(1000, [
        { person_id: "a", share: 60 },
        { person_id: "b", share: 40 },
      ]),
    ),
    { a: 600, b: 400 },
  );
  // Een terugbetaling of korting (negatief) verdeelt net zo.
  assert.deepEqual(Object.fromEntries(splitCents(-1000, equal, "a")), { a: -334, b: -333, c: -333 });
  assert.equal(splitCents(1000, []).size, 0);
});

test("wie moet wie", () => {
  const half = [
    { person_id: "jaan", share: 50 },
    { person_id: "jana", share: 50 },
  ];
  // Jaan betaalt € 100 voor twee, Jana € 30 voor twee: Jana moet Jaan € 35.
  const net = balances([
    { amount: 10000, payer: "jaan", shares: half },
    { amount: 3000, payer: "jana", shares: half },
  ]);
  assert.deepEqual(Object.fromEntries(net), { jaan: 3500, jana: -3500 });
  assert.deepEqual(settleUp(net), [{ from: "jana", to: "jaan", amount: 3500 }]);
  // Jana betaalt € 35 terug: alles verrekend.
  const settle = movementOf({ kind: "settle", amount: "bedrag", from: "van", to: "aan" }, { bedrag: 3500, van: "jana", aan: "jaan" })!;
  const after = balances([{ amount: 10000, payer: "jaan", shares: half }, { amount: 3000, payer: "jana", shares: half }, settle]);
  assert.deepEqual(settleUp(after), []);
  assert.ok([...after.values()].every((v) => v === 0));
  // Met drie: zo weinig mogelijk overschrijvingen, en samen altijd 0.
  const three = balances([
    {
      amount: 9000,
      payer: "a",
      shares: [
        { person_id: "a", share: 1 },
        { person_id: "b", share: 1 },
        { person_id: "c", share: 1 },
      ],
    },
    { amount: 3000, payer: "b", shares: [{ person_id: "c", share: 100 }] },
  ]);
  assert.equal(
    [...three.values()].reduce((s, v) => s + v, 0),
    0,
  );
  assert.deepEqual(settleUp(three), [{ from: "c", to: "a", amount: 6000 }]);
});

test("een item telt enkel mee als alles ingevuld is", () => {
  assert.equal(movementOf(split, { bedrag: 500, door: "a" }), null);
  assert.equal(movementOf(split, { door: "a", voor: [{ person_id: "a", share: 100 }] }), null);
  assert.equal(movementOf(split, { bedrag: 0, door: "a", voor: [{ person_id: "a", share: 100 }] }), null);
  assert.equal(movementOf({ kind: "settle", amount: "bedrag", from: "van", to: "aan" }, { bedrag: 5, van: "a", aan: "a" }), null);
  assert.deepEqual(movementOf(split, { bedrag: 500, door: "a", voor: [{ person_id: "b", share: 100 }] }), {
    amount: 500,
    payer: "a",
    shares: [{ person_id: "b", share: 100 }],
  });
});

test("wat een regel invult als het leeg is", () => {
  const members = ["jaan", "jana"];
  // Nieuw: jij betaalde, gelijk verdeeld.
  assert.deepEqual(applyRuleDefaults([split], { bedrag: 1000 }, members, "jaan", true), {
    bedrag: 1000,
    door: "jaan",
    voor: [
      { person_id: "jaan", share: 50 },
      { person_id: "jana", share: 50 },
    ],
  });
  // Bewerken: wie betaalde blijft leeg als je het leegmaakt; wat ingevuld is, blijft.
  assert.equal(applyRuleDefaults([split], { bedrag: 1000 }, members, "jaan", false).door, undefined);
  assert.equal(applyRuleDefaults([split], { door: "jana" }, members, "jaan", true).door, "jana");
  // Wie niet in het project zit, betaalt niet vanzelf.
  assert.equal(applyRuleDefaults([split], {}, members, "gast", true).door, undefined);
  // De standaard van de regel, zonder wie het project verliet.
  const sixty: SplitRule = {
    ...split,
    default: [
      { person_id: "jaan", share: 60 },
      { person_id: "jana", share: 40 },
    ],
  };
  assert.deepEqual(defaultShares(sixty, members), sixty.default);
  assert.deepEqual(defaultShares(sixty, ["jana", "tim"]), [{ person_id: "jana", share: 100 }]);
  assert.deepEqual(defaultShares(split, []), []);
});
