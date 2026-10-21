// Kosten verdelen en saldo's berekenen. Alles in cent, zodat er nooit een cent verloren gaat door afronding.
//
// - Een uitgave wordt betaald door een of meer betalers: leden of potten (gezamenlijke rekening, reiskas).
// - Ze wordt verdeeld over deelnemers: gelijk, in procent, in delen, in vaste bedragen of per lijn van het ticket.
// - Wat een lid voor een ander betaalde, wordt een schuld tussen leden.
// - Wat een pot betaalde, is van iedereen samen: de pot zakt, en per lid zie je hoeveel die stortte en verbruikte.

import type { ExpenseShare, Transfer } from "./types";

export const SPLIT_MODES = ["equal", "percent", "shares", "exact", "lines"] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

export const SPLIT_LABELS: Record<SplitMode, string> = {
  equal: "Gelijk",
  percent: "Percentage",
  shares: "Delen",
  exact: "Bedragen",
  lines: "Per lijn",
};

/** Een lijn van het ticket: wie het had. Meerdere leden = gelijk delen; geen = iedereen die meedoet. */
export type SplitLine = { description: string; amount_cents: number; member_ids: string[] };

/**
 * Wat je ingaf om een uitgave te verdelen.
 * `value` is het percentage (percent), het aantal delen (shares) of het bedrag in cent (exact); bij gelijk niets.
 */
export type SplitInput = {
  mode: SplitMode;
  participants: { member_id: string; value?: number | null }[];
  lines?: SplitLine[];
};

/** Wie betaalde: een lid óf een pot. */
export type PaymentInput = { member_id: string | null; pot_id: string | null; amount_cents: number };

/** De gewone verdeling van een huishouden of project (bv. 60/40 naar inkomen). Leeg = gelijk over iedereen. */
export type DefaultSplit = { mode: "equal" | "percent" | "shares"; values: Record<string, number> };

/**
 * Verdeelt een bedrag volgens gewichten, exact tot op de cent (methode van de grootste rest).
 * Restcenten gaan naar wie de grootste rest heeft; bij gelijke rest eerst naar wie in `prefer` staat
 * (de betaler: zo moet niemand anders een cent te veel), daarna in volgorde.
 */
