import { useId, useState, type CSSProperties } from "react";
import { computeShares, splitFromDefault, type DefaultSplit, type PaymentInput, type SplitInput, type SplitMode } from "../../shared/split";
import type { Member, Pot, PurchaseDetail } from "../../shared/types";
import { api } from "../api";
import { centsToInput, formatCents, parseEuro } from "../format";
import { prepareForReading } from "../image";
import { Avatar, Segmented } from "./Controls";
import { Icon } from "./Icon";
import { Spinner } from "./Motion";

/** Een betaler: "m:<lid>" of "p:<pot>". */
type PayerKey = `m:${string}` | `p:${string}`;

export type SplitState = {
  payer: PayerKey;
  /** Meerdere betalers: per betaler een bedrag zoals getypt. */
  multi: boolean;
  pay: Record<string, string>;
  mode: SplitMode;
  /** Wie meedoet (niet bij "per lijn"). */
  people: string[];
  /** Per persoon: procent, aantal delen of bedrag, zoals getypt. */
  values: Record<string, string>;
  lines: { description: string; amount: string; member_ids: string[] }[];
};

const keyOf = (p: PaymentInput): PayerKey => (p.member_id ? `m:${p.member_id}` : `p:${p.pot_id}`);

function toPayment(key: string, amount: number): PaymentInput {
  return key.startsWith("m:")
    ? { member_id: key.slice(2), pot_id: null, amount_cents: amount }
    : { member_id: null, pot_id: key.slice(2), amount_cents: amount };
}

function number(text: string): number {
  return Number(text.replace(",", ".").trim());
}

/** Beginwaarde: de standaardverdeling (nieuw) of wat er bewaard is (bewerken). */
export function initialSplitState(opts: {
  meId: string;
  people: Member[];
  defaults: DefaultSplit | null;
  existing?: Pick<PurchaseDetail, "payments" | "shares" | "split_mode" | "lines">;
  /** Een bewaarde verdeling zonder uitgerekende delen (een terugkerende kost). */
  saved?: { payments: PaymentInput[]; split: SplitInput };
}): SplitState {
  const { meId, people, defaults, saved } = opts;
  const exact = saved?.split.mode === "exact";
  const existing =
    opts.existing ??
    (saved && {
      payments: saved.payments,
      split_mode: saved.split.mode,
      lines: saved.split.lines ?? [],
      shares: saved.split.participants.map((p) => ({
        member_id: p.member_id,
        share_cents: exact ? (p.value ?? 0) : 0,
        split_value: exact ? null : (p.value ?? null),
      })),
    });
  if (existing && (existing.payments.length > 0 || existing.shares.length > 0)) {
    const mode = existing.split_mode ?? "equal";
    const ids = existing.shares.map((s) => s.member_id);
    return {
      payer: existing.payments[0] ? keyOf(existing.payments[0]) : `m:${meId}`,
      multi: existing.payments.length > 1,
      pay: Object.fromEntries(existing.payments.map((p) => [keyOf(p), centsToInput(p.amount_cents)])),
      mode,
      people: ids.length ? ids : people.map((m) => m.id),
      values: Object.fromEntries(
        existing.shares.map((s) => [
          s.member_id,
          mode === "exact" ? centsToInput(s.share_cents) : s.split_value !== null ? String(s.split_value).replace(".", ",") : "",
        ]),
      ),
      lines: existing.lines.map((l) => ({ description: l.description, amount: centsToInput(l.amount_cents), member_ids: l.member_ids })),
    };
  }
  const start = splitFromDefault(
    defaults,
    people.map((m) => m.id),
  );
  return {
    payer: `m:${people.some((m) => m.id === meId) ? meId : (people[0]?.id ?? meId)}`,
    multi: false,
    pay: {},
    mode: start.mode,
    people: start.participants.map((p) => p.member_id),
    values: Object.fromEntries(start.participants.map((p) => [p.member_id, p.value !== undefined && p.value !== null ? String(p.value) : ""])),
    lines: [],
  };
}

