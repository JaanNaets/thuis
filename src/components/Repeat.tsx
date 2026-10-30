// Herhalen: een item dat zich herhaalt (de huur, elke maand). Op de volgende datum maakt de app 's morgens een nieuw
// item zoals dit (worker/cron.ts), met de datum van die dag. Je stelt het in vanop de fiche.

import { useState, type FormEvent } from "react";
import { addToDate } from "../../shared/calc";
import { INTERVAL_UNITS, type IntervalUnit } from "../../shared/fields";
import { everyText } from "../../shared/remind";
import type { ItemDetail } from "../../shared/types";
import { api } from "../api";
import { formatDate, today } from "../format";
import { CardHead, SubmitButton } from "./Controls";
import { Icon } from "./Icon";

/** Op de fiche: hoe vaak en wanneer de volgende keer, met Aanpassen. */
export function RepeatCard({ repeat, onEdit }: { repeat: NonNullable<ItemDetail["repeat"]>; onEdit?: () => void }) {
  return (
    <section className="card">
      <CardHead
        title="Herhaalt zich"
        description={`${everyText(repeat.every)[0].toUpperCase()}${everyText(repeat.every).slice(1)}; de volgende keer op ${formatDate(repeat.next_on)}.`}
        action={
          onEdit && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
              <Icon name="edit" size={15} /> Aanpassen
            </button>
          )
        }
      />
    </section>
  );
}

/** In een onderblad: hoe vaak, en de eerste keer. Met Stoppen als het al loopt. */
export function RepeatForm({ item, onDone }: { item: ItemDetail; onDone: (item: ItemDetail, message: string) => void }) {
  const [n, setN] = useState(String(item.repeat?.every.n ?? 1));
  const [unit, setUnit] = useState<IntervalUnit>(item.repeat?.every.unit ?? "month");
  const [next, setNext] = useState(item.repeat?.next_on ?? addToDate(today(), 1, "month"));
  const [touched, setTouched] = useState(Boolean(item.repeat));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const many = n.trim() !== "1";

  async function save(e: FormEvent) {
    e.preventDefault();
    const count = Number(n);
    if (!Number.isInteger(count) || count < 1 || count > 100) return setError("Kies om de hoeveel: een getal van 1 tot 100.");
    setBusy(true);
    setError(undefined);
    try {
      onDone(await api.put<ItemDetail>(`/items/${item.id}/repeat`, { every: { n: count, unit }, next_on: next }), "Herhaling bewaard");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      onDone(await api.delete(`/items/${item.id}/repeat`).then(() => api.get<ItemDetail>(`/items/${item.id}`)), "Herhaling gestopt");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <div className="field">
        <span className="label">Hoe vaak</span>
        <div className="interval-input">
          <span className="muted">elke</span>
          <input inputMode="numeric" aria-label="Hoe vaak: hoeveel" value={n} onChange={(e) => setN(e.target.value)} />
          <select
            aria-label="Hoe vaak: eenheid"
            value={unit}
            onChange={(e) => {
              const u = e.target.value as IntervalUnit;
              setUnit(u);
              // De eerste keer volgt mee zolang je ze zelf niet koos.
              if (!touched) setNext(addToDate(today(), Number(n) || 1, u));
            }}
          >
            {Object.entries(INTERVAL_UNITS).map(([u, w]) => (
              <option key={u} value={u}>
                {many ? w.many : w.one}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="field">
        <span className="label">De eerste keer</span>
        <input
          type="date"
          required
          min={today()}
          value={next}
          onChange={(e) => {
            setTouched(true);
            setNext(e.target.value);
          }}
        />
        <span className="hint">
          Op die dag maakt de app 's morgens een nieuw {item.name ? `"${item.name}"` : "item"} zoals dit, met de datum van die dag. Daarna{" "}
          {everyText({ n: Number(n) >= 1 ? Math.floor(Number(n)) : 1, unit })}.
        </span>
      </label>
      {error && <p className="error">{error}</p>}
      <SubmitButton busy={busy} className="btn btn-primary btn-lg">
        {item.repeat ? "Bewaren" : "Herhalen"}
      </SubmitButton>
      {item.repeat && (
        <button type="button" className="btn btn-outline btn-lg" disabled={busy} onClick={stop}>
          Stoppen
        </button>
      )}
    </form>
  );
}