export function allocate(amount: number, weights: { id: string; weight: number }[], prefer: string[] = []): Map<string, number> {
  const result = new Map<string, number>();
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  if (weights.length === 0 || total <= 0) return result;

  const parts = weights.map((w, index) => {
    const exact = (amount * w.weight) / total;
    const base = Math.floor(exact + 1e-9);
    return { id: w.id, base, rest: exact - base, index };
  });
  let left = amount - parts.reduce((sum, p) => sum + p.base, 0);
  const rank = (id: string) => {
    const i = prefer.indexOf(id);
    return i === -1 ? prefer.length : i;
  };
  const order = [...parts].sort((a, b) => b.rest - a.rest || rank(a.id) - rank(b.id) || a.index - b.index);
  for (const p of order) {
    if (left <= 0) break;
    p.base += 1;
    left -= 1;
  }
  for (const p of parts) result.set(p.id, (result.get(p.id) ?? 0) + p.base);
  return result;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * Rekent de delen uit. Geeft de delen terug (met de ingave in `split_value`), of een foutmelding
 * die je zo aan de gebruiker kan tonen.
 */
export function computeShares(
  amount: number,
  split: SplitInput,
  payerIds: string[] = [],
): { shares: (ExpenseShare & { split_value: number | null })[] } | { error: string } {
  const ids = split.participants.map((p) => p.member_id);
  if (new Set(ids).size !== ids.length) return { error: "Iemand staat twee keer in de verdeling" };

  const withValue = (map: Map<string, number>, value: (id: string) => number | null) =>
    split.participants.map((p) => ({ member_id: p.member_id, share_cents: map.get(p.member_id) ?? 0, split_value: value(p.member_id) }));
  const valueOf = (id: string) => split.participants.find((p) => p.member_id === id)?.value ?? null;

  switch (split.mode) {
    case "equal": {
      if (ids.length === 0) return { error: "Kies wie meedoet" };
      return {
        shares: withValue(
          allocate(
            amount,
            ids.map((id) => ({ id, weight: 1 })),
            payerIds,
          ),
          () => null,
        ),
      };
    }
    case "percent":
    case "shares": {
      const values = split.participants.map((p) => p.value ?? 0);
      if (values.some((v) => !Number.isFinite(v) || v < 0)) return { error: "Vul enkel positieve getallen in" };
      if (split.mode === "percent" && Math.abs(sum(values) - 100) > 0.01) {
        return { error: `De percentages zijn samen ${formatPlain(sum(values))}%, niet 100%` };
      }
      if (sum(values) <= 0) return { error: "Geef minstens iemand een deel" };
      const map = allocate(
        amount,
        split.participants.map((p) => ({ id: p.member_id, weight: p.value ?? 0 })),
        payerIds,
      );
      return { shares: withValue(map, valueOf).filter((s) => (s.split_value ?? 0) > 0) };
    }
    case "exact": {
      const values = split.participants.map((p) => p.value ?? 0);
      if (values.some((v) => !Number.isInteger(v) || v < 0)) return { error: "Elk deel moet een positief bedrag zijn" };
      if (sum(values) !== amount) return { error: "De delen zijn samen niet gelijk aan het bedrag" };
      return {
        shares: split.participants
          .filter((p) => (p.value ?? 0) > 0)
          .map((p) => ({ member_id: p.member_id, share_cents: p.value ?? 0, split_value: p.value ?? 0 })),
      };
    }
    case "lines": {
      const lines = split.lines ?? [];
      if (lines.length === 0) return { error: "Voeg minstens één lijn toe" };
      const everyone = ids;
      const perMember = new Map<string, number>();
      for (const line of lines) {
        const who = line.member_ids.length ? line.member_ids : everyone;
        if (who.length === 0) return { error: "Kies wie meedoet" };
        if (!Number.isInteger(line.amount_cents)) return { error: "Een lijn heeft een ongeldig bedrag" };
        // Een korting (negatief bedrag) wordt net zo verdeeld als een gewone lijn.
        const magnitude = allocate(
          Math.abs(line.amount_cents),
          who.map((id) => ({ id, weight: 1 })),
          payerIds,
        );
        for (const [id, cents] of magnitude) perMember.set(id, (perMember.get(id) ?? 0) + Math.sign(line.amount_cents) * cents);
      }
      if ([...perMember.values()].some((v) => v < 0)) return { error: "Iemand krijgt meer korting dan die kocht" };
      const linesTotal = sum([...perMember.values()]);
      if (linesTotal <= 0) return { error: "De lijnen zijn samen niets waard" };
      // Lijnen en totaal verschillen (afronding, een vergeten lijn, korting op het totaal): naar verhouding verdelen.
      const map =
        linesTotal === amount
          ? perMember
          : allocate(
              amount,
              [...perMember].map(([id, weight]) => ({ id, weight })),
              payerIds,
            );
      return {
        shares: [...map].filter(([, cents]) => cents > 0).map(([member_id, share_cents]) => ({ member_id, share_cents, split_value: null })),
      };
    }
  }
}

/** Controleert de betalers. Geeft een foutmelding, of null als alles klopt. */
export function checkPayments(amount: number, payments: PaymentInput[]): string | null {
  if (payments.length === 0) return "Kies wie betaalde";
  const keys = new Set<string>();
  for (const p of payments) {
    if ((p.member_id === null) === (p.pot_id === null)) return "Een betaler is een persoon of een pot";
    const key = p.member_id ?? `pot:${p.pot_id}`;
    if (keys.has(key)) return "Iemand staat twee keer bij de betalers";
    keys.add(key);
    if (!Number.isInteger(p.amount_cents) || p.amount_cents <= 0) return "Elke betaler betaalde een positief bedrag";
  }
  if (sum(payments.map((p) => p.amount_cents)) !== amount) return "De betalers betaalden samen niet het hele bedrag";
  return null;
}

// ---------- saldo's ----------

export type LedgerExpense = {
  amount_cents: number;
  payments: PaymentInput[];
  shares: ExpenseShare[];
};

export type LedgerTransfer = {
  from_member_id: string | null;
  from_pot_id: string | null;
  to_member_id: string | null;
  to_pot_id: string | null;
  amount_cents: number;
};

export type PotLedger = {
  /** Wat er nu in de pot zit. */
  cash_cents: number;
  /** Per lid: gestort − afgehaald − verbruikt uit de pot. Negatief = die moet nog bijstorten. */
  members: Map<string, number>;
};

export type Ledger = {
  /** Per lid tegenover de andere leden. Positief: krijgt nog geld. Negatief: moet nog betalen. Samen 0. */
  balances: Map<string, number>;
  pots: Map<string, PotLedger>;
};

/**
 * Zet uitgaven en geldbewegingen om in saldo's.
 * - Het deel dat leden betaalden, wordt naar verhouding van de verdeling een schuld tussen leden.
 * - Het deel dat een pot betaalde, verlaagt de pot en telt per lid als verbruik uit die pot.
 * - Een uitgave zonder verdeling (bv. van vroeger) verlaagt enkel de pot die ze betaalde.
 */
export function computeLedger(
  memberIds: string[],
  pots: { id: string; opening_cents: number }[],
  expenses: LedgerExpense[],
  transfers: LedgerTransfer[],
): Ledger {
  const balances = new Map(memberIds.map((id) => [id, 0]));
  const potLedgers = new Map(pots.map((p) => [p.id, { cash_cents: p.opening_cents, members: new Map<string, number>() }]));
  const addBalance = (id: string, cents: number) => balances.set(id, (balances.get(id) ?? 0) + cents);
  const pot = (id: string) => {
    let ledger = potLedgers.get(id);
    if (!ledger) potLedgers.set(id, (ledger = { cash_cents: 0, members: new Map() }));
    return ledger;
  };
  const addPotMember = (potId: string, memberId: string, cents: number) => {
    const members = pot(potId).members;
    members.set(memberId, (members.get(memberId) ?? 0) + cents);
  };

  for (const e of expenses) {
    for (const p of e.payments) if (p.pot_id) pot(p.pot_id).cash_cents -= p.amount_cents;
    const weights = e.shares.filter((s) => s.share_cents > 0).map((s) => ({ id: s.member_id, weight: s.share_cents }));
    if (weights.length === 0) continue;

    const memberPaid = sum(e.payments.filter((p) => p.member_id).map((p) => p.amount_cents));
    const payerIds = e.payments.flatMap((p) => (p.member_id ? [p.member_id] : []));
    for (const p of e.payments) if (p.member_id) addBalance(p.member_id, p.amount_cents);
    for (const [id, cents] of allocate(memberPaid, weights, payerIds)) addBalance(id, -cents);

    for (const p of e.payments) {
      if (!p.pot_id) continue;
      for (const [id, cents] of allocate(p.amount_cents, weights)) addPotMember(p.pot_id, id, -cents);
    }
  }

  for (const t of transfers) {
    if (t.from_member_id && t.to_member_id) {
      addBalance(t.from_member_id, t.amount_cents);
      addBalance(t.to_member_id, -t.amount_cents);
    }
    if (t.from_member_id && t.to_pot_id) {
      pot(t.to_pot_id).cash_cents += t.amount_cents;
      addPotMember(t.to_pot_id, t.from_member_id, t.amount_cents);
    }
    if (t.from_pot_id && t.to_member_id) {
      pot(t.from_pot_id).cash_cents -= t.amount_cents;
      addPotMember(t.from_pot_id, t.to_member_id, -t.amount_cents);
    }
    if (t.from_pot_id && t.to_pot_id) {
      pot(t.from_pot_id).cash_cents -= t.amount_cents;
      pot(t.to_pot_id).cash_cents += t.amount_cents;
    }
  }

  return { balances, pots: potLedgers };
}

/** Zo weinig mogelijk overschrijvingen om iedereen op nul te zetten. */
export function suggestTransfers(balances: Map<string, number>): Transfer[] {
  const debtors = [...balances].filter(([, b]) => b < 0).map(([id, b]) => ({ id, left: -b }));
  const creditors = [...balances].filter(([, b]) => b > 0).map(([id, b]) => ({ id, left: b }));
  debtors.sort((a, b) => b.left - a.left);
  creditors.sort((a, b) => b.left - a.left);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].left, creditors[j].left);
    transfers.push({ from: debtors[i].id, to: creditors[j].id, amount_cents: amount });
    debtors[i].left -= amount;
    creditors[j].left -= amount;
    if (debtors[i].left === 0) i++;
    if (creditors[j].left === 0) j++;
  }
  return transfers;
}

/** De standaardverdeling als beginwaarde voor een nieuwe uitgave. */
export function splitFromDefault(defaults: DefaultSplit | null, memberIds: string[]): SplitInput {
  if (!defaults || defaults.mode === "equal") return { mode: "equal", participants: memberIds.map((member_id) => ({ member_id })) };
  return {
    mode: defaults.mode,
    participants: memberIds.filter((id) => (defaults.values[id] ?? 0) > 0).map((member_id) => ({ member_id, value: defaults.values[member_id] })),
  };
}

function formatPlain(value: number): string {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}
