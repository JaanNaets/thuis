import { useState, type FormEvent } from "react";
import type { Transfer } from "../../shared/totals";
import type { Balance, ItemInput, Person } from "../../shared/types";
import { api, useApi } from "../api";
import { centsToInput, formatCents, parseEuro, today } from "../format";
import { useSession } from "../session";
import { Avatar, CardHead, SubmitButton } from "./Controls";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

/**
 * Wie wie nog hoeveel moet in een project (met alles eronder), uit de lijsten met de regel Kosten verdelen en
 * Terugbetalingen. "Terugbetaald" bewaart een terugbetaling; minder mag ook, dan blijft de rest openstaan.
 */
export function BalanceCard({ projectId, className }: { projectId: string; className?: string }) {
  const { person } = useSession();
  const toast = useToast();
  const { data, reload } = useApi<Balance>(`/projects/${projectId}/balance`);
  const [paying, setPaying] = useState<Transfer>();
  if (!data?.active) return null;

  const byId = new Map(data.people.map((p) => [p.id, p]));
  const name = (id: string) => byId.get(id)?.name ?? "Iemand";
  // "Jana moet jou nog", "Jij moet Jaan nog", "Jana moet Jaan nog".
  const sentence = (t: Transfer) => `${t.from === person.id ? "Jij" : name(t.from)} moet ${t.to === person.id ? "jou" : name(t.to)} nog`;

  async function addSettleList() {
    try {
      await api.post(`/projects/${projectId}/types/template`, { key: "terugbetaling" });
      toast("Terugbetalingen klaargezet");
      reload();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }

  return (
    <section className={className ? `card ${className}` : "card"}>
      <CardHead title="Wie moet wie" />
      {data.transfers.length > 0 ? (
        <ul className="rows">
          {data.transfers.map((t) => (
            <li key={`${t.from}-${t.to}`}>
              <div className="row">
                <span className="cell-main">
                  <Avatar member={byId.get(t.from)} />
                  <span className="row-main">
                    <span className="row-title">{sentence(t)}</span>
                    {data.settle && (
                      <span className="row-meta">
                        <button type="button" className="link-button" onClick={() => setPaying(t)}>
                          Terugbetaald
                        </button>
                      </span>
                    )}
                  </span>
                </span>
                <span className="row-end">{formatCents(t.amount)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="card-body muted small">{data.counted ? "Alles is verrekend." : "Nog geen uitgaven om te verdelen."}</p>
      )}
      {data.can_add_settle && data.transfers.length > 0 && (
        <div className="balance-setup">
          <span className="hint">Om een terugbetaling te bewaren, zet je eerst de lijst Terugbetalingen klaar.</span>
          <button type="button" className="btn btn-outline btn-sm" onClick={addSettleList}>
            <Icon name="plus" size={15} /> Terugbetalingen
          </button>
        </div>
      )}

      <Sheet open={Boolean(paying)} title="Terugbetaald" onClose={() => setPaying(undefined)}>
        {paying && data.settle && (
          <SettleForm
            projectId={projectId}
            transfer={paying}
            settle={data.settle}
            from={byId.get(paying.from)}
            to={byId.get(paying.to)}
            onDone={() => {
              setPaying(undefined);
              toast("Terugbetaling bewaard");
              reload();
            }}
          />
        )}
      </Sheet>
    </section>
  );
}

function SettleForm({
  projectId,
  transfer,
  settle,
  from,
  to,
  onDone,
}: {
  projectId: string;
  transfer: Transfer;
  settle: NonNullable<Balance["settle"]>;
  from?: Person;
  to?: Person;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(centsToInput(transfer.amount));
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const cents = parseEuro(amount);
    if (!cents || cents <= 0) return setError("Vul een bedrag in, bv. 12,50.");
    const input: ItemInput = {
      type_id: settle.type_id,
      name: `${from?.name ?? "Iemand"} aan ${to?.name ?? "iemand"}`,
      data: { [settle.amount]: cents, [settle.from]: transfer.from, [settle.to]: transfer.to, ...(settle.date ? { [settle.date]: date } : {}) },
      tag_ids: [],
    };
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/projects/${projectId}/items`, input);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <p className="hint">
        {from?.name ?? "Iemand"} aan {to?.name ?? "iemand"}
      </p>
      <label className="field">
        <span className="label">Bedrag</span>
        <input inputMode="decimal" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        <span className="hint">Minder mag ook: dan blijft de rest openstaan.</span>
      </label>
      {settle.date && (
        <label className="field">
          <span className="label">Datum</span>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <SubmitButton busy={busy} className="btn btn-primary btn-lg">
        {busy ? "Bewaren…" : "Bewaren"}
      </SubmitButton>
    </form>
  );
}
