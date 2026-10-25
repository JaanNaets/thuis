import { useState, type FormEvent } from "react";
import { SPLIT_LABELS, type PaymentInput } from "../../shared/split";
import {
  FREQUENCIES,
  TRANSFER_KINDS,
  type ExpenseEntry,
  type ExpenseSummary,
  type Member,
  type MoneyTransferInput,
  type Pot,
  type PotSummary,
  type RecurringExpense,
  type Taxonomy,
  type TransferKind,
} from "../../shared/types";
import { api } from "../api";
import { centsToInput, formatCents, formatDate, parseEuro, today } from "../format";
import { Link } from "../router";
import { memberById } from "../taxonomy";
import { useConfirm } from "./ConfirmDialog";
import { Avatar, CardHead, SubmitButton, ToneSwatches } from "./Controls";
import { Icon } from "./Icon";
import { stagger, useCountUp } from "./Motion";
import { toneForCategory } from "./Page";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

/** "Jij" als onderwerp, "jou" als lijdend voorwerp: "Sam moet jou nog € 42", "Jij moet Sam nog € 42". */
export function useWords(taxonomy: Taxonomy | undefined) {
  const subject = (id: string) => (id === taxonomy?.me.id ? "Jij" : (memberById(taxonomy, id)?.name ?? "?"));
  const object = (id: string) => (id === taxonomy?.me.id ? "jou" : (memberById(taxonomy, id)?.name ?? "?"));
  return { subject, object };
}

/** Wie betaalde, kort: een naam, een pot, of "Jaan + Sam". */
export function payerText(payments: PaymentInput[], taxonomy: Taxonomy | undefined): string {
  const name = (p: PaymentInput) =>
    p.member_id ? (memberById(taxonomy, p.member_id)?.name ?? "?") : (taxonomy?.pots.find((x) => x.id === p.pot_id)?.name ?? "Pot");
  if (payments.length === 0) return "—";
  if (payments.length <= 2) return payments.map(name).join(" + ");
  return `${payments.length} betalers`;
}

function PayerAvatar({ payments, taxonomy }: { payments: PaymentInput[]; taxonomy: Taxonomy }) {
  const first = payments[0];
  if (!first) return null;
  if (first.pot_id) return <Icon name="piggy" size={15} className="muted" />;
  return <Avatar member={memberById(taxonomy, first.member_id)} size="sm" />;
}

// ---------- wie moet wie ----------

type MoneyDraft = Partial<MoneyTransferInput> & { kind: TransferKind };

/** Saldo's met de voorgestelde overschrijvingen, en knoppen om terug te betalen of iets te lenen. */
export function BalancesCard({
  summary,
  taxonomy,
  people,
  projectId,
  onChanged,
}: {
  summary: Pick<ExpenseSummary, "transfers" | "balances">;
  taxonomy: Taxonomy;
  /** Wie in dit saldo zit (voor een lening). */
  people: Member[];
  projectId: string | null;
  onChanged: () => void;
}) {
  const { subject, object } = useWords(taxonomy);
  const [draft, setDraft] = useState<MoneyDraft>();

  return (
    <section className="card">
      <CardHead
        icon="transfer"
        title="Wie moet wie"
        description={projectId ? "Over alle uitgaven van dit project" : "Over alle aankopen en terugbetalingen heen"}
        action={
          people.length > 1 && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setDraft({ kind: "loan", from_member_id: taxonomy.me.id })}>
              <Icon name="coins" size={15} /> Lening
            </button>
          )
        }
      />
      {summary.transfers.length === 0 ? (
        <div className="card-body">
          <p className="balance-even">
            <span className="ok">
              <Icon name="check" size={16} />
            </span>
            Alles is verrekend
          </p>
        </div>
      ) : (
        summary.transfers.map((t) => (
          <BalanceRow
            key={`${t.from}-${t.to}`}
            from={memberById(taxonomy, t.from)}
            to={memberById(taxonomy, t.to)}
            cents={t.amount_cents}
            text={`${subject(t.from)} moet ${object(t.to)} nog`}
            onSettle={() => setDraft({ kind: "repayment", from_member_id: t.from, to_member_id: t.to, amount_cents: t.amount_cents })}
          />
        ))
      )}
      {people.length < 2 && !projectId && (
        <p className="footnote">
          Nog alleen in het huishouden.{" "}
          <Link to="/meer" className="link">
            Voeg je partner toe
          </Link>{" "}
          om uitgaven te verdelen.
        </p>
      )}

      <MoneySheet draft={draft} people={people} pots={[]} projectId={projectId} taxonomy={taxonomy} onClose={() => setDraft(undefined)} onSaved={onChanged} />
    </section>
  );
}

