import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import type { Project, ProjectDetail, ProjectInput, Taxonomy, Tone } from "../../shared/types";
import { api, useApi } from "../api";
import { Avatar, SubmitButton, Switch, ToneSwatches } from "../components/Controls";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/Page";
import { buildDefaultSplit, defaultSplitDraft, DefaultSplitField } from "../components/SplitEditor";
import { useToast } from "../components/Toast";
import { centsToInput, parseEuro } from "../format";
import { useNavigate } from "../router";
import { activeMembers, refreshTaxonomy, useTaxonomy } from "../taxonomy";

export function ProjectFormPage() {
  const { id } = useParams();
  const { data: taxonomy, error } = useTaxonomy();
  if (error && !taxonomy) return <p className="error page">{error}</p>;
  if (!taxonomy) return null;
  if (!id) return <ProjectForm taxonomy={taxonomy} />;
  return <EditProject id={id} taxonomy={taxonomy} />;
}

function EditProject({ id, taxonomy }: { id: string; taxonomy: Taxonomy }) {
  const { data, error } = useApi<ProjectDetail>(`/projects/${id}`);
  if (error) return <p className="error page">{error}</p>;
  if (!data) return null;
  return <ProjectForm existing={data} taxonomy={taxonomy} />;
}

function ProjectForm({ existing, taxonomy }: { existing?: Project; taxonomy: Taxonomy }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [color, setColor] = useState<Tone>(existing?.color ?? "sky");
  const [startOn, setStartOn] = useState(existing?.start_on ?? "");
  const [endOn, setEndOn] = useState(existing?.end_on ?? "");
  const [budget, setBudget] = useState(existing?.budget_cents ? centsToInput(existing.budget_cents) : "");
  const [separate, setSeparate] = useState(existing ? existing.separate_balance === 1 : true);
  // Nieuw: alle bewoners doen mee. Gasten komen erbij op de projectpagina.
  const [memberIds, setMemberIds] = useState<string[]>(existing?.member_ids ?? activeMembers(taxonomy).map((m) => m.id));
  const [split, setSplit] = useState(() => defaultSplitDraft(existing?.default_split ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Wie mee kan doen: de bewoners, plus wie al in dit project zit (gasten).
  const candidates = taxonomy.members.filter((m) => m.active === 1 || existing?.member_ids.includes(m.id));
  const people = candidates.filter((m) => memberIds.includes(m.id));
  const budgetCents = budget.trim() ? parseEuro(budget) : null;

  const toggle = (id: string) => setMemberIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (Number.isNaN(budgetCents)) return setError("Het budget is niet geldig.");
    const built = buildDefaultSplit(split, people);
    if ("error" in built) return setError(built.error);
    const input: ProjectInput = {
      name,
      description: description || null,
      color,
      start_on: startOn || null,
      end_on: endOn || null,
      budget_cents: budgetCents,
      separate_balance: separate ? 1 : 0,
      default_split: built.split,
      member_ids: memberIds,
    };
    setBusy(true);
    setError(undefined);
    try {
      const saved = existing ? await api.put<{ id: string }>(`/projects/${existing.id}`, input) : await api.post<{ id: string }>("/projects", input);
      await refreshTaxonomy();
      toast(existing ? "Project bijgewerkt" : "Project aangemaakt");
      navigate(`/projecten/${saved.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHead title={existing ? "Project bewerken" : "Nieuw project"} back={{ to: -1, label: existing ? existing.name : "Projecten" }} />

      <section className="card form-section">
        <label className="field">
          <span className="label">Naam</span>
          <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="bv. Skireis 2027, Verbouwing badkamer" />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="label">
              Van <span className="optional">· optioneel</span>
            </span>
            <input type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Tot</span>
            <input type="date" value={endOn} min={startOn || undefined} onChange={(e) => setEndOn(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="label">
            Budget <span className="optional">· optioneel</span>
          </span>
          <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="€ 0,00" aria-invalid={Number.isNaN(budgetCents)} />
        </label>
        <div className="field">
          <span className="label">Kleur</span>
          <ToneSwatches value={color} onChange={setColor} />
        </div>
      </section>

      <section className="card form-section">
        <div className="field">
          <span className="label">Wie doet mee</span>
          <div className="split-rows">
            {candidates.map((m) => {
              const on = memberIds.includes(m.id);
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
                  <span className="split-name">{m.id === taxonomy.me.id ? `${m.name} (ik)` : m.name}</span>
                  <span className="split-share">{m.access === "projects" ? "gast" : ""}</span>
                </div>
              );
            })}
          </div>
          <span className="hint">Iemand van buiten het huishouden (vrienden, familie) voeg je toe op de projectpagina.</span>
        </div>

        <Switch
          checked={separate}
          onChange={setSeparate}
          label="Eigen saldo"
          hint={
            separate ? "Wie wie moet, staat apart bij dit project (zoals een reis met vrienden)." : "De uitgaven tellen mee in het saldo van het huishouden."
          }
        />

        {people.length > 1 && <DefaultSplitField people={people} value={split} onChange={setSplit} />}
      </section>

      <section className="card form-section">
        <label className="field">
          <span className="label">
            <Icon name="note" size={15} /> Notitie
          </span>
          <textarea
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Afspraken, adres van het chalet, …"
          />
        </label>
      </section>

      {error && <p className="error">{error}</p>}

      <SubmitButton busy={busy} className="btn btn-primary btn-lg">
        {busy ? "Opslaan…" : "Opslaan"}
      </SubmitButton>
    </form>
  );
}
