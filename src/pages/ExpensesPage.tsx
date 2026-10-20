import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { ExpenseEntry, ExpenseSummary, SettlementInput, Taxonomy, Transfer } from "../../shared/types";
import { api, useApi } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { Avatar, SubmitButton } from "../components/Controls";
import { Icon } from "../components/Icon";
import { SkeletonRows, stagger, useCountUp } from "../components/Motion";
import { EmptyState, PageHead, toneForCategory } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { centsToInput, formatCents, formatDate, formatMonth, parseEuro, shiftMonth, thisMonth, today } from "../format";
import { memberById, useTaxonomy } from "../taxonomy";

const SPLIT_SHORT = { equal: "gedeeld", personal: "persoonlijk", custom: "aangepast" } as const;

export function ExpensesPage() {
  const [month, setMonth] = useState(thisMonth);
  const { data, error, loading, reload } = useApi<ExpenseSummary>(`/expenses/summary?month=${month}`);
  const { data: taxonomy } = useTaxonomy();
  const [settling, setSettling] = useState<Transfer>();
  const toast = useToast();

  // "Jij" als onderwerp, "jou" als lijdend voorwerp: "Sam moet jou nog € 42", "Jij moet Sam nog € 42".
  const subject = (id: string) => (id === taxonomy?.me.id ? "Jij" : (memberById(taxonomy, id)?.name ?? "?"));
  const object = (id: string) => (id === taxonomy?.me.id ? "jou" : (memberById(taxonomy, id)?.name ?? "?"));

  const first = data?.transfers[0];
  const description = data
    ? first
      ? `${subject(first.from)} moet ${object(first.to)} nog ${formatCents(first.amount_cents)}`
      : "Iedereen staat gelijk"
    : " ";

  return (
    <div className="page">
      <PageHead
        title="Uitgaven"
        description={description}
        primary={
          <Link to="/aankopen/nieuw" className="btn btn-primary">
            <Icon name="plus" size={16} /> Nieuwe uitgave
          </Link>
        }
      />

      {error && <p className="error">{error}</p>}
      {!data && loading && <SkeletonRows rows={4} />}

      {data && taxonomy && (
        <div className="expenses-grid">
          <section className="card">
            <header className="card-head">
              <div>
                <h2 className="card-title">Wie moet wie</h2>
                <p className="card-desc">Over alle aankopen en terugbetalingen heen</p>
              </div>
            </header>
            {data.transfers.length === 0 ? (
              <div className="card-body">
                <p className="balance-even">
                  <span className="ok">
                    <Icon name="check" size={16} />
                  </span>
                  Alles is verrekend
                </p>
              </div>
            ) : (
              data.transfers.map((t) => (
                <Balance key={`${t.from}-${t.to}`} transfer={t} taxonomy={taxonomy} text={`${subject(t.from)} moet ${object(t.to)} nog`} onSettle={() => setSettling(t)} />
              ))
            )}
            {taxonomy.members.filter((m) => m.active === 1).length < 2 && (
              <p className="footnote">
                Nog alleen in het huishouden.{" "}
                <Link to="/meer" className="link">
                  Voeg je partner toe
                </Link>{" "}
                om uitgaven te verdelen.
              </p>
            )}
          </section>

          <section className="card">
            <div className="month-switch">
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Vorige maand">
                <Icon name="prev" />
              </button>
              <h2>{formatMonth(month)}</h2>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setMonth((m) => shiftMonth(m, 1))}
                aria-label="Volgende maand"
                disabled={month >= thisMonth()}
              >
                <Icon name="next" />
              </button>
            </div>
            <MonthTotal cents={data.month.total_cents} />
            <p className="month-sub">
              {data.month.by_member.length > 1
                ? data.month.by_member.map((m) => `${subject(m.member_id)} ${formatCents(m.share_cents)}`).join(" · ")
                : "uitgegeven deze maand"}
            </p>
            <CategoryBars key={month} rows={data.month.by_category} />
          </section>

          <section className="span">
            <h2 className="section-title">In {formatMonth(month).split(" ")[0]}</h2>
            {data.entries.length === 0 ? (
              <EmptyState icon="wallet" title="Nog niets deze maand">
                Elke aankoop telt hier mee.
              </EmptyState>
            ) : (
              <div className="card">
                <ul className="rows stagger" key={month}>
                  {data.entries.map((e, i) => (
                    <li key={`${e.kind}-${e.id}`} style={stagger(i)}>
                      <EntryRow
                        entry={e}
                        taxonomy={taxonomy}
                        onDeleted={() => {
                          toast("Terugbetaling verwijderd", "trash");
                          reload();
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}

      <Link to="/aankopen/nieuw" className="fab" aria-label="Nieuwe uitgave">
        <Icon name="plus" size={24} />
      </Link>

      <Sheet open={Boolean(settling)} title="Terugbetaling" onClose={() => setSettling(undefined)}>
        {settling && taxonomy && (
          <SettleForm
            transfer={settling}
            taxonomy={taxonomy}
            onDone={() => {
              setSettling(undefined);
              toast("Terugbetaling bewaard");
              reload();
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function Balance({ transfer, taxonomy, text, onSettle }: { transfer: Transfer; taxonomy: Taxonomy; text: string; onSettle: () => void }) {
  const amount = useCountUp(transfer.amount_cents);
  return (
    <div className="balance">
      <div>
        <div className="balance-people">
          <Avatar member={memberById(taxonomy, transfer.from)} />
          <Icon name="arrow" size={16} />
          <Avatar member={memberById(taxonomy, transfer.to)} />
        </div>
        <p className="balance-label" style={{ marginTop: 12 }}>
          {text}
        </p>
        <p className="balance-amount">{formatCents(amount)}</p>
      </div>
      <button type="button" className="btn btn-primary" onClick={onSettle}>
        <Icon name="check" size={16} /> Terugbetaald
      </button>
    </div>
  );
}

function MonthTotal({ cents }: { cents: number }) {
  return <p className="month-total">{formatCents(useCountUp(cents))}</p>;
}

function CategoryBars({ rows }: { rows: ExpenseSummary["month"]["by_category"] }) {
  if (rows.length === 0) return <div style={{ height: 18 }} />;
  const max = Math.max(...rows.map((r) => r.total_cents));
  return (
    <ul className="bars">
      {rows.map((r, i) => (
        <li key={r.category_id ?? "none"} className={`tone-${r.color ?? toneForCategory(r.name)}`}>
          <span className="bar-label">
            <span className="dot" /> {r.name}
          </span>
          <span className="bar-amount">{formatCents(r.total_cents)}</span>
          <span className="bar-track">
            <span className="bar" style={{ display: "block", width: `${Math.max(3, (r.total_cents / max) * 100)}%`, ...stagger(i) }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function EntryRow({ entry, taxonomy, onDeleted }: { entry: ExpenseEntry; taxonomy: Taxonomy; onDeleted: () => void }) {
  const confirm = useConfirm();

  if (entry.kind === "purchase") {
    const payer = memberById(taxonomy, entry.paid_by);
    const tone = entry.category_color ?? toneForCategory(entry.category_name);
    return (
      <Link to={`/aankopen/${entry.id}`} className="row">
        <span className={`row-media tone-${tone}`}>
          <Icon name="receipt" size={16} />
        </span>
        <span className="row-main">
          <span className="row-title">{entry.description}</span>
          <span className="row-meta">
            <span>{formatDate(entry.date)}</span>
            {payer ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Avatar member={payer} size="sm" /> {payer.name}
                {entry.split_mode && ` · ${SPLIT_SHORT[entry.split_mode]}`}
              </span>
            ) : (
              <span>gezamenlijk</span>
            )}
          </span>
        </span>
        <span className="row-end">{formatCents(entry.amount_cents)}</span>
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
    <div className="row">
      <span className="row-media tone-sage">
        <Icon name="transfer" size={16} />
      </span>
      <span className="row-main">
        <span className="row-title">
          {from?.name} betaalde {to?.name} terug
        </span>
        <span className="row-meta">
          <span>{[formatDate(entry.date), entry.note].filter(Boolean).join(" · ")}</span>
        </span>
      </span>
      <span className="row-end">{formatCents(entry.amount_cents)}</span>
      <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={remove} aria-label="Terugbetaling verwijderen">
        <Icon name="trash" size={15} />
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
      <p className="muted" style={{ marginTop: -8 }}>
        {memberById(taxonomy, transfer.from)?.name} betaalt {memberById(taxonomy, transfer.to)?.name} terug. Minder mag ook:
        dan blijft de rest openstaan.
      </p>
      <div className="field-row">
        <label className="field">
          <span className="label">Bedrag</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={Number.isNaN(cents)} />
        </label>
        <label className="field">
          <span className="label">Datum</span>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span className="label">
          <Icon name="note" size={15} /> Notitie
        </span>
        <input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="bv. overschrijving van 20/10" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <SubmitButton busy={busy}>Bewaren</SubmitButton>
      </div>
    </form>
  );
}