/** Van wat je typte naar betalers en verdeling voor de API, of een foutmelding. */
export function buildSplit(state: SplitState, amount: number | null): { payments: PaymentInput[]; split: SplitInput | null } | { error: string } {
  if (amount === null || amount === 0) return { payments: [], split: null };

  let payments: PaymentInput[];
  if (state.multi) {
    payments = [];
    for (const [key, text] of Object.entries(state.pay)) {
      if (!text.trim()) continue;
      const cents = parseEuro(text);
      if (cents === null || Number.isNaN(cents) || cents < 0) return { error: "Een bedrag bij de betalers is niet geldig" };
      if (cents > 0) payments.push(toPayment(key, cents));
    }
    const paid = payments.reduce((sum, p) => sum + p.amount_cents, 0);
    if (paid !== amount) return { error: paid < amount ? `Nog ${formatCents(amount - paid)} zonder betaler` : `${formatCents(paid - amount)} te veel betaald` };
  } else {
    payments = [toPayment(state.payer, amount)];
  }

  if (state.mode === "lines") {
    const lines = [];
    for (const l of state.lines) {
      if (!l.description.trim() && !l.amount.trim()) continue;
      const cents = parseEuro(l.amount);
      if (cents === null || Number.isNaN(cents)) return { error: `Het bedrag van "${l.description || "een lijn"}" is niet geldig` };
      lines.push({ description: l.description.trim() || "Lijn", amount_cents: cents, member_ids: l.member_ids });
    }
    return { payments, split: { mode: "lines", participants: state.people.map((member_id) => ({ member_id })), lines } };
  }

  const participants = state.people.map((member_id) => {
    if (state.mode === "equal") return { member_id };
    const text = state.values[member_id] ?? "";
    const value = state.mode === "exact" ? (parseEuro(text) ?? 0) : text.trim() ? number(text) : 0;
    return { member_id, value: Number.isNaN(value) ? Number.NaN : value };
  });
  if (participants.some((p) => "value" in p && Number.isNaN(p.value))) return { error: "Een getal in de verdeling is niet geldig" };
  return { payments, split: { mode: state.mode, participants } };
}

const MODES: { value: Exclude<SplitMode, "lines">; label: string }[] = [
  { value: "equal", label: "Gelijk" },
  { value: "percent", label: "Procent" },
  { value: "shares", label: "Delen" },
  { value: "exact", label: "Bedrag" },
];

/**
 * Wie betaalde en hoe het verdeeld wordt (zie STIJLBOEK.md → Verdelen). Toont meteen wie hoeveel draagt.
 * `people`: wie mee kan doen (de bewoners, of de deelnemers van een project); `pots`: potten die mogen betalen.
 */
