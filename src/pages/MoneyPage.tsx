import { lazy, Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import type { Transfer } from "../../shared/ledger";
import { epcPayload, formatIban } from "../../shared/payment";
import type { Person } from "../../shared/types";
import { api, useApi } from "../api";
import { Avatar, CardHead, SubmitButton, Tabs } from "../components/Controls";
import { LogList, type EventPage } from "../components/Log";
import { SkeletonRows } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { brusselsNow } from "../../shared/model";
import { centsToInput, formatCents, formatMonth, parseEuro, shiftMonth, thisMonth } from "../format";
import { useSession } from "../session";

const Barcode = lazy(() => import("../components/Barcode").then((m) => ({ default: m.Barcode })));

type Sum = { key: string; label: string; total: number; mine: number };
type Money = EventPage & { from: string; to: string; total: number; mine: number; months: Sum[]; by_kind: Sum[]; by_list: Sum[]; by_store: Sum[] };
type Balance = { net: { person_id: string; amount: number }[]; transfers: (Transfer & { list_id: string | null })[]; people: Person[]; ibans: Record<string, string> };

/**
 * Geld: wat er uitging over al je lijsten (een maand, per soort, lijst en winkel, met jouw deel) en wie wie nog moet.
 * Uitgaven is geen lijst die je invult: het zijn de gebeurtenissen met een bedrag, uit elk logboek dat je ziet.
 */
export function MoneyPage() {
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get("maand") ?? "") ? params.get("maand")! : thisMonth();
  const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const { data, error } = useApi<Money>(`/insights/money?from=${month}-01&to=${month}-${String(last).padStart(2, "0")}`);
  const [tab, setTab] = useState<"soort" | "lijst" | "winkel">("soort");
  const setMonth = (m: string) => setParams({ maand: m }, { replace: true });
  const groups = data ? { soort: data.by_kind, lijst: data.by_list, winkel: data.by_store }[tab] : [];
  return (
    <div className="page">
      <PageHead title="Geld" />
      <div className="split split-main-first">
        <aside className="split-aside">
          <BalanceCard />
        </aside>
        <div className="split-main">
          <header className="calendar-head">
            <h2 className="calendar-title">{formatMonth(month)}</h2>
            <div className="btn-row">
              <button type="button" className="btn btn-outline btn-icon btn-sm" aria-label="Vorige maand" onClick={() => setMonth(shiftMonth(month, -1))}>
                <Icon name="prev" size={16} />
              </button>
              <button type="button" className="btn btn-outline btn-icon btn-sm" aria-label="Volgende maand" disabled={month >= thisMonth()} onClick={() => setMonth(shiftMonth(month, 1))}>
                <Icon name="next" size={16} />
              </button>
            </div>
          </header>
          {error && <p className="error">{error}</p>}
          {!data && <SkeletonRows rows={4} />}
          {data && (
            <>
              <section className="card">
                <div className="card-body money-total">
                  <span className="total-value">{formatCents(data.total)}</span>
                  {data.mine !== data.total && <span className="muted">Jouw deel {formatCents(data.mine)}</span>}
                </div>
                {data.total > 0 && (
                  <>
                    <Tabs
                      label="Per"
                      value={tab}
                      onChange={setTab}
                      tabs={[
                        { value: "soort", label: "Per soort" },
                        { value: "lijst", label: "Per lijst" },
                        { value: "winkel", label: "Per winkel" },
                      ]}
                    />
                    <ul className="rows">
                      {groups.map((g) => (
                        <li key={g.key} className="row">
                          <span className="cell-main">
                            <span className="row-main">
                              <span className="row-title">{g.label}</span>
                              {g.mine !== g.total && (
                                <span className="row-meta">
                                  <span>Jouw deel {formatCents(g.mine)}</span>
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="row-end">{formatCents(g.total)}</span>
                        </li>
                      ))}
                      {!groups.length && <li className="dash-empty">Niets met een winkel</li>}
                    </ul>
                  </>
                )}
              </section>
              {data.events.length ? <LogList page={data} /> : <EmptyState icon="wallet" title="Geen uitgaven deze maand" />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Wie wie nog hoeveel moet, over alles wat je ziet; Terugbetaald logt een overdracht (met een betaal-QR als jij moet). */
export function BalanceCard() {
  const { person } = useSession();
  const toast = useToast();
  const { data, reload } = useApi<Balance>("/insights/balance");
  const [paying, setPaying] = useState<Balance["transfers"][number]>();
  if (!data) return null;
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const name = (id: string) => byId.get(id)?.name ?? "Iemand";
  const sentence = (t: Transfer) => `${t.from === person.id ? "Jij" : name(t.from)} moet ${t.to === person.id ? "jou" : name(t.to)} nog`;
  return (
    <section className="card">
      <CardHead title="Wie moet wie" />
      {data.transfers.length ? (
        <ul className="rows">
          {data.transfers.map((t) => (
            <li key={`${t.from}-${t.to}`}>
              <div className="row">
                <span className="cell-main">
                  <Avatar member={byId.get(t.from)} />
                  <span className="row-main">
                    <span className="row-title">{sentence(t)}</span>
                    {t.list_id && (
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
        <p className="card-body muted">Alles is verrekend</p>
      )}
      <Sheet open={Boolean(paying)} title="Terugbetaald" onClose={() => setPaying(undefined)}>
        {paying && (
          <SettleForm
            transfer={paying}
            from={byId.get(paying.from)}
            to={byId.get(paying.to)}
            iban={data.ibans[paying.to]}
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

function SettleForm({ transfer, from, to, iban, onDone }: { transfer: Transfer & { list_id: string | null }; from?: Person; to?: Person; iban?: string; onDone: () => void }) {
  const { person } = useSession();
  const [amount, setAmount] = useState(centsToInput(transfer.amount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const cents = parseEuro(amount);
  const qr = transfer.from === person.id && to && iban && cents && cents > 0 ? epcPayload({ name: to.name, iban }, cents, "Thuis: terugbetaling") : null;
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cents || cents <= 0) return setError("Vul een bedrag in, bv. 12,50.");
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/lists/${transfer.list_id}/events`, {
        kind: "overdracht",
        name: `${from?.name ?? "Iemand"} aan ${to?.name ?? "iemand"}`,
        status: "gebeurd",
        at: brusselsNow().slice(0, 10),
        amount: cents,
        paid_by: transfer.from,
        to_person: transfer.to,
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
            {to!.name} · {formatIban(iban!)} · {formatCents(cents!)}
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
