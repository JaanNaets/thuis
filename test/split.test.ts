import assert from "node:assert/strict";
import { test } from "node:test";
import { allocate, checkPayments, computeLedger, computeShares, splitFromDefault, suggestTransfers } from "../shared/split.ts";

const shares = (r: ReturnType<typeof computeShares>) => {
  if ("error" in r) throw new Error(r.error);
  return Object.fromEntries(r.shares.map((s) => [s.member_id, s.share_cents]));
};

test("verdelen tot op de cent: de restcent gaat naar wie betaalde", () => {
  assert.deepEqual(
    Object.fromEntries(
      allocate(
        1001,
        [
          { id: "a", weight: 1 },
          { id: "b", weight: 1 },
        ],
        ["b"],
      ),
    ),
    { a: 500, b: 501 },
  );
  assert.deepEqual(
    Object.fromEntries(
      allocate(
        1000,
        [
          { id: "a", weight: 1 },
          { id: "b", weight: 1 },
          { id: "c", weight: 1 },
        ],
        ["c"],
      ),
    ),
    {
      a: 333,
      b: 333,
      c: 334,
    },
  );
  assert.equal(allocate(0, [{ id: "a", weight: 1 }]).get("a"), 0);
});

test("gelijk over een selectie", () => {
  assert.deepEqual(shares(computeShares(9000, { mode: "equal", participants: [{ member_id: "jaan" }, { member_id: "sam" }, { member_id: "lien" }] })), {
    jaan: 3000,
    sam: 3000,
    lien: 3000,
  });
  assert.deepEqual(shares(computeShares(1000, { mode: "equal", participants: [{ member_id: "sam" }] })), { sam: 1000 });
  assert.ok("error" in computeShares(1000, { mode: "equal", participants: [] }));
});

test("percentage: 60/40 naar inkomen, moet samen 100% zijn", () => {
  assert.deepEqual(
    shares(
      computeShares(
        12345,
        {
          mode: "percent",
          participants: [
            { member_id: "jaan", value: 60 },
            { member_id: "sam", value: 40 },
          ],
        },
        ["jaan"],
      ),
    ),
    { jaan: 7407, sam: 4938 },
  );
  const wrong = computeShares(1000, {
    mode: "percent",
    participants: [
      { member_id: "jaan", value: 60 },
      { member_id: "sam", value: 30 },
    ],
  });
  assert.ok("error" in wrong && /90%/.test(wrong.error));
});

test("delen: volwassene 2, kind 1; wie 0 delen heeft, doet niet mee", () => {
  const r = computeShares(10000, {
    mode: "shares",
    participants: [
      { member_id: "jaan", value: 2 },
      { member_id: "sam", value: 2 },
      { member_id: "kind", value: 1 },
      { member_id: "oma", value: 0 },
    ],
  });
  assert.deepEqual(shares(r), { jaan: 4000, sam: 4000, kind: 2000 });
  assert.ok("shares" in r && r.shares.every((s) => s.split_value !== null));
});

test("vaste bedragen: moeten samen het totaal zijn", () => {
  assert.deepEqual(
    shares(
      computeShares(1000, {
        mode: "exact",
        participants: [
          { member_id: "a", value: 700 },
          { member_id: "b", value: 300 },
        ],
      }),
    ),
    {
      a: 700,
      b: 300,
    },
  );
  assert.ok("error" in computeShares(1000, { mode: "exact", participants: [{ member_id: "a", value: 700 }] }));
  assert.ok(
    "error" in
      computeShares(1000, {
        mode: "exact",
        participants: [
          { member_id: "a", value: 500 },
          { member_id: "a", value: 500 },
        ],
      }),
  );
});

test("per lijn van het ticket, met korting en een verschil met het totaal", () => {
  const participants = [{ member_id: "jaan" }, { member_id: "sam" }];
  // Bier voor Jaan, shampoo voor Sam, brood gedeeld.
  assert.deepEqual(
    shares(
      computeShares(1000, {
        mode: "lines",
        participants,
        lines: [
          { description: "Bier", amount_cents: 600, member_ids: ["jaan"] },
          { description: "Shampoo", amount_cents: 300, member_ids: ["sam"] },
          { description: "Brood", amount_cents: 200, member_ids: [] },
          { description: "Korting bier", amount_cents: -100, member_ids: ["jaan"] },
        ],
      }),
    ),
    { jaan: 600, sam: 400 },
  );
  // De lijnen zijn samen 10 euro, het ticket 9 euro (korting op het totaal): naar verhouding.
  assert.deepEqual(
    shares(
      computeShares(900, {
        mode: "lines",
        participants,
        lines: [
          { description: "A", amount_cents: 500, member_ids: ["jaan"] },
          { description: "B", amount_cents: 500, member_ids: ["sam"] },
        ],
      }),
    ),
    { jaan: 450, sam: 450 },
  );
  assert.ok("error" in computeShares(100, { mode: "lines", participants, lines: [{ description: "Korting", amount_cents: -50, member_ids: ["sam"] }] }));
});

