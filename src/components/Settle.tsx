// Terugbetaald (een rij van wie moet wie, zie shared/blocks.ts → saldo): logt een overdracht in een lijst waar beiden in
// staan, met een betaal-QR als jij moet en wie krijgt een rekeningnummer gaf.

import { lazy, Suspense, useState, type FormEvent } from "react";
import { brusselsNow } from "../../shared/model";
import { epcPayload, formatIban } from "../../shared/payment";
import { api } from "../api";
import { centsToInput, formatCents, parseEuro } from "../format";
import { useSession } from "../session";
import { SubmitButton } from "./Controls";

const Barcode = lazy(() => import("./Barcode").then((m) => ({ default: m.Barcode })));

export type Settle = { from: { id: string; name: string }; to: { id: string; name: string }; amount: number; list: string; iban: string | null };

export function SettleForm({ settle, onDone }: { settle: Settle; onDone: () => void }) {
  const { person } = useSession();
  const [amount, setAmount] = useState(centsToInput(settle.amount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const cents = parseEuro(amount);
  const qr = settle.from.id === person.id && settle.iban && cents && cents > 0 ? epcPayload({ name: settle.to.name, iban: settle.iban }, cents, "Thuis: terugbetaling") : null;
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cents || cents <= 0) return setError("Vul een bedrag in, bv. 12,50.");
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/lists/${settle.list}/events`, {
        kind: "overdracht",
        name: `${settle.from.name} aan ${settle.to.name}`,
        status: "gebeurd",
        at: brusselsNow().slice(0, 10),
        amount: cents,
        paid_by: settle.from.id,
        to_person: settle.to.id,
        lines: [],
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="field">
        <span className="label">Bedrag</span>
        <input inputMode="decimal" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      {qr && (
        <div className="field pay-qr">
          <span className="label">Betaal met je bank-app</span>
          <Suspense fallback={null}>
            <Barcode format="qr_code" value={qr} />
          </Suspense>
          <span className="hint">
            {settle.to.name} · {formatIban(settle.iban!)} · {formatCents(cents!)}
          </span>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <SubmitButton busy={busy} className="btn btn-primary btn-lg">
        {busy ? "Bewaren…" : "Bewaren"}
      </SubmitButton>
    </form>
  );
}
