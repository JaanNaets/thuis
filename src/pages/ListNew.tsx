import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { TEMPLATES, templateByKey, type ListTemplate } from "../../shared/catalog";
import { parseTemplateFile } from "../../shared/template-file";
import { api } from "../api";
import { SubmitButton } from "../components/Controls";
import { Icon, type IconName } from "../components/Icon";
import { PageHead } from "../components/Page";
import { TagChooser } from "../components/TagChooser";
import { useToast } from "../components/Toast";
import { useNavigate } from "../router";
import { useSession } from "../session";

/**
 * Een nieuwe lijst: kies een sjabloon (een lege lijst, een sjabloon of uit een bestand), een naam en tags. Met een tag die een regel
 * heeft (Jana altijd bij Huis), kan die persoon er meteen bij. `?tag=`: die tag staat al aan.
 */
export function ListNew() {
  const { tags, reloadMe } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [template, setTemplate] = useState<ListTemplate>(templateByKey(params.get("sjabloon")) ?? TEMPLATES[0]);
  const [name, setName] = useState("");
  const [tagIds, setTagIds] = useState<string[]>(() => (params.get("tag") ? [params.get("tag")!] : []));
  const [newTags, setNewTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  // Een sjabloon uit een bestand (Als sjabloon bij een andere lijst).
  const [fromFile, setFromFile] = useState<ListTemplate | null>(null);

  async function openFile(file: File) {
    setProblem(undefined);
    try {
      const t = parseTemplateFile(JSON.parse(await file.text()));
      setFromFile(t);
      setTemplate(t);
    } catch (err) {
      setProblem(err instanceof SyntaxError ? "Dit is geen sjabloon van Heystack." : (err as Error).message);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(undefined);
    try {
      const { id } = await api.post<{ id: string }>("/lists", {
        name: name.trim() || template.name,
        one: template.one,
        icon: template.icon,
        fields: template.fields,
        stock: template.stock ?? null,
        kinds: template.kinds ?? [],
        notify: template.notify ?? null,
        tag_ids: tagIds,
        new_tags: newTags,
      });
      reloadMe();
      toast(`${name.trim() || template.name} gemaakt`);
      navigate(`/lijsten/${id}`, { replace: true });
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form page" onSubmit={save}>
      <PageHead title="Nieuwe lijst" back={{ to: -1, label: "Terug" }} />
      <section className="card form-section">
        <div className="field">
          <span className="label">Sjabloon</span>
          <div className="template-picker" role="radiogroup" aria-label="Sjabloon">
            {[...(fromFile ? [fromFile] : []), ...TEMPLATES].map((t) => (
              <button key={t.key} type="button" role="radio" aria-checked={t.key === template.key} className="template-option" onClick={() => setTemplate(t)}>
                <span className="icon-tile">
                  <Icon name={t.icon as IconName} size={18} />
                </span>
                <span className="template-text">
                  <span className="template-title">{t.label ?? t.name}</span>
                </span>
              </button>
            ))}
            <label className="template-option">
              <span className="icon-tile">
                <Icon name="upload" size={18} />
              </span>
              <span className="template-text">
                <span className="template-title">Uit bestand</span>
              </span>
              <input type="file" accept=".json,application/json" hidden onChange={(e) => (e.target.files?.[0] && openFile(e.target.files[0]), (e.target.value = ""))} />
            </label>
          </div>
        </div>
        <label className="field">
          <span className="label">Naam</span>
          <input value={name} maxLength={60} placeholder={template.name} onChange={(e) => setName(e.target.value)} />
        </label>
      </section>
      <section className="card form-section">
        <TagChooser tags={tags} value={tagIds} onChange={setTagIds} fresh={newTags} onFresh={setNewTags} />
      </section>
      {problem && <p className="error">{problem}</p>}
      <SubmitButton busy={busy} className="btn btn-primary btn-lg">
        Lijst maken
      </SubmitButton>
    </form>
  );
}
