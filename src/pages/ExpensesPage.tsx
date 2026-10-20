import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { ExpenseEntry, ExpenseSummary, SettlementInput, Taxonomy, Transfer } from "../../shared/types";
import { api, useApi } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { Avatar } from "../components/Controls";
import { Icon } from "../components/Icon";
import { EmptyState, PageHero, toneForCategory } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { centsToInput, formatCents, formatDate, formatMonth, parseEuro, shiftMonth, thisMonth, today } from "../format";
import { memberById, useTaxonomy } from "../taxonomy";

const SPLIT_SHORT = { equal: "gedeeld", personal: "persoonlijk", custom: "aangepast" } as const;

export function ExpensesPage() {
  const [month, setMonth] = useState(thisMonth);
  const { data, error, reload } = useApi<ExpenseSummary>(`/expenses/summary?month=${month}`);
  const { data: taxonomy } = useTaxonomy();
  const [settling, setSettling] = useState<Transfer>();

  // "Jij" als onderwerp, "jou" als lijdend voorwerp: "Sam moet jou nog € 42", "Jij moet Sam nog € 42".
  const subject = (id: string) => (id === taxonomy?.me.id ? "Jij" : (memberById(taxonomy, id)?.name ?? "?"));
  const object = (id: string) => (id === taxonomy?.me.id ? "jou" : (memberById(taxonomy, id)?.name ?? "?"));
  const transferText = (t: Transfer) => `${subject(t.from)} moet ${object(t.to)} nog ${formatCents(t.amount_cents)}`;

  const summaryText = data && (data.transfers.length === 0 ? "Iedereen staat gelijk" : transferText(data.transfers[0]));

  return (
    <div className="page">
      <PageHero
        title="Uitgaven"
        tone="sage"
        summary={summaryText}
        action={
          <Link to="/aankopen/nieuw" className="button primary">
            <Icon name="plus" /> Nieuwe uitgave
          </Link>
        }
      />

      {error && <p className="error">{error}</p>}

      {data && taxonomy && (
        <div className="expenses-grid">
          <section className="balance-card tone-sage" aria-label="Wie moet wie nog betalen">
            {data.transfers.length === 0 ? (
              <p className="balance-even">
                <Icon name="check" size={22} /> Alles is verrekend
              </p>
            ) : (
              data.transfers.map((t) => (
                <div key={`${t.from}-${t.to}`} className="transfer">
                  <div className="transfer-people">
                    <Avatar member={memberById(taxonomy, t.from)} />
                    <Icon name="arrow" size={18} />
                    <Avatar member={memberById(taxonomy, t.to)} />
                  </div>
                  <p className="transfer-text">
                    {subject(t.from)} moet {object(t.to)} nog
                  </p>
                  <strong className="transfer-amount">{formatCents(t.amount_cents)}</strong>
                  <button type="button" className="button primary" onClick={() => setSettling(t)}>
                    Terugbetaald
                  </button>
                </div>
              ))
            )}
            {taxonomy.members.filter((m) => m.active === 1).length < 2 && (
              <p className="muted small">
                Nog alleen in het huishouden. <Link to="/meer" className="link">Voeg je partner toe</Link> om uitgaven te
                verdelen.
              </p>
            )}
          </section>

          <section className="month-card">
            <div className="month-switch">
              <button type="button" className="icon-button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Vorige maand">
                <Icon name="prev" />
              </button>
              <h2>{formatMonth(month)}</h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => setMonth((m) => shiftMonth(m, 1))}
                aria-label="Volgende maand"
                disabled={month >= thisMonth()}
              >
                <Icon name="next" />
              </button>
            </div>
            <p className="month-total">{formatCents(data.month.total_cents)}</p>
            <p className="muted small month-sub">
              {data.month.by_member.length > 1
                ? data.month.by_member.map((m) => `${subject(m.member_id)} ${formatCents(m.share_cents)}`).join(" · ")
                : "uitgegeven deze maand"}
            </p>
            <CategoryBars rows={data.month.by_category} />
          </section>

          <section className="entries">
            <h2>Deze maand</h2>
            {data.entries.length === 0 ? (
              <EmptyState icon="wallet" tone="sage">
                Nog niets in {formatMonth(month).split(" ")[0]}.
              </EmptyState>
            ) : (
              <ul className="list">
                {data.entries.map((e) => (
                  <li key={`${e.kind}-${e.id}`}>
                    <EntryRow entry={e} taxonomy={taxonomy} onDeleted={reload} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <Link to="/aankopen/nieuw" className="fab" aria-label="Nieuwe uitgave">
        <Icon name="plus" size={26} />
      </Link>

      <Sheet open={Boolean(settling)} title="Terugbetaling" onClose={() => setSettling(undefined)}>
        {settling && taxonomy && (
          <SettleForm
            transfer={settling}
            taxonomy={taxonomy}
            onDone={() => {
              setSettling(undefined);
              reload();
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function CategoryBars({ rows }: { rows: ExpenseSummary["month"]["by_category"] }) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.total_cents));
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.category_id ?? "none"} className={`tone-${r.color ?? toneForCategory(r.name)}`}>
          <span className="bar-label">{r.name}</span>
          <span className="bar-amount">{formatCents(r.total_cents)}</span>
          <span className="bar" style={{ width: `${Math.max(4, (r.total_cents / max) * 100)}%` }} />
        </li>
      ))}
    </ul>
  );
}

function EntryRow({ entry, taxonomy, onDeleted }: { entry: ExpenseEntry; taxonomy: Taxonomy; onDeleted: () => void }) {
  const confirm = useConfirm();

  if (entry.kind === "purchase") {
    const payer = memberById(taxonomy, entry.paid_by);
    return (
      <Link to={`/aankopen/${entry.id}`} className="list-item">
        <div className={`thumb small tone-${entry.category_color ?? toneForCategory(entry.category_name)}`}>
          {payer ? <Avatar member={payer} size="small" /> : <Icon name="wallet" size={18} />}
        </div>
        <div className="list-main">
          <strong>{entry.description}</strong>
          <span className="muted">
            {[
              formatDate(entry.date),
              payer ? `${payer.name}${entry.split_mode ? ` · ${SPLIT_SHORT[entry.split_mode]}` : ""}` : "gezamenlijk",
            ].join(" · ")}
          </span>
        </div>
        <span className="amount">{formatCents(entry.amount_cents)}</span>
      </Link>
    );
  }

  const from = memberById(taxonomy, entry.from_member_id);
  const to = memberById(taxonomy, entry.to_member_id);
  async function remove() {
    const ok = await confirm({
      title: "Terugbetaling verwijderen?",
      body: `${from?.name} → ${to?.name}: ${formatCents(entry.amount_cents)}`,
      confirmLabel: "Verwijderen",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/expenses/settlements/${entry.id}`);
    onDeleted();
  }

  return (
    <div className="list-item settlement">
      <div className="thumb small tone-sage">
        <Icon name="transfer" size={18} />
      </div>
      <div className="list-main">
        <strong>
          {from?.name} betaalde {to?.name} terug
        </strong>
        <span className="muted">{[formatDate(entry.date), entry.note].filter(Boolean).join(" · ")}</span>
      </div>
      <span className="amount">{formatCents(entry.amount_cents)}</span>
      <button type="button" className="icon-button small" onClick={remove} aria-label="Terugbetaling verwijderen">
        <Icon name="trash" size={16} />
      </button>
    </div>
  );
}

function SettleForm({ transfer, taxonomy, onDone }: { transfer: Transfer; taxonomy: Taxonomy; onDone: () => void }) {
  const [amount, setAmount] = useState(centsToInput(transfer.amount_cents));
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const cents = parseEuro(amount);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cents || Number.isNaN(cents)) {
      setError("Vul een geldig bedrag in.");
      return;
    }
    const input: SettlementInput = {
      from_member_id: transfer.from,
      to_member_id: transfer.to,
      amount_cents: cents,
      settled_on: date,
      note,
    };
    setBusy(true);
    try {
      await api.post("/expenses/settlements", input);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <p className="muted">
        {memberById(taxonomy, transfer.from)?.name} betaalt {memberById(taxonomy, transfer.to)?.name} terug. Minder mag
        ook: dan blijft de rest openstaan.
      </p>
      <div className="field-row">
        <label className="field">
          <span className="label">Bedrag (€)</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={Number.isNaN(cents)} />
        </label>
        <label className="field">
          <span className="label">Datum</span>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span className="label">Notitie</span>
        <input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="bv. overschrijving" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Opslaan…" : "Opslaan"}
        </button>
      </div>
    </form>
  );
}
