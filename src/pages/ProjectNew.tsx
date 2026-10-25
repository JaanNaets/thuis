import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { PROJECT_TEMPLATES, type IconKey, type TemplateKey } from "../../shared/templates";
import type { NewProjectInput, Tone } from "../../shared/types";
import { api } from "../api";
import { SubmitButton, ToneSwatches } from "../components/Controls";
import { Icon, type IconName } from "../components/Icon";
import { IconPicker } from "../components/IconPicker";
import { PageHead } from "../components/Page";
import { useToast } from "../components/Toast";
import { useNavigate } from "../router";
import { useSession } from "../session";

const NAME_PLACEHOLDERS: Record<TemplateKey, string> = {
  empty: "bv. Tuin, Auto, Verbouwing",
  household: "bv. Huishouden, Huis aan zee",
  wine: "bv. Wijnkelder",
  bikes: "bv. Koersfietsen",
  expenses: "bv. Skireis 2027, Verbouwing badkamer",
  collection: "bv. Platen, Strips, Gereedschap",
};

/**
 * Een nieuw project, bovenaan of als subproject (?parent=). Een sjabloon zet soorten met velden klaar;
 * daarna kan je alles aanpassen.
 */
export function ProjectNew() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { projects, reloadMe } = useSession();
  const parent = projects.find((p) => p.id === params.get("parent"));
  const [template, setTemplate] = useState<TemplateKey>(parent ? "empty" : "household");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<IconKey | null>(PROJECT_TEMPLATES[template].icon);
  const [color, setColor] = useState<Tone | null>("sky");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function choose(key: TemplateKey) {
    setTemplate(key);
    setIcon(PROJECT_TEMPLATES[key].icon);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const input: NewProjectInput = { name, description: description || null, icon, color, parent_id: parent?.id ?? null, template };
    setBusy(true);
    setError(undefined);
    try {
      const { id } = await api.post<{ id: string }>("/projects", input);
      reloadMe();
      toast(`${name} aangemaakt`);
      navigate(`/projecten/${id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHead title={parent ? "Nieuw subproject" : "Nieuw project"} back={{ to: -1, label: parent?.name ?? "Overzicht" }} />

      <section className="card form-section">
        <div className="field">
          <span className="label">Beginnen met</span>
          <div className="template-picker" role="radiogroup" aria-label="Beginnen met">
            {(Object.keys(PROJECT_TEMPLATES) as TemplateKey[]).map((key) => {
              const t = PROJECT_TEMPLATES[key];
              return (
                <button key={key} type="button" role="radio" aria-checked={template === key} className="template-option" onClick={() => choose(key)}>
                  <span className="icon-tile">
                    <Icon name={t.icon as IconName} size={15} />
                  </span>
                  <span className="template-text">
                    <span className="template-title">{t.label}</span>
                    <span className="template-desc">{t.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <span className="hint">Een sjabloon zet soorten met velden klaar. Je kan daarna alles aanpassen, toevoegen of weghalen.</span>
        </div>
      </section>

      <ProjectFieldsCard
        name={name}
        onName={setName}
        icon={icon}
        onIcon={setIcon}
        color={color}
        onColor={setColor}
        description={description}
        onDescription={setDescription}
        placeholder={NAME_PLACEHOLDERS[template]}
      />

      {parent && <p className="hint">Wie in {parent.name} zit, zit ook in dit subproject, met dezelfde rol. Je kan dat per persoon aanpassen.</p>}
      {error && <p className="error">{error}</p>}

      <SubmitButton busy={busy} className="btn btn-primary btn-lg">
        {busy ? "Aanmaken…" : "Aanmaken"}
      </SubmitButton>
    </form>
  );
}

/** Naam, icoon, kleur en beschrijving van een project (bij aanmaken en in de instellingen). */
export function ProjectFieldsCard(props: {
  name: string;
  onName: (v: string) => void;
  icon: IconKey | null;
  onIcon: (v: IconKey) => void;
  color: Tone | null;
  onColor: (v: Tone) => void;
  description: string;
  onDescription: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <section className="card form-section">
      <label className="field">
        <span className="label">Naam</span>
        <input required maxLength={80} value={props.name} onChange={(e) => props.onName(e.target.value)} placeholder={props.placeholder} />
      </label>
      <div className="field">
        <span className="label">Icoon</span>
        <IconPicker value={props.icon} onChange={props.onIcon} />
      </div>
      <div className="field">
        <span className="label">Kleur</span>
        <ToneSwatches value={props.color} onChange={props.onColor} />
      </div>
      <label className="field">
        <span className="label">
          <Icon name="note" size={15} /> Beschrijving <span className="optional">· optioneel</span>
        </span>
        <textarea
          rows={3}
          maxLength={2000}
          value={props.description}
          onChange={(e) => props.onDescription(e.target.value)}
          placeholder="Waarover gaat dit project"
        />
      </label>
    </section>
  );
}
