import { useRef, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router";
import { applyRuleDefaults } from "../../shared/rules";
import type { ItemDetail, ItemInput, ItemList, ItemTypeView, LabelScan, ProjectDetail, Tag } from "../../shared/types";
import { api, useApi } from "../api";
import { Segmented, SubmitButton } from "../components/Controls";
import { attributesDraft, buildAttributes, FieldInputs, fieldSuggestions, LabelScanner, type AttributeDraft } from "../components/Fields";
import { PageHead } from "../components/Page";
import { TagPicker } from "../components/TagPicker";
import { useToast } from "../components/Toast";
import { useNavigate } from "../router";
import { useSession } from "../session";

/** Velden die de app van een foto kan lezen (zie de API). */
const READABLE = ["text", "url", "email", "phone", "address", "number", "money", "date", "time", "year", "year_range", "select", "multi", "bool"];

/** /projecten/:id/nieuw?lijst= (nieuw) of /items/:itemId/bewerken. */
export function ItemFormPage() {
  const { id, itemId } = useParams();
  return itemId ? <EditItem itemId={itemId} /> : <WithProject projectId={id!} />;
}

function EditItem({ itemId }: { itemId: string }) {
  const { data: item, error } = useApi<ItemDetail>(`/items/${itemId}`);
  if (error) return <p className="error page">{error}</p>;
  if (!item) return null;
  if (item.access !== "edit" && !Object.values(item.field_access).includes("edit")) return <p className="error page">Dit item mag je enkel bekijken.</p>;
  return <WithProject projectId={item.project_id} item={item} />;
}

function WithProject({ projectId, item }: { projectId: string; item?: ItemDetail }) {
  const { data: p, error } = useApi<ProjectDetail>(`/projects/${projectId}`);
  const [params] = useSearchParams();
  // Kwam je via "Wijn toevoegen", dan ligt de lijst vast; anders kies je ze bovenaan (en dat blijft zo).
  const [choose] = useState(() => !item && !params.get("lijst"));
  if (error) return <p className="error page">{error}</p>;
  if (!p) return null;
  const creatable = p.types.filter((t) => t.can_create);
  const type = item ? p.types.find((t) => t.id === item.type_id) : (creatable.find((t) => t.id === params.get("lijst")) ?? creatable[0]);
  if (!type) return <p className="error page">{item ? "Dit item mag je niet bewerken." : "Je kan hier niets toevoegen."}</p>;
  return <ItemForm key={type.id} project={p} type={type} item={item} creatable={choose ? creatable : []} />;
}

function ItemForm({ project, type, item, creatable }: { project: ProjectDetail; type: ItemTypeView; item?: ItemDetail; creatable: ItemTypeView[] }) {
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const toast = useToast();
  const { person } = useSession();
  const { data: siblings } = useApi<ItemList>(`/projects/${project.project.id}/items?type=${type.id}`);
  const fields = type.fields;
  const people = project.members.map((m) => m.person);
  const editsType = type.access === "edit";
  // Een nieuw item begint met wat de regels invullen (bij een uitgave: jij betaalde, de gewone verdeling).
  const fresh = () =>
    attributesDraft(
      fields,
      applyRuleDefaults(
        type.rules,
        {},
        people.map((p) => p.id),
        person.id,
        true,
      ),
    );

  const [name, setName] = useState(item?.name ?? "");
  const [attrs, setAttrs] = useState<AttributeDraft>(() => (item ? attributesDraft(fields, item.data) : fresh()));
  const [tags, setTags] = useState<Tag[]>(project.tags);
  const [tagIds, setTagIds] = useState<string[]>(item?.tag_ids ?? []);
  const [auto, setAuto] = useState<Set<string>>(new Set());
  const [photo, setPhoto] = useState<File | null>(null);
  const touched = useRef(new Set<string>());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const readable = editsType && fields.some((f) => READABLE.includes(f.type) && type.field_access[f.key] === "edit");

  // Wat van het etiket gelezen werd, komt enkel in velden die je nog niet zelf invulde.
  function applyScan(scan: LabelScan, file: File) {
    setPhoto(file);
    if (scan.name && !touched.current.has("name")) setName(scan.name);
    const scanned = attributesDraft(fields, scan.data);
    const keys = Object.keys(scan.data).filter((k) => !touched.current.has(k));
    setAttrs((a) => ({ ...a, ...Object.fromEntries(keys.map((k) => [k, scanned[k]])) }));
    setAuto(new Set([...keys, ...(scan.name ? ["name"] : [])]));
  }

  async function onSubmit(e: FormEvent, next = false) {
    e.preventDefault();
    const built = buildAttributes(fields, attrs);
    if ("error" in built) return setError(built.error);
    const input: ItemInput = { type_id: type.id, name, data: built.data, tag_ids: tagIds };
    setSaving(true);
    setError(undefined);
    try {
      const saved = item ? await api.put<ItemDetail>(`/items/${item.id}`, input) : await api.post<ItemDetail>(`/projects/${project.project.id}/items`, input);
      if (photo) {
        const body = new FormData();
        body.set("file", photo);
        await api.put(`/items/${saved.id}/photo`, body).catch(() => toast("De foto kon niet bewaard worden", "alert"));
      }
      toast(item ? "Bijgewerkt" : `${saved.name} bewaard`);
      if (next) {
        // Opslaan en volgende: tags blijven, de rest is leeg (de volgende fles uit de kelder).
        setName("");
        setAttrs(fresh());
        setAuto(new Set());
        touched.current.clear();
        setPhoto(null);
        setSaving(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      navigate(`/items/${saved.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHead title={item ? `${item.name} bewerken` : `${type.name} toevoegen`} back={{ to: -1, label: item?.name ?? project.project.name }} />

      {creatable.length > 1 && creatable.length <= 4 && (
        <Segmented
          label="Lijst"
          value={type.id}
          onChange={(t) => setParams({ lijst: t }, { replace: true })}
          options={creatable.map((t) => ({ value: t.id, label: t.plural }))}
        />
      )}
      {creatable.length > 4 && (
        <label className="field">
          <span className="label">Lijst</span>
          <select value={type.id} onChange={(e) => setParams({ lijst: e.target.value }, { replace: true })}>
            {creatable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.plural}
              </option>
            ))}
          </select>
        </label>
      )}

      {!item && readable && (
        <section className="card form-section">
          <div className="field">
            <span className="label">Etiket</span>
            <span className="hint">Trek een foto van het etiket of typeplaatje: de app vult in wat erop staat, en bewaart de foto erbij.</span>
          </div>
          <LabelScanner projectId={project.project.id} typeId={type.id} onResult={applyScan} />
        </section>
      )}

      <section className="card form-section">
        <label className="field">
          <span className="label">{type.name_label ?? "Naam"}</span>
          <input
            required
            maxLength={200}
            disabled={!editsType}
            className={auto.has("name") ? "auto" : undefined}
            value={name}
            onChange={(e) => {
              touched.current.add("name");
              setAuto((a) => new Set([...a].filter((k) => k !== "name")));
              setName(e.target.value);
            }}
          />
        </label>
        {fields.length > 0 && (
          <FieldInputs
            defs={fields}
            value={attrs}
            access={type.field_access}
            people={people}
            meId={person.id}
            auto={auto}
            suggestions={fieldSuggestions(fields, siblings?.items ?? [])}
            onChange={(next, key) => {
              touched.current.add(key);
              setAuto((a) => (a.has(key) ? new Set([...a].filter((k) => k !== key)) : a));
              setAttrs(next);
            }}
          />
        )}
      </section>

      {editsType && (
        <section className="card form-section">
          <div className="field">
            <span className="label">Tags</span>
            <TagPicker
              tags={tags}
              value={tagIds}
              onChange={setTagIds}
              projectId={project.project.rights.create || project.project.rights.manage ? project.project.id : undefined}
              onCreated={(t) => setTags((list) => [...list, t])}
            />
          </div>
        </section>
      )}

      {error && <p className="error">{error}</p>}

      <div className="form-actions">
        <SubmitButton busy={saving} className="btn btn-primary btn-lg">
          {saving ? "Opslaan…" : "Opslaan"}
        </SubmitButton>
        {!item && (
          <button type="button" className="btn btn-outline btn-lg" disabled={saving} onClick={(e) => onSubmit(e, true)}>
            Opslaan en volgende
          </button>
        )}
      </div>
    </form>
  );
}
