import { useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import type { TemplateFile } from "../../shared/template-file";
import { PROJECT_TEMPLATES, type IconKey, type TemplateKey } from "../../shared/templates";
import type { NewProjectInput, Tone } from "../../shared/types";
import { api } from "../api";
import { SubmitButton, ToneSwatches } from "../components/Controls";
import { Icon, type IconName } from "../components/Icon";
import { IconPicker } from "../components/IconPicker";
import { PageHead } from "../components/Page";
import { readTemplateFile, templateText } from "../components/TemplateShare";
import { useToast } from "../components/Toast";
import { useNavigate } from "../router";
import { useSession } from "../session";

const NAME_PLACEHOLDERS: Record<TemplateKey, string> = {
  empty: "bv. Tuin, Auto, Verbouwing",
  household: "bv. Huishouden, Huis aan zee",
  wine: "bv. Wijnkelder",
  bikes: "bv. Koersfietsen",
  expenses: "bv. Skireis 2027, Verbouwing badkamer",
  food: "bv. Voeding, Wat ik eet",
  collection: "bv. Platen, Strips, Gereedschap",
};

/**
 * Een nieuw project, bovenaan of als subproject (?parent=). Een sjabloon zet lijsten met velden klaar (ook een
 * sjabloon dat iemand deelde, als bestand); daarna kan je alles aanpassen.
 */
export function ProjectNew() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { projects, reloadMe } = useSession();
  const parent = projects.find((p) => p.id === params.get("parent"));
  const [template, setTemplate] = useState<TemplateKey | "file">(parent ? "empty" : "household");
  const [file, setFile] = useState<TemplateFile>();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<IconKey | null>(PROJECT_TEMPLATES[parent ? "empty" : "household"].icon);
  const [color, setColor] = useState<Tone | null>("sky");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function choose(key: TemplateKey) {
    setTemplate(key);
    setIcon(PROJECT_TEMPLATES[key].icon);
  }

  // Een gedeeld sjabloon: naam, icoon, kleur en beschrijving komen eruit (je kan ze nog aanpassen).
  async function readFile(f: File | undefined) {
    if (!f) return;
    try {
      const t = await readTemplateFile(f);
      setFile(t);
      setTemplate("file");
      setName(t.project.name);
      setIcon(t.project.icon ?? "project");
      if (t.project.color) setColor(t.project.color);
      setDescription(t.project.description ?? "");
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (template === "file" && !file) return setError("Kies eerst een sjabloonbestand.");
    const input: NewProjectInput = {
      name,
      description: description || null,
      icon,
      color,
      parent_id: parent?.id ?? null,
      template: template === "file" ? null : template,
    };
    setBusy(true);
    setError(undefined);
    try {
      const { id } =
        template === "file" ? await api.post<{ id: string }>("/projects/import", { ...input, file }) : await api.post<{ id: string }>("/projects", input);
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
            <button
              type="button"
              role="radio"
              aria-checked={template === "file"}
              className="template-option"
              onClick={() => (file ? setTemplate("file") : fileRef.current?.click())}
            >
              <span className="icon-tile">
                <Icon name="upload" size={15} />
              </span>
              <span className="template-text">
                <span className="template-title">Uit een bestand</span>
                <span className="template-desc">{file ? file.project.name : "Een sjabloon dat iemand met je deelde (.thuis.json)"}</span>
              </span>
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              readFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {template === "file" && file ? (
            <div className="template-file">
              <span className="template-text">
                <span className="template-title">{file.project.name}</span>
                <span className="template-desc">{templateText(file)}</span>
              </span>
              <button type="button" className="link-button" onClick={() => fileRef.current?.click()}>
                Ander bestand
              </button>
            </div>
          ) : (
            <span className="hint">Een sjabloon zet lijsten met velden klaar. Je kan daarna alles aanpassen, toevoegen of weghalen.</span>
          )}
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
        placeholder={template === "file" ? file?.project.name : NAME_PLACEHOLDERS[template]}
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
