import { useState, type FormEvent } from "react";
import { formatIban, isValidIban } from "../../shared/payment";
import type { Person, Tone } from "../../shared/types";
import { api } from "../api";
import { CardHead, SubmitButton, ToneSwatches } from "../components/Controls";
import { Icon } from "../components/Icon";
import { NotificationsCard } from "../components/Notifications";
import { PageHead } from "../components/Page";
import { ProjectOrder } from "../components/ProjectOrder";
import { useToast } from "../components/Toast";
import { isKiosk, useInstall } from "../device";
import { childrenOf } from "../projects";
import { useSession } from "../session";

/**
 * Jouw naam, kleur en rekeningnummer (voor de betaal-QR, enkel te zien voor wie met jou een project deelt), je
 * meldingen en de volgorde van je projecten op het overzicht. Je e-mailadres komt van je aanmelding. Biedt de
 * browser het aan, dan staat bovenaan een knop om de app te installeren.
 */
export function MePage() {
  const { person, projects, reloadMe } = useSession();
  const toast = useToast();
  const { canInstall, install } = useInstall();
  const [name, setName] = useState(person.name);
  const [color, setColor] = useState<Tone | null>(person.color);
  const [iban, setIban] = useState(person.iban ? formatIban(person.iban) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const tops = childrenOf(
    projects.filter((p) => !p.archived),
    null,
  );

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

      {tops.length > 1 && (
        <section className="card">
          <CardHead title="Volgorde op je overzicht" />
          <ProjectOrder nodes={tops} />
        </section>
      )}
    </form>
  );
}
