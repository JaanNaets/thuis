import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router";
import { computeLocal } from "../../shared/calc";
import { applyFieldDefaults, cleanValue, formatFieldValue, repeatData, type AmountEntry, type Attributes, type CodeValue } from "../../shared/fields";
import type { QuickResult, Suggestion } from "../../shared/quickfill";
import { isProductCode, productData, productLabel, type ProductInfo } from "../../shared/product";
import type { ItemDetail, ItemInput, ItemList, ItemTypeView, LabelScan, ProjectDetail, Tag } from "../../shared/types";
import { api, useApi } from "../api";
import { today } from "../format";
import { Segmented, SubmitButton } from "../components/Controls";
import { attributesDraft, buildAttributes, FieldInputs, fieldSuggestions, findProduct, LabelScanner, type AttributeDraft } from "../components/Fields";
import { PageHead } from "../components/Page";
import type { QuickSource } from "../components/QuickInput";
import { useQuickFill } from "../components/useQuickFill";
import { TagPicker } from "../components/TagPicker";
import { useToast } from "../components/Toast";
import { useNavigate } from "../router";
import { enqueue, isOffline } from "../outbox";
import { prepareUpload } from "../image";
import { clearShared, sharedFile } from "../shared-file";
import { useSession } from "../session";

type Draft = AttributeDraft[string];
/** Wat er in een veld stond voor de tekst of een keuze er iets in zette. */
type Before = { value: Draft; auto: boolean };
type Live = { result: QuickResult | null; set: Record<string, Draft>; before: Record<string, Before>; name: string | null; nameBefore: Before | null };
const EMPTY_LIVE: Live = { result: null, set: {}, before: {}, name: null, nameBefore: null };
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
const ids = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
const options = (v: unknown) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
/** Velden waar ↑ en ↓ naar het vorige en volgende veld gaan (in andere doen ze al iets). */
const NAV_INPUTS = ["text", "email", "url", "tel", "search", "checkbox"];

/** Velden die de app van een foto kan lezen (zie de API). */
const READABLE = ["text", "url", "email", "phone", "address", "number", "money", "date", "time", "year", "year_range", "select", "multi", "bool", "item"];

/** /projecten/:id/nieuw?lijst= (nieuw) of /items/:itemId/bewerken. */
/** Hoeveelheden met `factor` (4 porties van een recept voor 2: ×2), op drie cijfers na de komma. */
const scaleAmounts = (list: AmountEntry[], factor: number): AmountEntry[] =>
  list.map((e) => (e.amount !== undefined ? { ...e, amount: Math.round(e.amount * factor * 1000) / 1000 } : e));

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

/** Het formulier voor een nieuw item in één vaste lijst (een icoon op je beginscherm, zie /snel/:id/:typeId). */
export function ItemFormFor({ projectId, typeId, notice }: { projectId: string; typeId: string; notice?: ReactNode }) {
  return <WithProject projectId={projectId} typeId={typeId} notice={notice} />;
}

function WithProject({ projectId, item, typeId, notice }: { projectId: string; item?: ItemDetail; typeId?: string; notice?: ReactNode }) {
  const { data: p, error } = useApi<ProjectDetail>(`/projects/${projectId}`);
  const [params] = useSearchParams();
  // Kwam je via "Wijn toevoegen", dan ligt de lijst vast; anders kies je ze bovenaan (en dat blijft zo).
  const wanted = typeId ?? params.get("lijst");
  const [choose] = useState(() => !item && !wanted);
  if (error) return <p className="error page">{error}</p>;
  if (!p) return null;
  const creatable = p.types.filter((t) => t.can_create);
  const type = item ? p.types.find((t) => t.id === item.type_id) : (creatable.find((t) => t.id === wanted) ?? creatable[0]);
  if (!type) return <p className="error page">{item ? "Dit item mag je niet bewerken." : "Je kan hier niets toevoegen."}</p>;
  return <ItemForm key={type.id} project={p} type={type} item={item} creatable={choose ? creatable : []} notice={notice} />;
}

