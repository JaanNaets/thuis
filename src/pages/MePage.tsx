import { useState, type FormEvent } from "react";
import { formatIban, isValidIban } from "../../shared/payment";
import type { AiState, Person, Tone } from "../../shared/types";
import { api, useApi } from "../api";
import { CardHead, SubmitButton, Switch, ToneSwatches } from "../components/Controls";
import { Icon } from "../components/Icon";
import { NotificationsCard } from "../components/Notifications";
import { PageHead } from "../components/Page";
import { useSortable } from "../components/Sortable";
import { useToast } from "../components/Toast";
import { isKiosk, useInstall } from "../device";
import { listIcon, listTone } from "../lists";
import { useSession } from "../session";

/**
 * Jouw naam, kleur en rekeningnummer (voor de betaal-QR bij Wie moet wie), je meldingen, de AI, de app, de volgorde
 * van je lijsten en een back-up. Je e-mailadres komt van je aanmelding.
 */
export function MePage() {
  const { person, lists, reloadMe } = useSession();
  const toast = useToast();
  const { canInstall, install } = useInstall();
  const [name, setName] = useState(person.name);
  const [color, setColor] = useState<Tone | null>(person.color);
  const [iban, setIban] = useState(person.iban ? formatIban(person.iban) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.put<Person>("/me", { name, color, iban });
      reloadMe();
      toast("Bewaard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHead
        title="Jouw gegevens"
        description={person.email ?? undefined}
        back={{ to: "/", label: "Overzicht" }}
        actions={
          canInstall && (
            <button type="button" className="btn btn-outline btn-sm" onClick={install}>
              <Icon name="download" size={15} /> App installeren
            </button>
          )
        }
      />
      <section className="card form-section">
        <label className="field">
          <span className="label">Naam</span>
          <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field">
          <span className="label">Kleur</span>
          <ToneSwatches value={color} onChange={setColor} />
        </div>
        <label className="field">
          <span className="label">Rekeningnummer</span>
          <input
            value={iban}
            maxLength={42}
            autoCapitalize="characters"
            placeholder="BE68 5390 0754 7034"
            aria-invalid={Boolean(iban.trim()) && !isValidIban(iban)}
            onChange={(e) => setIban(e.target.value)}
          />
        </label>
        {isKiosk && <p className="hint">Kioskmodus staat aan (uit met /?kiosk=0).</p>}
      </section>
      {error && <p className="error">{error}</p>}
      <SubmitButton busy={busy} className="btn btn-primary btn-lg">
        {busy ? "Opslaan…" : "Opslaan"}
      </SubmitButton>

      <NotificationsCard />
      <AiCard />
      {lists.filter((l) => !l.archived).length > 1 && <ListOrder />}
    </form>
  );
}

/** Lezen met AI: aan of uit voor jou, en hoe vaak vandaag. */
export function AiCard() {
  const { reloadMe } = useSession();
  const toast = useToast();
  const { data, mutate } = useApi<AiState>("/me/ai");
  async function set(on: boolean) {
    if (!data) return;
    mutate({ ...data, on });
    try {
      mutate(await api.put<AiState>("/me/ai", { on }));
      reloadMe();
      toast(on ? "Lezen met AI staat aan" : "Lezen met AI staat uit");
    } catch (err) {
      mutate(data);
      toast((err as Error).message, "alert");
    }
  }
  return (
    <section className="card">
      <CardHead title="AI" description={data?.on ? `Vandaag ${data.used} van ${data.limit} keer` : undefined} />
      <div className="card-body form">
        <Switch label="Lezen met AI" checked={data?.on ?? false} onChange={set} />
      </div>
    </section>
  );
}

/** Jouw volgorde van de lijsten (in de zijbalk en op het overzicht). */
function ListOrder() {
  const { lists, reloadMe } = useSession();
  const toast = useToast();
  const live = lists.filter((l) => !l.archived);
  const [order, setOrder] = useState(live.map((l) => l.id));
  const sortable = useSortable(
    order,
    async (ids) => {
      setOrder(ids);
      try {
        await api.put("/me/order", { ids });
        reloadMe();
      } catch (err) {
        toast((err as Error).message, "alert");
      }
    },
    (id) => lists.find((l) => l.id === id)?.name ?? "Lijst",
  );
  return (
    <section className="card">
      <CardHead title="Volgorde van je lijsten" />
      <ul className="rows sort-list">
        {order.map((id) => {
          const l = lists.find((x) => x.id === id);
          if (!l) return null;
          return (
            <li key={id} {...sortable.itemProps(id)}>
              <div className="row">
                <button {...sortable.handleProps(id)}>
                  <Icon name="grip" size={16} />
                </button>
                <span className="cell-main">
                  <span className={`row-media tone-${listTone(l)}`}>
                    <Icon name={listIcon(l)} size={16} />
                  </span>
                  <span className="row-title">{l.name}</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {sortable.status}
    </section>
  );
}