test("betalers moeten samen het hele bedrag betalen", () => {
  assert.equal(
    checkPayments(5000, [
      { member_id: "jaan", pot_id: null, amount_cents: 3000 },
      { member_id: "sam", pot_id: null, amount_cents: 2000 },
    ]),
    null,
  );
  assert.match(checkPayments(5000, [{ member_id: "jaan", pot_id: null, amount_cents: 3000 }])!, /hele bedrag/);
  assert.match(checkPayments(5000, [{ member_id: "jaan", pot_id: "p", amount_cents: 5000 }])!, /persoon of een pot/);
  assert.match(checkPayments(5000, [])!, /wie betaalde/);
});

test("saldo's: aankopen, meerdere betalers en een terugbetaling", () => {
  const members = ["jaan", "sam"];
  const expenses = [
    // Jaan betaalde 100 euro, gelijk verdeeld.
    {
      amount_cents: 10000,
      payments: [{ member_id: "jaan", pot_id: null, amount_cents: 10000 }],
      shares: [
        { member_id: "jaan", share_cents: 5000 },
        { member_id: "sam", share_cents: 5000 },
      ],
    },
    // Samen betaald (Jaan 30, Sam 20), helemaal voor Sam.
    {
      amount_cents: 5000,
      payments: [
        { member_id: "jaan", pot_id: null, amount_cents: 3000 },
        { member_id: "sam", pot_id: null, amount_cents: 2000 },
      ],
      shares: [{ member_id: "sam", share_cents: 5000 }],
    },
  ];
  const ledger = computeLedger(members, [], expenses, []);
  assert.equal(ledger.balances.get("jaan"), 8000);
  assert.equal(ledger.balances.get("sam"), -8000);
  assert.deepEqual(suggestTransfers(ledger.balances), [{ from: "sam", to: "jaan", amount_cents: 8000 }]);

  const after = computeLedger(members, [], expenses, [{ from_member_id: "sam", from_pot_id: null, to_member_id: "jaan", to_pot_id: null, amount_cents: 8000 }]);
  assert.equal(after.balances.get("jaan"), 0);
  assert.deepEqual(suggestTransfers(after.balances), []);
});

test("lening: Jaan leent Sam 50 euro", () => {
  const ledger = computeLedger(
    ["jaan", "sam"],
    [],
    [],
    [{ from_member_id: "jaan", from_pot_id: null, to_member_id: "sam", to_pot_id: null, amount_cents: 5000 }],
  );
  assert.equal(ledger.balances.get("jaan"), 5000);
  assert.equal(ledger.balances.get("sam"), -5000);
});

test("pot: stortingen, uitgaven uit de pot en wie nog moet bijstorten", () => {
  const ledger = computeLedger(
    ["jaan", "sam"],
    [{ id: "rekening", opening_cents: 0 }],
    [
      {
        amount_cents: 1200,
        payments: [{ member_id: null, pot_id: "rekening", amount_cents: 1200 }],
        shares: [
          { member_id: "jaan", share_cents: 600 },
          { member_id: "sam", share_cents: 600 },
        ],
      },
    ],
    [
      { from_member_id: "jaan", from_pot_id: null, to_member_id: null, to_pot_id: "rekening", amount_cents: 1000 },
      { from_member_id: "sam", from_pot_id: null, to_member_id: null, to_pot_id: "rekening", amount_cents: 500 },
    ],
  );
  // Uit de pot betaald: geen schulden tussen leden.
  assert.equal(ledger.balances.get("jaan"), 0);
  const pot = ledger.pots.get("rekening")!;
  assert.equal(pot.cash_cents, 300);
  assert.equal(pot.members.get("jaan"), 400);
  assert.equal(pot.members.get("sam"), -100);
});

test("deels uit de pot, deels door een lid", () => {
  const ledger = computeLedger(
    ["jaan", "sam"],
    [{ id: "kas", opening_cents: 2000 }],
    [
      {
        amount_cents: 1000,
        payments: [
          { member_id: null, pot_id: "kas", amount_cents: 600 },
          { member_id: "jaan", pot_id: null, amount_cents: 400 },
        ],
        shares: [
          { member_id: "jaan", share_cents: 500 },
          { member_id: "sam", share_cents: 500 },
        ],
      },
    ],
    [],
  );
  // Jaan legde 4 euro voor, waarvan de helft voor Sam.
  assert.equal(ledger.balances.get("jaan"), 200);
  assert.equal(ledger.balances.get("sam"), -200);
  assert.equal(ledger.pots.get("kas")!.cash_cents, 1400);
  assert.equal(ledger.pots.get("kas")!.members.get("sam"), -300);
});

test("een uitgave zonder verdeling verlaagt enkel de pot", () => {
  const ledger = computeLedger(
    ["jaan"],
    [{ id: "p", opening_cents: 0 }],
    [{ amount_cents: 700, payments: [{ member_id: null, pot_id: "p", amount_cents: 700 }], shares: [] }],
    [],
  );
  assert.equal(ledger.pots.get("p")!.cash_cents, -700);
  assert.equal(ledger.balances.get("jaan"), 0);
});

test("standaardverdeling als beginwaarde", () => {
  assert.deepEqual(splitFromDefault(null, ["a", "b"]), { mode: "equal", participants: [{ member_id: "a" }, { member_id: "b" }] });
  assert.deepEqual(splitFromDefault({ mode: "percent", values: { a: 60, b: 40 } }, ["a", "b", "c"]), {
    mode: "percent",
    participants: [
      { member_id: "a", value: 60 },
      { member_id: "b", value: 40 },
    ],
  });
});