function ItemForm({
  project,
  type,
  item,
  creatable,
  notice,
}: {
  project: ProjectDetail;
  type: ItemTypeView;
  item?: ItemDetail;
  creatable: ItemTypeView[];
  /** Iets onder de titel (bij een icoon op je beginscherm: hoe je het daar zet). */
  notice?: ReactNode;
}) {
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
        {
          ...Object.fromEntries(fields.filter((f) => f.today && type.field_access[f.key] === "edit").map((f) => [f.key, today()])),
          // Vanuit de agenda: de dag die je koos (?veld=datum&op=2026-11-03).
          ...Object.fromEntries(
            fields
              .filter((f) => f.key === params.get("veld") && f.type === "date" && type.field_access[f.key] === "edit" && /^\d{4}-\d{2}-\d{2}$/.test(params.get("op") ?? ""))
              .map((f) => [f.key, params.get("op")!]),
          ),
        },
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
  // Andere dingen op dezelfde foto (een bord met rijst, kip en broccoli): elk een eigen item, als het aangevinkt is.
  // `keys`: wat de foto invulde; die velden komen bij de andere dingen van hun eigen schatting, de rest (datum,
  // maaltijd, wie) zoals in het formulier.
  const [more, setMore] = useState<{ items: (NonNullable<LabelScan["more"]>[number] & { on: boolean })[]; keys: string[] }>({ items: [], keys: [] });
  // Na een nieuw item in een andere lijst (een nieuwe winkel): de keuzelijsten opnieuw laden.
  const [refsVersion, setRefsVersion] = useState(0);
  const touched = useRef(new Set<string>());
  // Overgenomen hoeveelheden en voor hoeveel porties ze waren (om mee te rekenen als je de porties aanpast).
  const scaleBase = useRef<Record<string, { amounts: AmountEntry[]; per: number }>>({});
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
    const keys = fields.filter((f) => f.type !== "calc" && type.field_access[f.key] === "edit" && !touched.current.has(f.key) && !(f.key in live.current.set)).map((f) => f.key);
    setAttrs((a) => ({ ...a, ...Object.fromEntries(keys.map((k) => [k, drafted[k]])) }));
    const named = withName && !touched.current.has("name");
    setAuto((a) => new Set([...a, ...keys.filter((k) => data[k] !== undefined), ...(named ? ["name"] : [])]));
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

  // Een naam die al eens voorkwam: de laatste keer als voorstel (de nieuwste eerst, elke naam één keer). Een naam die
  // de app zelf gaf in een logboek ("Weging 30/10/2026") telt niet mee.
  const { earlier, often } = useMemo(() => {
    const escaped = type.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const given = new RegExp(`^${escaped} \\d{2}/\\d{2}/\\d{4}$`, "i");
    const byName = new Map<string, NonNullable<typeof siblings>["items"][number]>();
    const count = new Map<string, number>();
    for (const i of [...(siblings?.items ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
      if (given.test(i.name)) continue;
      const key = i.name.toLowerCase();
      if (!byName.has(key)) byName.set(key, i);
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    // Vaak: wat je minstens twee keer toevoegde, het vaakst eerst (bij gelijkstand het laatst gebruikte).
    const often = [...byName.entries()]
      .filter(([key]) => count.get(key)! > 1)
      .sort(([a], [b]) => count.get(b)! - count.get(a)!)
      .slice(0, 6)
      .map(([, i]) => i);
    return { earlier: byName, often };
  }, [siblings, type.name]);

  // Neemt waarden over (`copy` op een verwijzing): de velden met dezelfde sleutel in het gekozen item, waar je nog niets
  // invulde (zacht blauw), en de naam als die nog leeg is. Wat niet past bij het veld hier, valt weg (`cleanValue`).
  async function copyFrom(id: string, via: string) {
    try {
      const source = await api.get<ItemDetail>(`/items/${id}`);
      const data: Attributes = {};
      for (const f of fields) {
        if (f.key === via || f.type === "calc" || type.field_access[f.key] !== "edit" || touched.current.has(f.key) || f.key in live.current.set) continue;
        const value = source.data[f.key];
        const clean = value === undefined ? null : cleanValue(f, value);
        if (clean !== null && clean !== undefined) data[f.key] = clean;
      }
      // Hoeveelheden voor zoveel porties (`per`): omrekenen naar de porties hier (staat er nog niets, dan die van daar).
      for (const f of fields) {
        const amounts = data[f.key];
        const per = f.per ? source.data[f.per] : undefined;
        if (f.type !== "amounts" || !Array.isArray(amounts) || typeof per !== "number" || per <= 0) continue;
        scaleBase.current[f.key] = { amounts: amounts as AmountEntry[], per };
        const here = Number(String(attrs[f.per!] ?? "").replace(",", "."));
        if (here > 0) {
          data[f.key] = scaleAmounts(amounts as AmountEntry[], here / per);
          delete data[f.per!];
        }
      }
      const drafted = attributesDraft(fields, data);
      setAttrs((a) => ({ ...a, ...Object.fromEntries(Object.keys(data).map((k) => [k, drafted[k]])) }));
      const named = !touched.current.has("name") && !name.trim();
      if (named) setName(source.name);
      setAuto((a) => new Set([...a, ...Object.keys(data), ...(named ? ["name"] : [])]));
    } catch {
      // Niet kunnen ophalen: dan vul je het zelf in.
    }
  }

  // Productinfo (echte gegevens uit Open Food Facts) in de velden die je nog niet zelf invulde, en de barcode in een
  // barcodeveld als de lijst er een heeft.
  function applyProduct(info: ProductInfo, code: string | null, file: File | null) {
    if (file) setPhoto(file);
    looked.current = code ?? undefined;
    const data: Attributes = productData(fields, info);
    const codeField = code ? fields.find((f) => f.type === "code") : undefined;
    if (codeField && code) data[codeField.key] = { text: code, format: code.length === 8 ? "ean_8" : code.length === 12 ? "upc_a" : "ean_13" };
    const drafted = attributesDraft(fields, data);
    const keys = Object.keys(data).filter((k) => !touched.current.has(k) && !(k in live.current.set) && type.field_access[k] === "edit");
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
  function applyScan(scan: LabelScan, file?: File, pdf: File | null = null) {
    if (file) {
      setPhoto(file);
      setOriginal(pdf);
    }
    if (!item) setMore({ items: (scan.more ?? []).map((m) => ({ ...m, on: true })), keys: Object.keys(scan.data) });
    if (scan.name && !touched.current.has("name")) setName(scan.name);
    const scanned = attributesDraft(fields, scan.data);
    // Wat je typte (live) of zelf invulde, wint.
    const keys = Object.keys(scan.data).filter((k) => !touched.current.has(k) && !(k in live.current.set));
    setAttrs((a) => ({ ...a, ...Object.fromEntries(keys.map((k) => [k, scanned[k]])) }));
    setAuto((a) => new Set([...a, ...keys, ...(scan.name ? ["name"] : [])]));
    rescale(scanned, keys);
  }

  // Een veld dat je zelf invult (of kiest terwijl je typt): het blijft staan, en wat erbij hoort, gebeurt (overnemen,
  // een barcode opzoeken, hoeveelheden meerekenen met de porties).
  function changeField(next: AttributeDraft, key: string) {
    setAttrs(next);
    fieldChanged(next, key);
  }

  /** Eén veld zetten (een keuze terwijl je typt), zonder wat intussen elders ingevuld werd te overschrijven. */
  function setField(key: string, value: Draft) {
    setAttrs((a) => ({ ...a, [key]: value }));
    fieldChanged({ ...latest.current.attrs, [key]: value }, key);
  }

  function fieldChanged(next: AttributeDraft, key: string) {
    const fresh = !touched.current.has(key);
    touched.current.add(key);
    // Zelf ingevuld: de code laat dat veld voortaan met rust (en een getal in je tekst gaat naar een ander veld).
    if (fresh) engine.refresh();
    setAuto((a) => (a.has(key) ? new Set([...a].filter((k) => k !== key)) : a));
    const def = fields.find((f) => f.key === key);
    if (def?.type === "code") lookupCode(next[key]);
    if (def?.type === "item" && def.copy && typeof next[key] === "string" && next[key]) copyFrom(next[key] as string, def.key);
    rescale(next, [key]);
  }

  // Andere porties (zelf getypt of ingevuld): de overgenomen hoeveelheden (een recept) rekenen mee, zolang je ze niet
  // zelf aanpaste.
  function rescale(next: AttributeDraft, changed: string[]) {
    for (const f of fields) {
      const base = scaleBase.current[f.key];
      if (f.type !== "amounts" || !f.per || !changed.includes(f.per) || !base || touched.current.has(f.key)) continue;
      const now = Number(String(next[f.per] ?? "").replace(",", "."));
      if (!(now > 0)) continue;
      setAttrs((a) => ({ ...a, [f.key]: scaleAmounts(base.amounts, now / base.per) }));
    }
  }

  // Keuzes terwijl je typt (zie QuickInput): uit de velden die je mag wijzigen, en de namen van eerder.
  const quick = useMemo<QuickSource>(
    () => ({
      fields: fields.filter((f) => f.type !== "calc" && type.field_access[f.key] === "edit"),
      people,
      names: [...earlier.values()].map((i) => i.name),
      nameLabel: type.name_label ?? "Naam",
    }),
    [fields, type, earlier, project.members],
  );

  // ---------- snel invullen: live, keuzes en verplaatsen (zie useQuickFill) ----------
  // Wat je typt in "Typ wat je weet", vult live in (met code, zonder AI). Wat de tekst invulde, staat in `live` samen
  // met wat er daarvoor stond: wis je het woord, dan komt dat terug. Wat je koos of naar een ander veld zette, telt als
  // zelf ingevuld (`chosen`: wat de keuze erin zette en wat er stond); wis je dat woord, dan komt ook daar terug wat
  // er stond. De AI leest je tekst enkel als je op ✨ drukt.
  const live = useRef<Live>(EMPTY_LIVE);
  const chosen = useRef(new Map<Suggestion, { set: Draft; before: Before }>());
  const quickRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // De laatste stand voor wat na een `await` gebeurt.
  const latest = useRef({ attrs, name, auto });
  latest.current = { attrs, name, auto };
  const defOf = (key: string) => fields.find((f) => f.key === key);
  const multiple = (key: string) => ["multi", "people", "items", "amounts"].includes(defOf(key)?.type ?? "");

  const engine = useQuickFill({
    fields: quick.fields,
    people,
    skip: [type.name, type.plural],
    nameLabel: type.name_label ?? "Naam",
    // ?tekst= (Toevoegen, een QR-sticker, een app op je beginscherm): meteen invullen.
    initial: item ? "" : (params.get("tekst") ?? ""),
    open: (f) => !touched.current.has(f.key),
    nameOpen: () => !touched.current.has("name"),
    canMoveTo: (key, list) => !touched.current.has(key) || list.some((p) => p.field === key),
    onResult: applyLive,
    onPick: applyPick,
    onUnpick: unpick,
  });

  // Een foto gedeeld vanuit een andere app (?foto=gedeeld, zie /delen): ze komt bij het item (een PDF als bestand), en
  // de AI leest ze enkel als je op ✨ Foto lezen tikt (in LabelScanner). Daarna is ze uit de cache weg.
  const [shared, setShared] = useState<File | null>(null);
  useEffect(() => {
    if (item || params.get("foto") !== "gedeeld") return;
    sharedFile().then(async (file) => {
      if (!file) return;
      clearShared();
      setShared(file);
      if (file.type === "application/pdf") setOriginal(file);
      else setPhoto(await prepareUpload(file).catch(() => file));
    });
  }, []);

  // Een nieuw item: meteen typen (en wat al getypt is, meteen invullen). Met een gedeelde foto niet: dan eerst de foto
  // (en geen toetsenbord of keuzelijst eroverheen).
  useEffect(() => {
    if (item) return;
    if (params.get("foto") !== "gedeeld") quickRef.current?.focus({ preventScroll: true });
    if (engine.note) engine.flush();
  }, []);

  // Geheugen (`remember`): een nieuw item begint met wat jij de vorige keer in die velden invulde, zacht blauw. Wat je
  // typt of zelf invult, wint.
  const remembers = !item && fields.some((f) => f.remember && type.field_access[f.key] === "edit");
  const { data: remembered } = useApi<{ data: Attributes }>(remembers ? `/projects/${project.project.id}/items/remembered?type=${type.id}` : null);
  const memory = useRef<Attributes | null>(null);
  useEffect(() => {
    if (!remembered || memory.current) return;
    memory.current = remembered.data;
    applyMemory(remembered.data);
  }, [remembered]);

  function applyMemory(data: Attributes) {
    const keys = Object.keys(data).filter((k) => defOf(k)?.remember && type.field_access[k] === "edit" && !touched.current.has(k) && !(k in live.current.set));
    if (!keys.length) return;
    const drafted = attributesDraft(fields, data);
    setAttrs((a) => ({ ...a, ...Object.fromEntries(keys.map((k) => [k, drafted[k]])) }));
    setAuto((a) => new Set([...a, ...keys]));
  }

  /** Na bewaren: wat je nu invulde, is het geheugen voor het volgende item. */
  function remember(data: Attributes) {
    if (!remembers) return;
    const kept = Object.fromEntries(Object.entries(data).filter(([k, v]) => defOf(k)?.remember && v !== null && v !== "" && !(Array.isArray(v) && !v.length)));
    memory.current = { ...(memory.current ?? {}), ...kept };
  }

  /** Een nieuwe lezing van je tekst live in de velden; wat er niet meer in staat, krijgt terug wat er stond. */
  function applyLive(result: QuickResult, list: Suggestion[]) {
    const { attrs: current, name: currentName, auto: currentAuto } = latest.current;
    const prev = live.current;
    const drafted = attributesDraft(fields, result.data);
    const set: Record<string, Draft> = {};
    const before = { ...prev.before };
    const patch: AttributeDraft = {};
    const on: string[] = [];
    const off: string[] = [];
    for (const k of Object.keys(prev.set)) {
      if (k in result.data && !touched.current.has(k)) continue;
      // Niet meer in de tekst: terug naar wat er stond (tenzij je het intussen zelf aanpaste).
      if (!touched.current.has(k) && same(current[k], prev.set[k])) {
        patch[k] = before[k].value;
        if (!before[k].auto) off.push(k);
      }
      delete before[k];
    }
    for (const k of Object.keys(result.data)) {
      if (touched.current.has(k) || !defOf(k)) continue;
      before[k] ??= { value: current[k], auto: currentAuto.has(k) };
      patch[k] = set[k] = drafted[k];
      on.push(k);
    }
    // De naam: wat overbleef, anders een gekozen item ("2 zakken Pellets" → Pellets).
    const fromPick = list.find((x) => defOf(x.field)?.type === "item")?.text ?? null;
    const liveName = touched.current.has("name") ? null : (result.name ?? fromPick);
    let nameBefore = prev.nameBefore;
    if (liveName !== null) {
      nameBefore ??= { value: currentName, auto: currentAuto.has("name") };
      if (liveName !== currentName) setName(liveName);
      on.push("name");
    } else if (prev.name !== null && !touched.current.has("name")) {
      if (currentName === prev.name) {
        setName(String(nameBefore?.value ?? ""));
        if (!nameBefore?.auto) off.push("name");
      }
      nameBefore = null;
    }
    live.current = { result, set, before, name: liveName, nameBefore };
    if (Object.keys(patch).length) setAttrs((a) => ({ ...a, ...patch }));
    setAuto((a) => {
      const next = new Set(a);
      for (const k of off) next.delete(k);
      for (const k of on) next.add(k);
      return next;
    });
    rescale({ ...current, ...patch }, Object.keys(patch));
  }

  /** Een keuze of verplaatste waarde in haar veld zetten, zoals zelf invullen. */
  function applyPick(s: Suggestion, list: Suggestion[]) {
    // Vaak: zoals de vorige keer (de naam en de rest; wat je zelf al invulde, blijft).
    if (s.repeat) {
      const source = siblings?.items.find((i) => i.id === s.repeat);
      if (source) {
        touched.current.delete("name");
        applyFrom(source, true);
      }
      return;
    }
    const { attrs: current, name: currentName, auto: a } = latest.current;
    // Een vorige keuze voor dit veld die nu vervangen wordt: wat er dáárvoor stond, komt terug bij het wissen.
    const replaced = list.find((p) => p.field === s.field && !multiple(s.field));
    const earlier = replaced ? chosen.current.get(replaced)?.before : undefined;
    if (s.field === "name") {
      const before = earlier ?? live.current.nameBefore ?? { value: currentName, auto: a.has("name") };
      touched.current.add("name");
      setAuto((x) => new Set([...x].filter((k) => k !== "name")));
      setName(s.text);
      latest.current.name = s.text;
      chosen.current.set(s, { set: s.text, before });
      return;
    }
    const def = defOf(s.field);
    if (!def) return;
    const now = current[def.key];
    let value: Draft;
    if (def.type === "items" || def.type === "people") value = [...new Set([...ids(now), String(s.value)])];
    else if (def.type === "amounts") value = [...(Array.isArray(now) ? (now as AmountEntry[]) : []), { item: String(s.value) }];
    else if (def.type === "multi") value = [...new Set([...options(now), String(s.value)])].join(", ");
    else value = attributesDraft([def], { [def.key]: s.value })[def.key];
    // Stond hier iets van de tekst, dan komt bij het wissen terug wat er dáárvoor stond.
    const before = earlier ?? live.current.before[def.key] ?? { value: now, auto: a.has(def.key) };
    delete live.current.set[def.key];
    delete live.current.before[def.key];
    setField(def.key, value);
    latest.current.attrs = { ...current, [def.key]: value };
    chosen.current.set(s, { set: value, before });
  }

  /** Een keuze die niet meer geldt: terug wat er stond, als het veld nog is wat de keuze erin zette. */
  function unpick(x: Suggestion) {
    const info = chosen.current.get(x);
    chosen.current.delete(x);
    if (!info) return;
    if (x.field === "name") {
      if (latest.current.name === x.text) setName(String(info.before.value ?? ""));
      touched.current.delete("name");
      return;
    }
    const def = defOf(x.field);
    if (!def) return;
    const now = latest.current.attrs[x.field];
    let value: Draft;
    if (def.type === "items" || def.type === "people") value = ids(now).filter((v) => v !== String(x.value));
    else if (def.type === "amounts") {
      const list = Array.isArray(now) ? (now as AmountEntry[]) : [];
      const at = list.findIndex((e) => e.item === String(x.value));
      value = at < 0 ? list : [...list.slice(0, at), ...list.slice(at + 1)];
    } else if (def.type === "multi") value = options(now).filter((v) => v !== String(x.value)).join(", ");
    else if (same(now, info.set)) value = info.before.value;
    else return;
    const emptied = !multiple(x.field) || same(value, info.before.value) || (Array.isArray(value) ? !value.length : !value);
    if (emptied) touched.current.delete(x.field);
    setAttrs((a) => ({ ...a, [x.field]: value }));
    latest.current.attrs = { ...latest.current.attrs, [x.field]: value };
    if (emptied && info.before.auto) setAuto((a) => new Set([...a, x.field]));
  }

  // Vaak: tik je in het lege invulveld, dan staan je meestgebruikte items klaar (zoals de vorige keer).
  const idle = useMemo<Suggestion[]>(
    () => (editsType && !item ? often.map((i) => ({ field: "name", label: "Vaak", text: i.name, value: i.name, repeat: i.id })) : []),
    [often, editsType, item],
  );

  function resetQuick() {
    engine.reset();
    chosen.current.clear();
    live.current = EMPTY_LIVE;
    requestAnimationFrame(() => quickRef.current?.focus({ preventScroll: true }));
  }

  /**
   * ✨ Lezen met AI: de tekst nog eens met code, en dan leest de AI ze helemaal. Wat de tekst of jij al invulde, blijft;
   * de AI zet een gekozen item niet in een ander veld.
   */
  async function aiText(text: string): Promise<{ message?: string; create?: LabelScan["create"] }> {
    const result = await engine.flush();
    if (!result) return {};
    const ai = await api.post<LabelScan>(`/projects/${project.project.id}/items/read`, { type_id: type.id, text, today: today() });
    const picked = new Set(engine.latest().picks.map((x) => String(x.value)));
    const data = Object.fromEntries(
      Object.entries(ai.data).filter(([k, v]) => !(k in result.data) && !touched.current.has(k) && !(typeof v === "string" && picked.has(v))),
    );
    applyScan({ ...ai, data, name: touched.current.has("name") || result.name ? null : ai.name });
    const found = Object.keys(data).length + Object.keys(result.data).length + (ai.name || result.name ? 1 : 0);
    return { message: ai.message ?? (found ? undefined : "Niets herkend. Vul het zelf in."), create: ai.create };
  }

  /** Ctrl/⌘ + Enter: wat je nog typte eerst invullen, dan opslaan. */
  async function saveNow() {
    if (engine.pending()) await engine.flush();
    requestAnimationFrame(() => formRef.current?.requestSubmit());
  }

  /**
   * Door het formulier met de pijltjes: ↓ naar het volgende veld, ↑ naar het vorige, vanuit een tekst- of getalveld,
   * een schakelaar of een keuzeveld zonder open keuzes. In een datum, uur, keuzelijst of lange tekst doen de pijltjes
   * wat ze daar al doen.
   */
  function onFormKey(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveNow();
      return;
    }
    if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || !NAV_INPUTS.includes(el.type) || el.getAttribute("aria-expanded") === "true") return;
    const all = [...e.currentTarget.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea")].filter(
      (x) => !x.disabled && x.type !== "hidden" && x.type !== "file" && x.offsetParent !== null,
    );
    const next = all[all.indexOf(el) + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      e.preventDefault();
      next.focus();
    }
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
      const others = item ? [] : more.items.filter((m) => m.on);
      for (const m of others) {
        const own = new Set([...more.keys, ...Object.keys(m.data)]);
        const shared = Object.fromEntries(Object.entries(built.data).filter(([k]) => !own.has(k)));
        await api.post(`/projects/${project.project.id}/items`, { ...input, name: m.name, data: { ...shared, ...m.data } });
      }
      setMore({ items: [], keys: [] });
      toast(item ? "Bijgewerkt" : others.length ? `${saved.name} en ${others.length === 1 ? others[0].name : `${others.length} andere`} bewaard` : `${saved.name} bewaard`);
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
        resetQuick();
        remember(built.data);
        if (memory.current) applyMemory(memory.current);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      navigate(`/items/${saved.id}`, { replace: true });
    } catch (err) {
      // Geen internet: een nieuw item wacht op dit toestel en gaat mee zodra er internet is (zie outbox.ts).
      if (!item && isOffline(err)) {
        await enqueue(project.project.id, input, photo);
        toast("Bewaard op dit toestel; het gaat mee zodra je internet hebt");
        if (!next) return navigate(`/projecten/${project.project.id}?lijst=${type.id}`, { replace: true });
        setName("");
        setAttrs(fresh());
        setAuto(new Set());
        touched.current.clear();
        setPhoto(null);
        setOriginal(null);
        setSaving(false);
        resetQuick();
        remember(built.data);
        if (memory.current) applyMemory(memory.current);
        return;
      }
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form ref={formRef} className="form page" onSubmit={onSubmit} onKeyDown={onFormKey}>
      <PageHead title={item ? `${item.name} bewerken` : `${type.name} toevoegen`} back={{ to: -1, label: item?.name ?? project.project.name }} />
      {notice}

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
            <span className="label">{products ? "Product" : "Snel invullen"}</span>
          </div>
          <LabelScanner
            projectId={project.project.id}
            typeId={type.id}
            products={products}
            onResult={applyScan}
            onProduct={applyProduct}
            onCreate={createRef}
            onAi={aiText}
            onFlush={() => engine.flush()}
            quick={quick}
            onPick={engine.pick}
            note={engine.note}
            onNote={engine.change}
            moves={engine.moves}
            onTab={engine.tab}
            chips={engine.chips}
            onMove={engine.move}
            onRemove={engine.remove}
            idle={idle}
            inputRef={quickRef}
            initial={shared}
          />
          {more.items.length > 0 && <MoreOnPhoto fields={fields} more={more.items} onToggle={(i, on) => setMore((m) => ({ ...m, items: m.items.map((x, k) => (k === i ? { ...x, on } : x)) }))} />}
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
            onChange={changeField}
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

/** Andere dingen op dezelfde foto: aanvinken wat er als eigen item bij moet (met hun geschatte hoeveelheid). */
function MoreOnPhoto({
  fields,
  more,
  onToggle,
}: {
  fields: ItemTypeView["fields"];
  more: (NonNullable<LabelScan["more"]>[number] & { on: boolean })[];
  onToggle: (index: number, on: boolean) => void;
}) {
  // Wat er per ding toe doet: de hoeveelheid (een getal dat niet uit productinfo komt) en de kolommen (bv. de kcal).
  const shown = fields.filter((f) => f.column || (f.type === "number" && !f.product));
  return (
    <div className="field">
      <span className="label">Ook op de foto</span>
      <ul className="receipt-lines">
        {more.map((m, i) => {
          const data = computeLocal(fields, m.data);
          const summary = shown
            .filter((f) => data[f.key] !== undefined)
            .map((f) => formatFieldValue(f, data[f.key]))
            .join(" · ");
          return (
            <li key={`${m.name}-${i}`} data-off={!m.on}>
              <label className="receipt-line-check">
                <input type="checkbox" checked={m.on} onChange={(e) => onToggle(i, e.target.checked)} />
                <span>
                  <span className="receipt-line-name">{m.name}</span>
                  {summary && <span className="hint">{summary}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
