import { useState, type FormEvent } from "react";
import type { Person, Tone } from "../../shared/types";
import { api } from "../api";
import { SubmitButton, ToneSwatches } from "../components/Controls";
import { PageHead } from "../components/Page";
import { useToast } from "../components/Toast";
import { isKiosk } from "../device";
import { useSession } from "../session";

/** Jouw naam en kleur. Je e-mailadres komt van je aanmelding. */
export function MePage() {
  const { person, projects, reloadMe } = useSession();
  const toast = useToast();
  const [name, setName] = useState(person.name);
  const [color, setColor] = useState<Tone | null>(person.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.put<Person>("/me", { name, color });
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
    </form>
  );
}
