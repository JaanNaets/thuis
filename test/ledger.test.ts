import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSharers, isExpense, mineOf, type MoneyEvent, netBalance, settleUp, sharesOf, splitCents } from "../shared/ledger.ts";

const ev = (o: Partial<MoneyEvent>): MoneyEvent => ({
  id: "e",
  base: "aankoop",
  status: "gebeurd",
  amount: null,
  paid_by: null,
  split: null,
  to_person: null,
  created_by: "jaan",
  lines: [],
  ...o,
});
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
  assert.equal(mineOf(ticket, "jana"), 2090);
  // Zonder verdeling is alles van wie betaalde, en anders van wie het logde.
  assert.equal(mineOf(ev({ amount: 1000, paid_by: "jana" }), "jana"), 1000);
  assert.equal(mineOf(ev({ amount: 1000 }), "jaan"), 1000);
  // Gepland of een overdracht is geen uitgave.
  assert.ok(!isExpense(ev({ amount: 1000, status: "gepland" })));
  assert.ok(!isExpense(ev({ amount: 1000, base: "overdracht" })));
});

test("wie moet wie: uitgaven en een terugbetaling", () => {
  const events = [
    ev({ id: "1", amount: 4600, paid_by: "jaan", split: half }),
    ev({ id: "2", amount: 2000, paid_by: "jana", split: half }),
    // Iets van Jaan alleen telt niet mee.
    ev({ id: "3", amount: 9900, paid_by: "jaan" }),
  ];
  const net = netBalance(events);
  assert.deepEqual([...net], [
    ["jaan", 1300],
    ["jana", -1300],
  ]);
  assert.deepEqual(settleUp(net), [{ from: "jana", to: "jaan", amount: 1300 }]);
  // Jana betaalt terug: alles in orde.
  const after = netBalance([...events, ev({ id: "4", base: "overdracht", amount: 1300, paid_by: "jana", to_person: "jaan" })]);
  assert.equal(after.size, 0);
});

test("standaard delen: een uitgave in een gedeelde lijst gelijk over wie logt, zoals Splitwise", () => {
  const samen = [
    { id: "jaan", role: "beheerder" as const },
    { id: "jana", role: "beheerder" as const },
    { id: "kijker", role: "gast" as const },
  ];
  assert.deepEqual(defaultSharers("aankoop", samen), ["jaan", "jana"]);
  assert.deepEqual(defaultSharers("dienst", samen), ["jaan", "jana"]);
  assert.deepEqual(defaultSharers("gebruik", samen), [], "eten: wie at kies je zelf");
  assert.deepEqual(defaultSharers("overdracht", samen), []);
  assert.deepEqual(defaultSharers("aankoop", [{ id: "jaan", role: "beheerder" }]), [], "alleen: van wie betaalde");
});
