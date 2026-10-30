import { useState, type FormEvent } from "react";
import { formatIban, isValidIban } from "../../shared/payment";
import type { Person, Tone } from "../../shared/types";
import { api } from "../api";
import { CardHead, SubmitButton, ToneSwatches } from "../components/Controls";
import { PageHead } from "../components/Page";
import { ProjectOrder } from "../components/ProjectOrder";
import { useToast } from "../components/Toast";
import { isKiosk } from "../device";
import { childrenOf } from "../projects";
import { useSession } from "../session";

/** Jouw naam en kleur (je e-mailadres komt van je aanmelding), en de volgorde van je projecten op het overzicht. */
export function MePage() {
  const { person, projects, reloadMe } = useSession();
  const toast = useToast();
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
      <PageHead title="Jouw gegevens" description={person.email ?? undefined} />
      <section className="card form-section">
        <label className="field">
          <span className="label">Naam</span>
          <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <span className="hint">Zo zien anderen je in hun projecten.</span>
        </label>
        <div className="field">
          <span className="label">Kleur</span>
          <ToneSwatches value={color} onChange={setColor} />
        </div>
        <label className="field">
          <span className="label">
            Rekeningnummer <span className="optional">· optioneel</span>
          </span>
          <input
            value={iban}
            maxLength={42}
            autoCapitalize="characters"
            placeholder="BE68 5390 0754 7034"
            aria-invalid={Boolean(iban.trim()) && !isValidIban(iban)}
            onChange={(e) => setIban(e.target.value)}
          />
          <span className="hint">Zo kan wie je nog moet, je terugbetalen met een betaal-QR. Enkel te zien voor wie met jou een project deelt.</span>
        </label>
        <div className="field">
          <span className="label">Aangemeld als</span>
          <span className="muted">{person.email}</span>
          <span className="hint">
            {projects.length === 1 ? "Je zit in 1 project." : `Je zit in ${projects.length} projecten.`}
            {isKiosk ? " Dit toestel staat in kioskmodus (zet uit met /?kiosk=0)." : ""}
          </span>
        </div>
      </section>
      {error && <p className="error">{error}</p>}
      <SubmitButton busy={busy} className="btn btn-primary btn-lg">
        {busy ? "Opslaan…" : "Opslaan"}
      </SubmitButton>

      {tops.length > 1 && (
        <section className="card">
          <CardHead title="Volgorde op je overzicht" description="Sleep aan de greep. Dit is enkel jouw volgorde; ze wordt meteen bewaard." />
          <ProjectOrder nodes={tops} />
        </section>
      )}
    </form>
  );
}