function BalanceRow({ from, to, cents, text, onSettle }: { from?: Member; to?: Member; cents: number; text: string; onSettle: () => void }) {
  const amount = useCountUp(cents);
  return (
    <div className="balance">
      <div>
        <div className="balance-people">
          <Avatar member={from} />
          <Icon name="arrow" size={16} />
          <Avatar member={to} />
        </div>
        <p className="balance-label" style={{ marginTop: 12 }}>
          {text}
        </p>
        <p className="balance-amount">{formatCents(amount)}</p>
      </div>
      <button type="button" className="btn btn-outline" onClick={onSettle}>
        <Icon name="check" size={16} /> Terugbetaald
      </button>
    </div>
  );
}

// ---------- potten ----------

/** Potten: wat erin zit, wie hoeveel stortte (min wat die eruit verbruikte), en storten of afhalen. */
export function PotsCard({
  pots,
  taxonomy,
  people,
  projectId,
  onChanged,
}: {
  pots: PotSummary[];
  taxonomy: Taxonomy;
  people: Member[];
  projectId: string | null;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<MoneyDraft>();
  const [editing, setEditing] = useState<Pot | "new">();
  const visible = pots.filter((p) => !p.archived);

  return (
    <section className="card">
      <CardHead
        icon="piggy"
        title={projectId ? "Kas" : "Potten"}
        description={projectId ? "Gezamenlijke kas van dit project" : "Gezamenlijke rekening, spaarpot, …"}
        action={
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing("new")}>
            <Icon name="plus" size={15} /> Pot
          </button>
        }
      />
      {visible.length === 0 ? (
        <p className="card-body hint">Een pot betaalt uitgaven voor iedereen samen. Wie stort, krijgt dat terug in zijn deel.</p>
      ) : (
        <ul className="rows pots">
          {visible.map((pot, i) => (
            <li key={pot.id} style={stagger(i)}>
              <PotRow
                pot={pot}
                taxonomy={taxonomy}
                onEdit={() => setEditing(pot)}
                onMove={(kind) =>
                  setDraft({
                    kind,
                    ...(kind === "deposit" ? { to_pot_id: pot.id, from_member_id: taxonomy.me.id } : { from_pot_id: pot.id, to_member_id: taxonomy.me.id }),
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}

      <MoneySheet
        draft={draft}
        people={people}
        pots={visible}
        projectId={projectId}
        taxonomy={taxonomy}
        onClose={() => setDraft(undefined)}
        onSaved={onChanged}
      />
      <Sheet open={Boolean(editing)} title={editing === "new" ? "Nieuwe pot" : "Pot bewerken"} onClose={() => setEditing(undefined)}>
        {editing && (
          <PotForm
            pot={editing === "new" ? undefined : editing}
            projectId={projectId}
            onDone={() => {
              setEditing(undefined);
              onChanged();
            }}
          />
        )}
      </Sheet>
    </section>
  );
}

function PotRow({
  pot,
  taxonomy,
  onEdit,
  onMove,
}: {
  pot: PotSummary;
  taxonomy: Taxonomy;
  onEdit: () => void;
  onMove: (kind: "deposit" | "withdrawal") => void;
}) {
  const cash = useCountUp(pot.cash_cents);
  const behind = pot.members.filter((m) => m.balance_cents < 0);
  return (
    <div className="pot">
      <button type="button" className="pot-head" onClick={onEdit}>
        <span className={`row-media round tone-${pot.color ?? "sky"}`}>
          <Icon name="piggy" size={17} />
        </span>
        <span className="row-main">
          <span className="row-title">{pot.name}</span>
          <span className="row-meta">
            <span>{pot.cash_cents < 0 ? "staat rood" : "in de pot"}</span>
          </span>
        </span>
        <span className={`pot-cash ${pot.cash_cents < 0 ? "negative" : ""}`}>{formatCents(cash)}</span>
      </button>
      {pot.members.length > 0 && (
        <ul className="pot-members">
          {pot.members.map((m) => (
            <li key={m.member_id}>
              <Avatar member={memberById(taxonomy, m.member_id)} size="sm" />
              <span>{memberById(taxonomy, m.member_id)?.name}</span>
              <span className={m.balance_cents < 0 ? "negative" : "muted"}>
                {m.balance_cents < 0 ? `moet ${formatCents(-m.balance_cents)} bijstorten` : `${formatCents(m.balance_cents)} over`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="pot-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => onMove("deposit")}>
          <Icon name="plus" size={14} /> Storten
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMove("withdrawal")}>
          <Icon name="minus" size={14} /> Afhalen
        </button>
        {behind.length > 0 && <span className="hint">{behind.length === 1 ? "1 iemand" : `${behind.length} mensen`} moet bijstorten</span>}
      </div>
    </div>
  );
}

function PotForm({ pot, projectId, onDone }: { pot?: Pot; projectId: string | null; onDone: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(pot?.name ?? "");
  const [color, setColor] = useState(pot?.color ?? "sky");
  const [opening, setOpening] = useState(pot ? centsToInput(pot.opening_cents) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save(e: FormEvent) {
    e.preventDefault();
    const cents = opening.trim() ? parseEuro(opening.replace(/^-/, "")) : 0;
    if (cents === null || Number.isNaN(cents)) return setError("Het beginsaldo is niet geldig.");
    const body = { name, color, opening_cents: opening.trim().startsWith("-") ? -cents : cents, project_id: projectId, archived: false };
    setBusy(true);
    try {
      if (pot) await api.put(`/expenses/pots/${pot.id}`, body);
      else await api.post("/expenses/pots", body);
      toast(pot ? "Pot bijgewerkt" : "Pot aangemaakt");
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function archive() {
    if (!pot) return;
    const ok = await confirm({
      title: `"${pot.name}" verwijderen?`,
      body: "Is er al mee betaald of in gestort, dan wordt de pot gearchiveerd.",
      confirmLabel: "Verwijderen",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/expenses/pots/${pot.id}`);
    } catch {
      await api.put(`/expenses/pots/${pot.id}`, {
        name: pot.name,
        color: pot.color,
        opening_cents: pot.opening_cents,
        project_id: pot.project_id,
        archived: true,
      });
    }
    toast("Pot weg", "trash");
    onDone();
  }

  return (
    <form className="form" onSubmit={save}>
      <label className="field">
        <span className="label">Naam</span>
        <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="bv. Gezamenlijke rekening" />
      </label>
      <label className="field">
        <span className="label">
          Beginsaldo <span className="optional">· wat er nu al in zit</span>
        </span>
        <input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="€ 0,00" />
      </label>
      <div className="field">
        <span className="label">Kleur</span>
        <ToneSwatches value={color} onChange={setColor} />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        {pot && (
          <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={archive}>
            <Icon name="trash" size={16} /> Verwijderen
          </button>
        )}
        <SubmitButton busy={busy}>Bewaren</SubmitButton>
      </div>
    </form>
  );
}

// ---------- geld verplaatsen ----------

const MONEY_TITLES: Record<TransferKind, string> = {
  repayment: "Terugbetaling",
  loan: "Lening of voorschot",
  deposit: "Storten in de pot",
  withdrawal: "Afhalen uit de pot",
};

/** Eén formulier voor elke geldbeweging: terugbetalen, lenen, storten, afhalen. */
export function MoneySheet({
  draft,
  people,
  pots,
  projectId,
  taxonomy,
  onClose,
  onSaved,
}: {
  draft: MoneyDraft | undefined;
  people: Member[];
  pots: Pot[];
  projectId: string | null;
  taxonomy: Taxonomy;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Sheet open={Boolean(draft)} title={draft ? MONEY_TITLES[draft.kind] : ""} onClose={onClose}>
      {draft && (
        <MoneyForm
          draft={draft}
          people={people}
          pots={pots}
          projectId={projectId}
          taxonomy={taxonomy}
          onDone={() => {
            onClose();
            onSaved();
          }}
        />
      )}
    </Sheet>
  );
}

function MoneyForm({
  draft,
  people,
  pots,
  projectId,
  taxonomy,
  onDone,
}: {
  draft: MoneyDraft;
  people: Member[];
  pots: Pot[];
  projectId: string | null;
  taxonomy: Taxonomy;
  onDone: () => void;
}) {
  const toast = useToast();
  const kind = draft.kind;
  const [from, setFrom] = useState(draft.from_member_id ?? draft.from_pot_id ?? "");
  const [to, setTo] = useState(draft.to_member_id ?? draft.to_pot_id ?? people.find((m) => m.id !== draft.from_member_id)?.id ?? "");
  const [amount, setAmount] = useState(draft.amount_cents ? centsToInput(draft.amount_cents) : "");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const cents = parseEuro(amount);

  const fromIsPot = kind === "withdrawal";
  const toIsPot = kind === "deposit";
  const fromLabel = { repayment: "Wie betaalt terug", loan: "Wie leent uit", deposit: "Wie stort", withdrawal: "Uit welke pot" }[kind];
  const toLabel = { repayment: "Aan wie", loan: "Aan wie", deposit: "In welke pot", withdrawal: "Wie krijgt het" }[kind];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cents || Number.isNaN(cents)) return setError("Vul een geldig bedrag in.");
    const input: MoneyTransferInput = {
      kind,
      project_id: projectId,
      from_member_id: fromIsPot ? null : from,
      from_pot_id: fromIsPot ? from : null,
      to_member_id: toIsPot ? null : to,
      to_pot_id: toIsPot ? to : null,
      amount_cents: cents,
      transferred_on: date,
      note,
    };
    setBusy(true);
    try {
      await api.post("/expenses/transfers", input);
      toast(`${TRANSFER_KINDS[kind].label} bewaard`);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const select = (value: string, onChange: (v: string) => void, options: { id: string; name: string }[], label: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} required>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.id === taxonomy.me.id ? `${o.name} (ik)` : o.name}
        </option>
      ))}
    </select>
  );

  return (
    <form className="form" onSubmit={onSubmit}>
      {kind === "loan" && (
        <p className="muted" style={{ marginTop: -8 }}>
          Geld dat iemand voorschoot of uitleende, zonder aankoop erbij. Het telt mee in wie wie moet.
        </p>
      )}
      {kind === "repayment" && (
        <p className="muted" style={{ marginTop: -8 }}>
          Minder mag ook: dan blijft de rest openstaan.
        </p>
      )}
      <div className="field-row">
        <label className="field">
          <span className="label">{fromLabel}</span>
          {select(from, setFrom, fromIsPot ? pots : people, fromLabel)}
        </label>
        <label className="field">
          <span className="label">{toLabel}</span>
          {select(to, setTo, toIsPot ? pots : people.filter((m) => m.id !== from), toLabel)}
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span className="label">Bedrag</span>
          <input
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={Number.isNaN(cents)}
            placeholder="€ 0,00"
          />
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
        <input
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={kind === "loan" ? "bv. voorschot voor de huur" : "bv. overschrijving van 20/10"}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <SubmitButton busy={busy}>Bewaren</SubmitButton>
      </div>
    </form>
  );
}

// ---------- lijst van uitgaven en geldbewegingen ----------

const TRANSFER_TEXT: Record<TransferKind, (from: string, to: string) => string> = {
  repayment: (from, to) => `${from} betaalde ${to} terug`,
  loan: (from, to) => `${from} leende ${to} geld`,
  deposit: (from, to) => `${from} stortte in ${to}`,
  withdrawal: (from, to) => `${to} haalde uit ${from}`,
};

/** Een uitgave of geldbeweging in de lijst. `onDeleted` krijgt de soort mee ("Lening"), voor de melding. */
export function EntryRow({
  entry,
  taxonomy,
  inProject,
  myShare,
  onDeleted,
}: {
  entry: ExpenseEntry;
  taxonomy: Taxonomy;
  /** Op de projectpagina: de naam van het project niet nog eens tonen. */
  inProject?: boolean;
  /** Toon jouw deel in plaats van het hele bedrag (bij Gedeeld). */
  myShare?: number;
  /** Zonder: alleen lezen (geen knop om te verwijderen). */
  onDeleted?: (label: string) => void;
}) {
  const confirm = useConfirm();

  if (entry.kind === "purchase") {
    const tone = entry.category_color ?? toneForCategory(entry.category_name);
    const who = payerText(entry.payments, taxonomy);
    const how = entry.split_mode ? SPLIT_LABELS[entry.split_mode].toLowerCase() : null;
    return (
      <Link to={`/aankopen/${entry.id}`} className="row">
        <span className="cell-main">
          <span className={`row-media tone-${tone}`}>
            <Icon name={entry.recurring_id ? "repeat" : "receipt"} size={16} />
          </span>
          <span className="row-main">
            <span className="row-title">{entry.description}</span>
            <span className="row-meta narrow-only">
              <span>{formatDate(entry.date)}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <PayerAvatar payments={entry.payments} taxonomy={taxonomy} /> {who}
                {how && ` · ${how}`}
              </span>
            </span>
            {(entry.category_name || (entry.project_name && !inProject)) && (
              <span className="row-meta wide-only">{[entry.category_name, !inProject && entry.project_name].filter(Boolean).join(" · ")}</span>
            )}
          </span>
        </span>
        <span className="col">
          <PayerAvatar payments={entry.payments} taxonomy={taxonomy} />
          <span>
            {who}
            {how && <span className="muted"> · {how}</span>}
          </span>
        </span>
        <span className="col">
          <span>{formatDate(entry.date)}</span>
        </span>
        {myShare !== undefined ? (
          <span className="row-end">
            {formatCents(myShare)}
            <span className="row-end-sub">van {formatCents(entry.amount_cents)}</span>
          </span>
        ) : (
          <span className="row-end">{formatCents(entry.amount_cents)}</span>
        )}
      </Link>
    );
  }

  const transfer = entry;
  const name = (member: string | null, pot: string | null) =>
    member ? (memberById(taxonomy, member)?.name ?? "?") : (taxonomy.pots.find((p) => p.id === pot)?.name ?? "de pot");
  const from = name(transfer.from_member_id, transfer.from_pot_id);
  const to = name(transfer.to_member_id, transfer.to_pot_id);
  const label = TRANSFER_KINDS[transfer.transfer_kind].label;
  const text = TRANSFER_TEXT[transfer.transfer_kind](from, to);

  async function remove() {
    const ok = await confirm({
      title: `${label} verwijderen?`,
      body: `${text}: ${formatCents(transfer.amount_cents)}`,
      confirmLabel: "Verwijderen",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/expenses/transfers/${transfer.id}`);
    onDeleted?.(label);
  }

  const actor = entry.from_member_id ?? entry.to_member_id;
  return (
    <div className="row">
      <span className="cell-main">
        <span className={`row-media tone-${entry.transfer_kind === "loan" ? "lilac" : entry.transfer_kind === "repayment" ? "sage" : "sky"}`}>
          <Icon name={entry.transfer_kind === "loan" ? "coins" : entry.transfer_kind === "repayment" ? "transfer" : "piggy"} size={16} />
        </span>
        <span className="row-main">
          <span className="row-title">{text}</span>
          <span className="row-meta">
            <span className="narrow-only">{formatDate(entry.date)}</span>
            {entry.note && <span>{entry.note}</span>}
          </span>
        </span>
      </span>
      <span className="col">
        <Avatar member={memberById(taxonomy, actor)} size="sm" />
        <span>{label}</span>
      </span>
      <span className="col">
        <span>{formatDate(entry.date)}</span>
      </span>
      <span className="row-end" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {formatCents(entry.amount_cents)}
        {onDeleted && (
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={remove} aria-label={`${label} verwijderen`}>
            <Icon name="trash" size={15} />
          </button>
        )}
      </span>
    </div>
  );
}

// ---------- maand en terugkerende kosten ----------

export function MonthTotal({ cents }: { cents: number }) {
  return <p className="month-total">{formatCents(useCountUp(cents))}</p>;
}

export function CategoryBars({ rows }: { rows: ExpenseSummary["month"]["by_category"] }) {
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

/** Vaste kosten (huur, energie, abonnementen) die zichzelf inboeken. */
export function RecurringCard({ items, taxonomy, projectId }: { items: RecurringExpense[]; taxonomy: Taxonomy; projectId: string | null }) {
  const newLink = `/uitgaven/terugkerend/nieuw${projectId ? `?project=${projectId}` : ""}`;
  return (
    <section className="card">
      <CardHead
        icon="repeat"
        title="Terugkerende kosten"
        description="Huur, energie, abonnementen: vanzelf ingeboekt"
        action={
          <Link to={newLink} className="btn btn-outline btn-sm">
            <Icon name="plus" size={15} /> Terugkerend
          </Link>
        }
      />
      {items.length === 0 ? (
        <p className="card-body hint">Nog geen. Voeg bv. de huur toe: die verschijnt dan elke maand bij de uitgaven, al verdeeld.</p>
      ) : (
        <ul className="rows stagger">
          {items.map((r, i) => (
            <li key={r.id} style={stagger(i)}>
              <Link to={`/uitgaven/terugkerend/${r.id}`} className="row">
                <span className="cell-main">
                  <span className={`row-media ${r.active ? "tone-lilac" : ""}`}>
                    <Icon name="repeat" size={16} />
                  </span>
                  <span className="row-main">
                    <span className="row-title">{r.description}</span>
                    <span className="row-meta">
                      <span>
                        {FREQUENCIES[r.frequency].short} · {payerText(r.payments, taxonomy)}
                      </span>
                      {r.active ? <span>volgende {formatDate(r.next_on)}</span> : <span className="badge badge-secondary">gepauzeerd</span>}
                    </span>
                  </span>
                </span>
                <span className="row-end">{formatCents(r.amount_cents)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
