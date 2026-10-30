import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router";
import { applyFieldDefaults, repeatData, type Attributes, type CodeValue } from "../../shared/fields";
import { isProductCode, productData, productLabel, type ProductInfo } from "../../shared/product";
import type { ItemDetail, ItemInput, ItemList, ItemTypeView, LabelScan, ProjectDetail, Tag } from "../../shared/types";
import { api, useApi } from "../api";
import { today } from "../format";
import { Segmented, SubmitButton } from "../components/Controls";
import { attributesDraft, buildAttributes, FieldInputs, fieldSuggestions, findProduct, LabelScanner, type AttributeDraft } from "../components/Fields";
import { PageHead } from "../components/Page";
import { TagPicker } from "../components/TagPicker";
import { useToast } from "../components/Toast";
import { useNavigate } from "../router";
import { useSession } from "../session";

/** Velden die de app van een foto kan lezen (zie de API). */
const READABLE = ["text", "url", "email", "phone", "address", "number", "money", "date", "time", "year", "year_range", "select", "multi", "bool", "item"];

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
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const { person } = useSession();
  const { data: siblings } = useApi<ItemList>(`/projects/${project.project.id}/items?type=${type.id}`);
  const fields = type.fields;
  const people = project.members.map((m) => m.person);
  const editsType = type.access === "edit";
  // Een nieuw item begint met wat de velden zelf invullen (bij een uitgave: jij betaalde, de gewone verdeling) en
  // met vandaag in een datum die zo ingesteld is.
  const fresh = () =>
    attributesDraft(
      fields,
      applyFieldDefaults(
        fields,
        Object.fromEntries(fields.filter((f) => f.today && type.field_access[f.key] === "edit").map((f) => [f.key, today()])),
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
  // Een gelezen PDF (bv. een factuur): die komt bij de bestanden van het item.
  const [original, setOriginal] = useState<File | null>(null);
  // Na een nieuw item in een andere lijst (een nieuwe winkel): de keuzelijsten opnieuw laden.
  const [refsVersion, setRefsVersion] = useState(0);
  const touched = useRef(new Set<string>());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const readable = editsType && fields.some((f) => READABLE.includes(f.type) && type.field_access[f.key] === "edit");
  // Een logboek (een datum die met vandaag begint, bv. Gewicht): de naam mag leeg ("Weging 30/10/2026").
  const logbook = fields.some((f) => f.type === "date" && f.today);
  // Velden uit productinfo (bv. kcal per 100 g): dan zoekt de app een barcode of een herkend product op.
  const products = editsType && fields.some((f) => f.product && type.field_access[f.key] === "edit");
  const looked = useRef<string>(undefined);

  // Opnieuw: een vorig item als begin (zie `repeatData`). Enkel velden die je nog niet zelf invulde; de rest zacht blauw.
  function applyFrom(source: { name: string; data: Attributes; tag_ids: string[] }, withName: boolean) {
    const data = applyFieldDefaults(
      fields,
      repeatData(fields, source.data, today()),
      people.map((p) => p.id),
      person.id,
      true,
    );
    const drafted = attributesDraft(fields, data);
    const keys = fields.filter((f) => f.type !== "calc" && type.field_access[f.key] === "edit" && !touched.current.has(f.key)).map((f) => f.key);
    setAttrs((a) => ({ ...a, ...Object.fromEntries(keys.map((k) => [k, drafted[k]])) }));
    const named = withName && !touched.current.has("name");
    setAuto(new Set([...keys.filter((k) => data[k] !== undefined), ...(named ? ["name"] : [])]));
    if (named) setName(source.name);
    if (!touched.current.has("tags")) setTagIds(source.tag_ids.filter((id) => tags.some((t) => t.id === id)));
  }

  // ?van= (de knop Opnieuw op een fiche): zodra de items van de lijst er zijn.
  const from = params.get("van");
  const applied = useRef(false);
  useEffect(() => {
    const source = from && !item ? siblings?.items.find((i) => i.id === from) : undefined;
    if (!source || applied.current) return;
    applied.current = true;
    applyFrom(source, true);
  }, [siblings, from]);

  // Een naam die al eens voorkwam: de laatste keer als voorstel (de nieuwste eerst, elke naam één keer).
  const earlier = useMemo(() => {
    const byName = new Map<string, NonNullable<typeof siblings>["items"][number]>();
    for (const i of [...(siblings?.items ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)))
      if (!byName.has(i.name.toLowerCase())) byName.set(i.name.toLowerCase(), i);
    return byName;
  }, [siblings]);

  // Productinfo (echte gegevens uit Open Food Facts) in de velden die je nog niet zelf invulde, en de barcode in een
  // barcodeveld als de lijst er een heeft.
  function applyProduct(info: ProductInfo, code: string | null, file: File | null) {
    if (file) setPhoto(file);
    looked.current = code ?? undefined;
    const data: Attributes = productData(fields, info);
    const codeField = code ? fields.find((f) => f.type === "code") : undefined;
    if (codeField && code) data[codeField.key] = { text: code, format: code.length === 8 ? "ean_8" : code.length === 12 ? "upc_a" : "ean_13" };
    const drafted = attributesDraft(fields, data);
    const keys = Object.keys(data).filter((k) => !touched.current.has(k) && type.field_access[k] === "edit");
    setAttrs((a) => ({ ...a, ...Object.fromEntries(keys.map((k) => [k, drafted[k]])) }));
    const named = !touched.current.has("name");
    if (named) setName(productLabel(info));
    setAuto((a) => new Set([...a, ...keys, ...(named ? ["name"] : [])]));
  }

  // Een barcode zelf getypt of gescand in een barcodeveld: meteen opzoeken (één keer per code).
  async function lookupCode(value: unknown) {
    const code = (value as CodeValue | null)?.text?.trim();
    if (!products || !code || !isProductCode(code) || looked.current === code) return;
    looked.current = code;
    const info = await findProduct(code).catch(() => null);
    if (info) {
      applyProduct(info, code, null);
      toast(`Gevonden in Open Food Facts: ${productLabel(info)}`);
    }
  }

  // Een naam van de foto die nog niet bestaat (bv. de winkel): toevoegen aan die lijst en meteen kiezen.
  async function createRef(s: NonNullable<LabelScan["create"]>[number]) {
    try {
      const created = await api.post<{ id: string }>(`/projects/${s.project_id}/items`, { type_id: s.type_id, name: s.name, data: {}, tag_ids: [] });
      setAttrs((a) => ({ ...a, [s.key]: created.id }));
      setAuto((a) => new Set([...a, s.key]));
      setRefsVersion((v) => v + 1);
      toast(`${s.name} toegevoegd aan ${s.plural}`);
      return true;
    } catch (err) {
      toast((err as Error).message, "alert");
      return false;
    }
  }

  // Wat van het etiket gelezen werd, komt enkel in velden die je nog niet zelf invulde.
  function applyScan(scan: LabelScan, file: File, pdf: File | null = null) {
    setPhoto(file);
    setOriginal(pdf);
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
      if (original) {
        const body = new FormData();
        body.set("file", original);
        await api.post(`/items/${saved.id}/files`, body).catch(() => toast("De PDF kon niet bewaard worden", "alert"));
      }
      toast(item ? "Bijgewerkt" : `${saved.name} bewaard`);
      if (next) {
        // Opslaan en volgende: tags blijven, de rest is leeg (de volgende fles uit de kelder).
        setName("");
        setAttrs(fresh());
        setAuto(new Set());
        touched.current.clear();
        looked.current = undefined;
        setPhoto(null);
        setOriginal(null);
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

      {!item && (readable || products) && (
        <section className="card form-section">
          <div className="field">
            <span className="label">{products ? "Product" : "Van een foto"}</span>
            <span className="hint">
              {products
                ? "Scan de barcode of trek een foto: de app zoekt het product op in Open Food Facts en vult de echte gegevens in. Niets gevonden? Dan leest ze de foto."
                : "Trek een foto van een etiket, kasticket, factuur of typeplaatje, of kies een PDF: de app vult in wat erop staat en bewaart het erbij."}
            </span>
          </div>
          <LabelScanner
            projectId={project.project.id}
            typeId={type.id}
            products={products}
            onResult={applyScan}
            onProduct={applyProduct}
            onCreate={createRef}
          />
        </section>
      )}

      <section className="card form-section">
        <label className="field">
          <span className="label">{type.name_label ?? "Naam"}</span>
          <input
            required={!logbook}
            maxLength={200}
            disabled={!editsType}
            className={auto.has("name") ? "auto" : undefined}
            placeholder={logbook ? `${type.name} ${today().split("-").reverse().join("/")}` : undefined}
            value={name}
            list={!item && earlier.size ? "eerder" : undefined}
            onChange={(e) => {
              touched.current.add("name");
              setAuto((a) => new Set([...a].filter((k) => k !== "name")));
              setName(e.target.value);
              // Een naam van eerder gekozen: de rest zoals de vorige keer.
              const before = !item && earlier.get(e.target.value.toLowerCase());
              if (before) applyFrom(before, false);
            }}
          />
          {!item && earlier.size > 0 && (
            <datalist id="eerder">
              {[...earlier.values()].slice(0, 50).map((i) => (
                <option key={i.id} value={i.name} />
              ))}
            </datalist>
          )}
          {!item && earlier.size > 0 && <span className="hint">Kies iets van eerder, dan vult de app de rest in zoals de vorige keer.</span>}
        </label>
        {fields.length > 0 && (
          <FieldInputs
            key={refsVersion}
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
              if (fields.find((f) => f.key === key)?.type === "code") lookupCode(next[key]);
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
              onChange={(next) => {
                touched.current.add("tags");
                setTagIds(next);
              }}
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
