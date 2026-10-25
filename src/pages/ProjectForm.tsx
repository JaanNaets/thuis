import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { PROJECT_TEMPLATES, type TemplateKey } from "../../shared/fields";
import {
  PROJECT_SCOPES,
  UNITS,
  type ItemType,
  type Project,
  type ProjectDetail,
  type ProjectInput,
  type ProjectScope,
  type Taxonomy,
  type Tone,
  type Unit,
} from "../../shared/types";
import { api, useApi } from "../api";
import { Avatar, Segmented, SubmitButton, Switch, ToneSwatches } from "../components/Controls";
import { Icon } from "../components/Icon";
import { buildFields, FieldsEditor, fieldsDraft, type FieldDraft } from "../components/ProjectFields";
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
  const [scopes, setScopes] = useState<Record<string, ProjectScope>>(existing?.member_scopes ?? {});
  // Wat het project bijhoudt: een sjabloon zet alles klaar, daarna kan je alles aanpassen.
  const [template, setTemplate] = useState<TemplateKey>((existing?.template as TemplateKey | null) ?? "expenses");
  const [trackExpenses, setTrackExpenses] = useState(existing ? existing.track_expenses === 1 : true);
  const [trackItems, setTrackItems] = useState(existing ? existing.track_items === 1 : false);
  const [itemType, setItemType] = useState<ItemType>(existing?.item_type ?? "asset");
  const [itemUnit, setItemUnit] = useState<Unit>(existing?.item_unit ?? "stuk");
  const [fields, setFields] = useState<FieldDraft[]>(() => fieldsDraft(existing?.fields ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Wie mee kan doen: de bewoners, plus wie al in dit project zit (gasten).
  const candidates = taxonomy.members.filter((m) => m.active === 1 || existing?.member_ids.includes(m.id));
  const people = candidates.filter((m) => memberIds.includes(m.id));
  const budgetCents = budget.trim() ? parseEuro(budget) : null;

  const toggle = (id: string) => setMemberIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  function chooseTemplate(key: TemplateKey) {
    const t = PROJECT_TEMPLATES[key];
    setTemplate(key);
    setTrackExpenses(t.track_expenses);
    setTrackItems(t.track_items);
    setItemType(t.item_type);
    setItemUnit(t.unit);
    setFields(fieldsDraft(t.fields));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (Number.isNaN(budgetCents)) return setError("Het budget is niet geldig.");
    const built = buildDefaultSplit(split, people);
    if ("error" in built) return setError(built.error);
    const builtFields = trackItems ? buildFields(fields) : { fields: existing?.fields ?? [] };
    if ("error" in builtFields) return setError(builtFields.error);
    if (!trackExpenses && !trackItems) return setError("Kies wat je in dit project bijhoudt: uitgaven, dingen of allebei.");
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
      member_scopes: Object.fromEntries(memberIds.map((m) => [m, scopes[m] ?? "all"])),
      template: template === "expenses" ? null : template,
      track_expenses: trackExpenses ? 1 : 0,
      track_items: trackItems ? 1 : 0,
      item_type: trackItems ? itemType : null,
      item_unit: trackItems ? itemUnit : null,
      fields: builtFields.fields,
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

      {!existing && (
        <section className="card form-section">
          <div className="field">
            <span className="label">Soort project</span>
            <div className="template-picker" role="radiogroup" aria-label="Soort project">
              {(Object.keys(PROJECT_TEMPLATES) as TemplateKey[]).map((key) => {
                const t = PROJECT_TEMPLATES[key];
                return (
                  <button key={key} type="button" role="radio" aria-checked={template === key} className="template-option" onClick={() => chooseTemplate(key)}>
                    <span className="icon-tile">
                      <Icon name={t.icon} size={15} />
                    </span>
                    <span className="template-text">
                      <span className="template-title">{t.label}</span>
                      <span className="template-desc">{t.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="card form-section">
        <label className="field">
          <span className="label">Naam</span>
          <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={NAME_PLACEHOLDERS[template]} />
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
        {trackExpenses && (
          <label className="field">
            <span className="label">
              Budget <span className="optional">· optioneel</span>
            </span>
            <input
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="€ 0,00"
              aria-invalid={Number.isNaN(budgetCents)}
            />
          </label>
        )}
        <div className="field">
          <span className="label">Kleur</span>
          <ToneSwatches value={color} onChange={setColor} />
        </div>
      </section>

      <section className="card form-section">
        <Switch
          checked={trackExpenses}
          onChange={setTrackExpenses}
          label="Uitgaven"
          hint="Wie wat betaalde en hoe het verdeeld wordt, met een budget als je wil."
        />
        <Switch
          checked={trackItems}
          onChange={setTrackItems}
          label="Dingen"
          hint="Een verzameling met eigen velden, zoals wijnen of fietsen, en van wie elk ding is."
        />
        {trackItems && (
          <>
            <div className="field">
              <span className="label">Soort dingen</span>
              <Segmented
                label="Soort dingen"
                value={itemType}
                onChange={setItemType}
                options={[
                  { value: "consumable", label: "Raakt op" },
                  { value: "asset", label: "Blijft" },
                ]}
              />
              <span className="hint">
                {itemType === "consumable"
                  ? "Zoals wijn: je houdt bij hoeveel er nog is, en drinkt of gebruikt ze op."
                  : "Zoals fietsen: elk ding apart, met onderhoud en kosten. Ook te zien onder Bezit."}
              </span>
            </div>
            {itemType === "consumable" && (
              <label className="field">
                <span className="label">Per</span>
                <select value={itemUnit} onChange={(e) => setItemUnit(e.target.value as Unit)}>
                  {(Object.keys(UNITS) as Unit[]).map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <FieldsEditor value={fields} onChange={setFields} />
          </>
        )}
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
                  {m.access === "projects" && on ? (
                    <select
                      className="scope-select"
                      value={scopes[m.id] ?? "all"}
                      aria-label={`Wat ${m.name} ziet`}
                      onChange={(e) => setScopes((s) => ({ ...s, [m.id]: e.target.value as ProjectScope }))}
                    >
                      {(Object.keys(PROJECT_SCOPES) as ProjectScope[]).map((scope) => (
                        <option key={scope} value={scope}>
                          {PROJECT_SCOPES[scope].label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="split-share">{m.access === "projects" ? "gast" : ""}</span>
                  )}
                </div>
              );
            })}
          </div>
          <span className="hint">
            Iemand van buiten het huishouden (vrienden, familie) voeg je toe op de projectpagina. Een gast doet volledig mee, of ziet enkel zijn deel: de dingen
            waarvan die mee eigenaar is en de uitgaven waarin die deelt.
          </span>
        </div>

        {trackExpenses && (
          <Switch
            checked={separate}
            onChange={setSeparate}
            label="Eigen saldo"
            hint={
              separate ? "Wie wie moet, staat apart bij dit project (zoals een reis met vrienden)." : "De uitgaven tellen mee in het saldo van het huishouden."
            }
          />
        )}

        {trackExpenses && people.length > 1 && <DefaultSplitField people={people} value={split} onChange={setSplit} />}
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

const NAME_PLACEHOLDERS: Record<TemplateKey, string> = {
  expenses: "bv. Skireis 2027, Verbouwing badkamer",
  wine: "bv. Wijnkelder",
  bikes: "bv. Koersfietsen",
  custom: "bv. Platen, Strips, Gereedschap",
};
