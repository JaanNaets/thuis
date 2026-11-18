import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanLedger, defaultSharers, type Money, settleUp, sharesOf, splitCents } from "../shared/ledger.ts";
import { baseParts } from "../shared/model.ts";

const ev = (o: Partial<Money>): Money => ({ amount: null, paid_by: null, split: null, created_by: "jaan", lines: [], ...o });
const half = [
  { person_id: "jaan", share: 50 },
  { person_id: "jana", share: 50 },
];

test("verdelen tot op de cent", () => {
  assert.deepEqual([...splitCents(1001, half, "jaan")], [
    ["jaan", 501],
    ["jana", 500],
  ]);
  assert.deepEqual([...splitCents(100, [{ person_id: "a", share: 1 }, { person_id: "b", share: 1 }, { person_id: "c", share: 1 }])].map(([, v]) => v).reduce((a, b) => a + b), 100);
});

test("jouw deel: lijnen van jou, en de rest volgens de verdeling", () => {
  const ticket = ev({
    amount: 4631,
    paid_by: "jaan",
    split: half,
    lines: [
      { price: 450, owner: "jaan" },
      { price: 356, owner: null },
    ],
  });
  const shares = sharesOf(ticket);
  assert.equal(shares.get("jaan"), 450 + 2091);
  assert.equal(shares.get("jana"), 2090);
  // Zonder verdeling is alles van wie betaalde, en anders van wie het logde.
  assert.deepEqual([...sharesOf(ev({ amount: 1000, paid_by: "jana" }))], [["jana", 1000]]);
  assert.deepEqual([...sharesOf(ev({ amount: 1000 }))], [["jaan", 1000]]);
});

test("wie moet wie: zo weinig mogelijk overschrijvingen", () => {
  assert.deepEqual(settleUp(new Map([["jaan", 1300], ["jana", -1300]])), [{ from: "jana", to: "jaan", amount: 1300 }]);
  assert.deepEqual(settleUp(new Map([["a", 500], ["b", -300], ["c", -200]])), [
    { from: "b", to: "a", amount: 300 },
    { from: "c", to: "a", amount: 200 },
  ]);
});

test("een saldo per persoon: een persoonveld en een bedrag", () => {
  const fields = [
    { key: "persoon", type: "person" as const },
    { key: "saldo", type: "money" as const },
    { key: "naam", type: "text" as const },
  ];
  assert.deepEqual(cleanLedger({ person: "persoon", field: "saldo" }, fields), { person: "persoon", field: "saldo" });
  assert.equal(cleanLedger({ person: "naam", field: "saldo" }, fields), null);
  assert.equal(cleanLedger(null, fields), null);
});

test("standaard delen: een uitgave in een gedeelde lijst gelijk over wie logt, zoals Splitwise", () => {
  const samen = [
    { id: "jaan", role: "beheerder" as const },
    { id: "jana", role: "beheerder" as const },
    { id: "kijker", role: "gast" as const },
  ];
  assert.deepEqual(defaultSharers(baseParts("aankoop"), samen), ["jaan", "jana"]);
  assert.deepEqual(defaultSharers(baseParts("dienst"), samen), ["jaan", "jana"]);
  assert.deepEqual(defaultSharers(baseParts("gebruik"), samen), [], "eten: wie at kies je zelf");
  assert.deepEqual(defaultSharers(baseParts("overdracht"), samen), []);
  assert.deepEqual(defaultSharers(baseParts("aankoop"), [{ id: "jaan", role: "beheerder" }]), [], "alleen: van wie betaalde");
});