export function SplitEditor({
  amount,
  people,
  pots,
  meId,
  value,
  onChange,
  receipt,
  allowLines = true,
  onAddPerson,
  suggestions = [],
}: {
  amount: number | null;
  people: Member[];
  pots: Pot[];
  meId: string;
  value: SplitState;
  onChange: (next: SplitState) => void;
  /** Het ticket (als bestand) om de lijnen uit te lezen. */
  receipt?: () => Promise<File | null>;
  /** "Per lijn van het ticket" aanbieden (niet bij een terugkerende kost). */
  allowLines?: boolean;
  /** Iemand mee laten delen die (nog) niet in de lijst staat; geeft die persoon terug. */
  onAddPerson?: (name: string) => Promise<Member>;
  /** Namen die we al kennen maar niet in de lijst staan, om aan te vullen. */
  suggestions?: Member[];
}) {
  const set = (patch: Partial<SplitState>) => onChange({ ...value, ...patch });
  const payerOptions: { key: PayerKey; label: string; member?: Member; pot?: Pot }[] = [
    ...people.map((m) => ({ key: `m:${m.id}` as PayerKey, label: m.id === meId ? "Ik" : m.name, member: m })),
    ...pots.filter((p) => !p.archived).map((p) => ({ key: `p:${p.id}` as PayerKey, label: p.name, pot: p })),
  ];

  const built = buildSplit(value, amount);
  const preview =
    amount && "split" in built && built.split
      ? computeShares(
          amount,
          built.split,
          built.payments.flatMap((p) => (p.member_id ? [p.member_id] : [])),
        )
      : null;
  const shareOf = (id: string) => (preview && "shares" in preview ? (preview.shares.find((s) => s.member_id === id)?.share_cents ?? 0) : null);
  const problem = "error" in built ? built.error : preview && "error" in preview ? preview.error : null;

  const toggle = (id: string) => set({ people: value.people.includes(id) ? value.people.filter((p) => p !== id) : [...value.people, id] });

  return (
    <div className="split-editor">
      <div className="field">
        <div className="split-head">
          <span className="label">Betaald door</span>
          <button
            type="button"
            className="link-button"
            onClick={() => set({ multi: !value.multi, pay: value.multi ? {} : { [value.payer]: amount ? centsToInput(amount) : "" } })}
          >
            <Icon name={value.multi ? "user" : "users"} size={14} />
            {value.multi ? "Eén betaler" : "Meerdere betalers"}
          </button>
        </div>
        {!value.multi &&
          (payerOptions.length <= 4 ? (
            <Segmented
              label="Betaald door"
              value={value.payer}
              onChange={(payer) => set({ payer })}
              options={payerOptions.map((o) => ({
                value: o.key,
                label: (
                  <>
                    {o.member ? <Avatar member={o.member} size="sm" /> : <Icon name="piggy" size={14} />}
                    <span>{o.label}</span>
                  </>
                ),
              }))}
            />
          ) : (
            <select aria-label="Betaald door" value={value.payer} onChange={(e) => set({ payer: e.target.value as PayerKey })}>
              {payerOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.pot ? `Pot: ${o.label}` : o.label}
                </option>
              ))}
            </select>
          ))}
        {value.multi && (
          <div className="split-rows">
            {payerOptions.map((o) => (
              <label key={o.key} className="split-row">
                {o.member ? (
                  <Avatar member={o.member} size="sm" />
                ) : (
                  <span className="split-pot">
                    <Icon name="piggy" size={13} />
                  </span>
                )}
                <span className="split-name">{o.label}</span>
                <input
                  inputMode="decimal"
                  placeholder="0,00"
                  value={value.pay[o.key] ?? ""}
                  onChange={(e) => set({ pay: { ...value.pay, [o.key]: e.target.value } })}
                  aria-label={`${o.label} betaalde`}
                />
              </label>
            ))}
          </div>
        )}
        {value.payer.startsWith("p:") && !value.multi && <span className="hint">Uit de pot betaald: geen schuld tussen jullie; de pot zakt.</span>}
      </div>

      <div className="field">
        <div className="split-head">
          <span className="label">Verdeling</span>
          {allowLines && (
            <button
              type="button"
              className="link-button"
              aria-pressed={value.mode === "lines"}
              onClick={() => set({ mode: value.mode === "lines" ? "equal" : "lines", lines: value.lines.length ? value.lines : [emptyLine()] })}
            >
              <Icon name="listLines" size={14} />
              {value.mode === "lines" ? "Gewone verdeling" : "Per lijn van het ticket"}
            </button>
          )}
        </div>

        {value.mode !== "lines" ? (
          <>
            <Segmented label="Verdeling" value={value.mode} onChange={(mode) => set({ mode })} options={MODES} />
            <div className="split-rows">
              {people.map((m) => {
                const on = value.people.includes(m.id);
                const share = on ? shareOf(m.id) : null;
                return (
                  <div key={m.id} className="split-row" data-off={!on}>
                    <button
                      type="button"
                      className="split-toggle"
                      aria-pressed={on}
                      onClick={() => toggle(m.id)}
                      aria-label={`${m.name} doet ${on ? "mee" : "niet mee"}`}
                    >
                      <Avatar member={m} size="sm" />
                      <span className="split-check">
                        <Icon name="check" size={10} />
                      </span>
                    </button>
                    <span className="split-name">{m.id === meId ? `${m.name} (ik)` : m.name}</span>
                    {value.mode !== "equal" && on && (
                      <span className="split-input" data-unit={value.mode === "percent" ? "%" : value.mode === "shares" ? "×" : "€"}>
                        <input
                          inputMode="decimal"
                          placeholder={value.mode === "exact" ? "0,00" : value.mode === "percent" ? "0" : "1"}
                          value={value.values[m.id] ?? ""}
                          onChange={(e) => set({ values: { ...value.values, [m.id]: e.target.value } })}
                          aria-label={`${m.name}: ${MODES.find((x) => x.value === value.mode)?.label}`}
                        />
                      </span>
                    )}
                    <span className="split-share">{on && share !== null ? formatCents(share) : on ? "—" : "doet niet mee"}</span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <LinesEditor value={value} people={people} onChange={onChange} amount={amount} receipt={receipt} shareOf={shareOf} />
        )}

        {onAddPerson && (
          <AddPerson
            suggestions={suggestions}
            onAdd={async (name) => {
              const member = await onAddPerson(name);
              if (!value.people.includes(member.id)) onChange({ ...value, people: [...value.people, member.id] });
            }}
          />
        )}

        {amount ? (
          <span className={`hint split-status ${problem ? "error" : "ok"}`} role="status">
            {problem ?? "Klopt: samen het volledige bedrag."}
          </span>
        ) : (
          <span className="hint">Vul een bedrag in om te verdelen.</span>
        )}
      </div>
    </div>
  );
}

/**
 * Iemand anders mee laten delen: een naam typen (of kiezen uit wie we al kennen).
 * Zit die nog niet in de app, dan wordt het een persoon zonder aanmelding; voeg je die later toe met dezelfde naam,
 * dan staat alles wat al gedeeld werd er meteen.
 */
function AddPerson({ suggestions, onAdd }: { suggestions: Member[]; onAdd: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const listId = useId();

  if (!open) {
    return (
      <button type="button" className="link-button" style={{ justifySelf: "start" }} onClick={() => setOpen(true)}>
        <Icon name="userPlus" size={14} /> Iemand anders
      </button>
    );
  }

  async function add() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onAdd(name);
      setName("");
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="add-person">
      <input
        autoFocus
        list={listId}
        maxLength={60}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          // In een formulier: Enter voegt toe in plaats van alles te bewaren.
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Naam, bv. Lien"
        aria-label="Naam van wie mee deelt"
      />
      <datalist id={listId}>
        {suggestions.map((m) => (
          <option key={m.id} value={m.name} />
        ))}
      </datalist>
      <button type="button" className="btn btn-outline btn-sm" disabled={busy || !name.trim()} onClick={add}>
        {busy ? <Spinner size={14} /> : <Icon name="plus" size={14} />} Toevoegen
      </button>
      <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setOpen(false)} aria-label="Annuleren">
        <Icon name="close" size={14} />
      </button>
      {error ? (
        <span className="hint error">{error}</span>
      ) : (
        <span className="hint">Zit die nog niet in de app? Voeg die later toe met dezelfde naam: alles wat gedeeld werd, staat er dan meteen.</span>
      )}
    </div>
  );
}

function emptyLine() {
  return { description: "", amount: "", member_ids: [] as string[] };
}

/** Per lijn van het ticket: wie had wat. Geen keuze = iedereen samen. */
function LinesEditor({
  value,
  people,
  onChange,
  amount,
  receipt,
  shareOf,
}: {
  value: SplitState;
  people: Member[];
  onChange: (next: SplitState) => void;
  amount: number | null;
  receipt?: () => Promise<File | null>;
  shareOf: (id: string) => number | null;
}) {
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<string>();
  const setLines = (lines: SplitState["lines"]) => onChange({ ...value, lines, people: people.map((m) => m.id) });
  const update = (i: number, patch: Partial<SplitState["lines"][number]>) => setLines(value.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const total = value.lines.reduce((sum, l) => {
    const cents = parseEuro(l.amount);
    return sum + (cents && !Number.isNaN(cents) ? cents : 0);
  }, 0);

  async function read() {
    if (!receipt) return;
    setReading(true);
    setMessage(undefined);
    try {
      const file = await receipt();
      if (!file) {
        setMessage("Voeg eerst een foto of PDF van het ticket toe.");
        return;
      }
      const body = new FormData();
      if (file.type === "application/pdf") {
        const { pdfText, pdfFirstPageImage } = await import("../pdf");
        body.append("text", await pdfText(file));
        const image = await pdfFirstPageImage(file).catch(() => null);
        if (image) body.append("image", image);
      } else {
        body.append("image", await prepareForReading(file));
      }
      const result = await api.post<{ lines: { description: string; amount_cents: number }[]; message?: string }>("/receipts/lines", body);
      if (result.lines.length) setLines(result.lines.map((l) => ({ description: l.description, amount: centsToInput(l.amount_cents), member_ids: [] })));
      setMessage(result.message ?? (result.lines.length ? `${result.lines.length} lijnen gelezen. Tik op wie wat had.` : undefined));
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="lines-editor">
      {receipt && (
        <button type="button" className="btn btn-outline btn-sm" onClick={read} disabled={reading} style={{ justifySelf: "start" }}>
          {reading ? <Spinner size={14} /> : <Icon name="scan" size={15} />} Lijnen van het ticket lezen
        </button>
      )}
      {message && <span className="hint">{message}</span>}
      <ul className="lines">
        {value.lines.map((line, i) => (
          <li key={i} className="line" style={{ "--i": i } as CSSProperties}>
            <input
              className="line-desc"
              value={line.description}
              placeholder="Omschrijving"
              onChange={(e) => update(i, { description: e.target.value })}
              aria-label="Omschrijving"
            />
            <input
              className="line-amount"
              inputMode="decimal"
              value={line.amount}
              placeholder="0,00"
              onChange={(e) => update(i, { amount: e.target.value })}
              aria-label="Bedrag"
            />
            <span className="line-people">
              {people.map((m) => {
                const on = line.member_ids.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="line-person"
                    aria-pressed={on}
                    title={m.name}
                    onClick={() => update(i, { member_ids: on ? line.member_ids.filter((x) => x !== m.id) : [...line.member_ids, m.id] })}
                  >
                    <Avatar member={m} size="sm" />
                  </button>
                );
              })}
              {line.member_ids.length === 0 && <span className="line-everyone">iedereen</span>}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => setLines(value.lines.filter((_, k) => k !== i))}
              aria-label="Lijn verwijderen"
            >
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: "start" }} onClick={() => setLines([...value.lines, emptyLine()])}>
        <Icon name="plus" size={14} /> Lijn
      </button>
      <div className="lines-summary">
        <span className="muted small">
          Lijnen samen {formatCents(total)}
          {amount !== null && total !== amount && ` · ticket ${formatCents(amount)}: het verschil wordt naar verhouding verdeeld`}
        </span>
        <span className="lines-shares">
          {people.map((m) => {
            const share = shareOf(m.id);
            return share ? (
              <span key={m.id} className="lines-share">
                <Avatar member={m} size="sm" /> {formatCents(share)}
              </span>
            ) : null;
          })}
        </span>
      </div>
    </div>
  );
}

// ---------- standaardverdeling (huishouden of project) ----------

export type DefaultSplitDraft = { mode: DefaultSplit["mode"]; values: Record<string, string> };

export function defaultSplitDraft(split: DefaultSplit | null): DefaultSplitDraft {
  return { mode: split?.mode ?? "equal", values: Object.fromEntries(Object.entries(split?.values ?? {}).map(([id, v]) => [id, String(v).replace(".", ",")])) };
}

/** Van wat je typte naar een standaardverdeling (null = gelijk over iedereen), of een foutmelding. */
export function buildDefaultSplit(draft: DefaultSplitDraft, people: Member[]): { split: DefaultSplit | null } | { error: string } {
  if (draft.mode === "equal") return { split: null };
  const values: Record<string, number> = {};
  for (const m of people) {
    const text = draft.values[m.id]?.trim() ?? "";
    const value = text ? number(text) : 0;
    if (Number.isNaN(value) || value < 0) return { error: `Het getal bij ${m.name} is niet geldig` };
    values[m.id] = value;
  }
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  if (total <= 0) return { error: "Geef minstens iemand een deel" };
  if (draft.mode === "percent" && Math.abs(total - 100) > 0.01) return { error: `Samen ${formatPercent(total)} in plaats van 100%` };
  return { split: { mode: draft.mode, values } };
}

function formatPercent(n: number): string {
  return `${String(Math.round(n * 100) / 100).replace(".", ",")}%`;
}

const DEFAULT_MODES: { value: DefaultSplit["mode"]; label: string }[] = [
  { value: "equal", label: "Gelijk" },
  { value: "percent", label: "Procent" },
  { value: "shares", label: "Delen" },
];

/** De gewone verdeling: elke nieuwe uitgave begint ermee (bv. 60/40 naar inkomen). */
export function DefaultSplitField({ people, value, onChange }: { people: Member[]; value: DefaultSplitDraft; onChange: (next: DefaultSplitDraft) => void }) {
  const built = buildDefaultSplit(value, people);
  const total = people.reduce((sum, m) => {
    const v = number(value.values[m.id] ?? "");
    return sum + (Number.isNaN(v) ? 0 : v);
  }, 0);
  return (
    <div className="field">
      <span className="label">Gewone verdeling</span>
      <Segmented label="Gewone verdeling" value={value.mode} onChange={(mode) => onChange({ ...value, mode })} options={DEFAULT_MODES} />
      {value.mode !== "equal" && (
        <div className="split-rows">
          {people.map((m) => (
            <div key={m.id} className="split-row">
              <Avatar member={m} size="sm" />
              <span className="split-name">{m.name}</span>
              <span className="split-input" data-unit={value.mode === "percent" ? "%" : "×"}>
                <input
                  inputMode="decimal"
                  placeholder={value.mode === "percent" ? "0" : "1"}
                  value={value.values[m.id] ?? ""}
                  onChange={(e) => onChange({ ...value, values: { ...value.values, [m.id]: e.target.value } })}
                  aria-label={`${m.name}: ${value.mode === "percent" ? "procent" : "delen"}`}
                />
              </span>
              <span className="split-share">
                {value.mode === "shares" && total > 0 ? formatPercent((Math.max(0, number(value.values[m.id] ?? "") || 0) / total) * 100) : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      <span className={`hint ${"error" in built ? "split-status error" : ""}`}>
        {"error" in built
          ? built.error
          : value.mode === "equal"
            ? "Iedereen die meedoet, betaalt evenveel."
            : "Per uitgave kan je het nog altijd anders verdelen."}
      </span>
    </div>
  );
}
