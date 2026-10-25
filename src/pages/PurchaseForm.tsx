import { useRef, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router";
import { useNavigate } from "../router";
import type { ReceiptGuess, ReceiptReadResult } from "../../shared/receipt";
import { LINK_ROLES, UNITS, type ItemDetail, type LinkRole, type Purchase, type PurchaseDetail, type PurchaseInput, type Taxonomy } from "../../shared/types";
import { api, apiUrl, useApi } from "../api";
import { Alert, QuantityField, SubmitButton, Switch, TreeSelect, type AlertTone } from "../components/Controls";
import { FilePicker } from "../components/FilePicker";
import { Icon } from "../components/Icon";
import { itemPath, rolesFor } from "../components/ItemLinks";
import { PageHead } from "../components/Page";
import { buildSplit, initialSplitState, SplitEditor, type SplitState } from "../components/SplitEditor";
import { TagPicker } from "../components/TagPicker";
import { useToast } from "../components/Toast";
import { VendorField } from "../components/VendorField";
import { addYears, centsToInput, parseEuro, parseQuantity, today } from "../format";
import { prepareUpload } from "../image";
import { addPerson } from "../people";
import { readReceipt } from "../receipt";
import { useSession } from "../session";
import { categoryTree, splitCandidates, useTaxonomy } from "../taxonomy";

// Wettelijke garantie in België is 2 jaar; daarom de standaard.
const WARRANTY_OPTIONS = [
  { value: "2", label: "2 jaar (wettelijk)" },
  { value: "1", label: "1 jaar" },
  { value: "3", label: "3 jaar" },
  { value: "5", label: "5 jaar" },
  { value: "none", label: "Geen garantie" },
  { value: "custom", label: "Andere datum…" },
];

type FormState = {
  description: string;
  vendor: string;
  purchased_on: string;
  amount: string;
  category_id: string | null;
  warranty: string;
  warranty_custom: string;
  notes: string;
  project_id: string | null;
  tag_ids: string[];
};

type ReadState = { state: "busy" } | { state: "done"; result: ReceiptReadResult } | { state: "error"; message: string };

/** Welke formuliervelden we kunnen invullen vanuit een gelezen ticket. */
function guessToFields(g: ReceiptGuess, taxonomy: Taxonomy | undefined): Partial<FormState> {
  const fields: Partial<FormState> = {};
  if (g.description) fields.description = g.description;
  if (g.store) fields.vendor = g.store;
  if (g.amount_cents !== null) fields.amount = centsToInput(g.amount_cents);
  if (g.purchased_on) fields.purchased_on = g.purchased_on;
  const category = taxonomy?.categories.find((c) => c.domain === "expense" && c.name.toLowerCase() === g.category?.toLowerCase());
  if (category) fields.category_id = category.id;
  return fields;
}

function readMessage(read: ReadState): { text: string; tone: AlertTone } {
  if (read.state === "busy") return { text: "Ticket lezen", tone: "busy" };
  if (read.state === "error") return { text: read.message, tone: "none" };
  const { result } = read;
  if (result.complete) {
    return {
      text: result.source === "ai" ? "Ingevuld uit de foto. Kijk het even na." : "Ingevuld uit de PDF. Kijk het even na.",
      tone: "ok",
    };
  }
  if (Object.values(result.guess).some((v) => v !== null)) {
    return { text: result.message ?? "Niet alles kon gelezen worden. Vul de rest aan.", tone: "partial" };
  }
  return { text: result.message ?? "Dit ticket kon niet gelezen worden. Vul het zelf in.", tone: "none" };
}

function initialWarranty(p: Purchase): Pick<FormState, "warranty" | "warranty_custom"> {
  if (!p.warranty_until) return { warranty: "none", warranty_custom: "" };
  for (const years of ["1", "2", "3", "5"]) {
    if (addYears(p.purchased_on, Number(years)) === p.warranty_until) {
      return { warranty: years, warranty_custom: "" };
    }
  }
  return { warranty: "custom", warranty_custom: p.warranty_until };
}

function toFormState(p: PurchaseDetail | undefined, projectId: string | null): FormState {
  if (!p) {
    return {
      description: "",
      vendor: "",
      purchased_on: today(),
      amount: "",
      category_id: null,
      // Garantie is de uitzondering: pas als je ze toevoegt, stelt de app 2 jaar voor.
      warranty: "none",
      warranty_custom: "",
      notes: "",
      project_id: projectId,
      tag_ids: [],
    };
  }
  return {
    description: p.description,
    vendor: p.vendor_name ?? "",
    purchased_on: p.purchased_on,
    amount: centsToInput(p.amount_cents),
    category_id: p.category_id,
    ...initialWarranty(p),
    notes: p.notes ?? "",
    project_id: p.project_id,
    tag_ids: p.tag_ids,
  };
}

export function PurchaseFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { data: taxonomy, error } = useTaxonomy();
  if (error && !taxonomy) return <p className="error page">{error}</p>;
  if (!taxonomy) return null;
  if (id) return <EditPurchase id={id} taxonomy={taxonomy} />;
  const itemId = params.get("ding");
  if (itemId) return <PurchaseForItem itemId={itemId} taxonomy={taxonomy} />;
  return <PurchaseForm taxonomy={taxonomy} />;
}

/** Vanaf een ding ("Kost toevoegen", "Bijgekocht"): de uitgave wordt er na het bewaren aan gekoppeld. */
function PurchaseForItem({ itemId, taxonomy }: { itemId: string; taxonomy: Taxonomy }) {
  const { data, error } = useApi<ItemDetail>(`/items/${itemId}`);
  if (error) return <p className="error page">{error}</p>;
  if (!data) return null;
  return <PurchaseForm taxonomy={taxonomy} forItem={data} />;
}

function EditPurchase({ id, taxonomy }: { id: string; taxonomy: Taxonomy }) {
  const { data, error } = useApi<PurchaseDetail>(`/purchases/${id}`);
  if (error) return <p className="error page">{error}</p>;
  if (!data) return null;
  return <PurchaseForm existing={data} taxonomy={taxonomy} />;
}

/** Wie al in de uitgave staat, blijft erbij, ook als die intussen niet meer meedoet. */
function usedBy(existing?: PurchaseDetail): string[] {
  return existing ? [...existing.payments.flatMap((p) => (p.member_id ? [p.member_id] : [])), ...existing.shares.map((s) => s.member_id)] : [];
}

type ForItem = { role: LinkRole; quantity: string; addStock: boolean };

function PurchaseForm({ existing, taxonomy, forItem }: { existing?: PurchaseDetail; taxonomy: Taxonomy; forItem?: ItemDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { full } = useSession();
  const [params] = useSearchParams();
  const activeProjects = taxonomy.projects.filter((p) => !p.archived || p.id === existing?.project_id);
  // Een gast zet uitgaven altijd in een project; staat er maar één open, dan dat.
  const startProject =
    params.get("project") && taxonomy.projects.some((p) => p.id === params.get("project"))
      ? params.get("project")
      : !full && activeProjects.length === 1
        ? activeProjects[0].id
        : null;
  // Vanaf een verkoper ("Nieuwe aankoop"): die alvast ingevuld, met de categorie die je er meestal koopt.
  const startVendor = existing ? undefined : taxonomy.vendors.find((v) => v.id === params.get("verkoper"));
  const [form, setForm] = useState<FormState>(() => ({
    ...toFormState(existing, startProject),
    ...(startVendor && { vendor: startVendor.name, category_id: startVendor.category_id }),
    // Verbruik bijkopen: de naam en de winkel waar je het meestal koopt.
    ...(forItem?.type === "consumable" && {
      description: forItem.name,
      vendor: taxonomy.vendors.find((v) => v.id === forItem.vendor_id)?.name ?? "",
    }),
  }));
  const [link, setLink] = useState<ForItem>(() => {
    const roles = forItem ? rolesFor(forItem.type) : [];
    const wanted = params.get("rol") as LinkRole | null;
    return { role: wanted && roles.includes(wanted) ? wanted : (roles[0] ?? "other"), quantity: "1", addStock: true };
  });
  const [linked, setLinked] = useState(false);
  const defaultsFor = (projectId: string | null) =>
    projectId ? (taxonomy.projects.find((p) => p.id === projectId)?.default_split ?? taxonomy.household.default_split) : taxonomy.household.default_split;
  const [split, setSplit] = useState<SplitState>(() =>
    initialSplitState({
      meId: taxonomy.me.id,
      people: splitCandidates(taxonomy, form.project_id, full, usedBy(existing)).people,
      defaults: defaultsFor(form.project_id),
      existing,
    }),
  );
  const [files, setFiles] = useState<File[]>([]);
  // Onthoudt de aankoop na de eerste save, zodat een mislukte upload opnieuw proberen geen dubbele aankoop maakt.
  const [savedId, setSavedId] = useState(existing?.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [read, setRead] = useState<ReadState>();
  // Velden die automatisch ingevuld werden (zacht gemarkeerd) en velden die je zelf aanpaste (die blijven af).
  const [autoFilled, setAutoFilled] = useState<Set<keyof FormState>>(new Set());
  const touched = useRef(new Set<keyof FormState>());

  // Wie er via "Iemand anders" bij kwam, blijft in de lijst staan.
  const [extra, setExtra] = useState<string[]>([]);
  const { people, pots } = splitCandidates(taxonomy, form.project_id, full, [...usedBy(existing), ...extra]);
  const others = taxonomy.members.filter((m) => !people.some((p) => p.id === m.id));
  async function onAddPerson(name: string) {
    const member = await addPerson(taxonomy, form.project_id, name);
    setExtra((ids) => [...ids, member.id]);
    return member;
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    touched.current.add(key);
    setAutoFilled((prev) => (prev.has(key) ? new Set([...prev].filter((k) => k !== key)) : prev));
    setForm((f) => ({ ...f, [key]: value }));
  };

  /** Ander project: andere deelnemers, dus de verdeling begint opnieuw volgens de standaard van dat project. */
  function setProject(projectId: string | null) {
    set("project_id", projectId);
    setExtra([]);
    setSplit(initialSplitState({ meId: taxonomy.me.id, people: splitCandidates(taxonomy, projectId, full).people, defaults: defaultsFor(projectId) }));
  }

  /** Een verkoper waar je meestal hetzelfde koopt: die categorie alvast invullen (zacht gemarkeerd). */
  function setVendor(name: string) {
    set("vendor", name);
    const vendor = taxonomy.vendors.find((v) => v.name.toLowerCase() === name.trim().toLowerCase());
    if (vendor?.category_id && !touched.current.has("category_id") && !form.category_id) {
      setForm((f) => ({ ...f, category_id: vendor.category_id }));
      setAutoFilled((prev) => new Set([...prev, "category_id"]));
    }
  }

  const autoClass = (key: keyof FormState) => (autoFilled.has(key) ? "auto" : undefined);

  async function onFilesChange(next: File[]) {
    const added = next.length > files.length ? next[next.length - 1] : undefined;
    setFiles(next);
    // Enkel het eerste bewijsstuk lezen; een tweede foto (bv. de achterkant) laten we met rust.
    if (!added || read || existing) return;
    if (!added.type.startsWith("image/") && added.type !== "application/pdf") return;

    setRead({ state: "busy" });
    try {
      const result = await readReceipt(added);
      const fields = guessToFields(result.guess, taxonomy);
      const fill = (Object.keys(fields) as (keyof FormState)[]).filter((k) => !touched.current.has(k));
      setForm((f) => ({ ...f, ...Object.fromEntries(fill.map((k) => [k, fields[k]])) }));
      setAutoFilled(new Set(fill));
      setRead({ state: "done", result });
    } catch (err) {
      setRead({ state: "error", message: (err as Error).message });
    }
  }

  const amountCents = parseEuro(form.amount);
  const validAmount = amountCents !== null && !Number.isNaN(amountCents) ? amountCents : null;

  /** Het ticket om de lijnen uit te lezen: het gekozen bestand, of (bij bewerken) het eerste bewaarde bewijsstuk. */
  async function receiptFile(): Promise<File | null> {
    if (files[0]) return files[0];
    const stored = existing?.files.find((f) => f.content_type.startsWith("image/") || f.content_type === "application/pdf");
    if (!stored) return null;
    const blob = await (await fetch(apiUrl(`/files/${stored.id}`))).blob();
    return new File([blob], stored.filename, { type: stored.content_type });
  }

  function warrantyUntil(): string | null {
    if (form.warranty === "none") return null;
    if (form.warranty === "custom") return form.warranty_custom || null;
    return addYears(form.purchased_on, Number(form.warranty));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (Number.isNaN(amountCents)) {
      setError("Het bedrag is niet geldig.");
      return;
    }
    const built = buildSplit(split, amountCents);
    if ("error" in built) {
      setError(built.error);
      return;
    }

    const linkQuantity = link.role === "refill" ? parseQuantity(link.quantity) : null;
    if (forItem && link.role === "refill" && (!linkQuantity || Number.isNaN(linkQuantity))) {
      setError("Vul in hoeveel je kocht.");
      return;
    }

    const input: PurchaseInput = {
      description: form.description,
      vendor: form.vendor,
      purchased_on: form.purchased_on,
      amount_cents: amountCents,
      category_id: form.category_id,
      project_id: form.project_id,
      payments: built.payments,
      split: built.split,
      warranty_until: warrantyUntil(),
      notes: form.notes,
      tag_ids: form.tag_ids,
    };

    setSaving(true);
    setError(undefined);
    try {
      const saved = savedId ? await api.put<Purchase>(`/purchases/${savedId}`, input) : await api.post<Purchase>("/purchases", input);
      setSavedId(saved.id);

      if (files.length > 0) {
        const body = new FormData();
        for (const file of files) body.append("file", await prepareUpload(file));
        await api.post(`/purchases/${saved.id}/files`, body);
        setFiles([]);
      }

      if (forItem) {
        if (!linked) {
          await api.post(`/items/${forItem.id}/links`, {
            purchase_id: saved.id,
            role: link.role,
            quantity: linkQuantity,
            amount_cents: null,
            note: null,
            add_stock: link.role === "refill" && link.addStock,
          });
          setLinked(true);
        }
        toast(`Bewaard bij ${forItem.name}`);
        navigate(itemPath(forItem), { replace: true });
        return;
      }

      toast(existing ? "Uitgave bijgewerkt" : "Uitgave bewaard");
      navigate(`/aankopen/${saved.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHead
        title={existing ? "Uitgave bewerken" : form.project_id ? "Nieuwe uitgave" : "Nieuwe aankoop"}
        back={{
          to: -1,
          label: existing ? existing.description : (forItem?.name ?? taxonomy.projects.find((p) => p.id === form.project_id)?.name ?? "Aankopen"),
        }}
      />

      {forItem && (
        <section className="card form-section">
          <div className="for-item">
            <span className="row-media">
              <Icon name={forItem.type === "asset" ? "armchair" : "package"} size={16} />
            </span>
            <span className="row-main">
              <span className="row-title">Voor {forItem.name}</span>
              <span className="row-meta">
                <span>{LINK_ROLES[link.role].hint}</span>
              </span>
            </span>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="label">Waarvoor</span>
              <select value={link.role} onChange={(e) => setLink((l) => ({ ...l, role: e.target.value as LinkRole }))}>
                {rolesFor(forItem.type).map((r) => (
                  <option key={r} value={r}>
                    {LINK_ROLES[r].label}
                  </option>
                ))}
              </select>
            </label>
            {link.role === "refill" && (
              <div className="field">
                <span className="label">Hoeveel {UNITS[forItem.unit]}</span>
                <QuantityField value={link.quantity} onChange={(quantity) => setLink((l) => ({ ...l, quantity }))} label="Hoeveelheid" />
              </div>
            )}
          </div>
          {link.role === "refill" && (
            <Switch
              checked={link.addStock}
              onChange={(addStock) => setLink((l) => ({ ...l, addStock }))}
              label="In voorraad zetten"
              hint="Telt meteen bij wat er in huis is."
            />
          )}
        </section>
      )}

      {!existing && (
        <section className="card form-section">
          <div className="field">
            <span className="label">Bewijsstuk</span>
            <span className="hint">Een foto of PDF van het kasticket vult de rest vanzelf in.</span>
          </div>
          <FilePicker files={files} onChange={onFilesChange} />
          {read && <Alert tone={readMessage(read).tone}>{readMessage(read).text}</Alert>}
        </section>
      )}

      <section className="card form-section">
        <label className="field">
          <span className="label">Omschrijving</span>
          <input
            required
            maxLength={200}
            className={autoClass("description")}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder={forItem?.type === "asset" ? "bv. Kuisbeurt, nieuwe dichting" : "bv. Wasmachine Bosch Serie 6"}
          />
        </label>

        <div className="field">
          <span className="label">
            Verkoper <span className="optional">· winkel, webshop of persoon</span>
          </span>
          <VendorField vendors={taxonomy.vendors} className={autoClass("vendor")} value={form.vendor} onChange={setVendor} />
        </div>

        <div className="field-row">
          <label className="field">
            <span className="label">Bedrag</span>
            <input
              inputMode="decimal"
              className={autoClass("amount")}
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="€ 0,00"
              aria-invalid={Number.isNaN(amountCents)}
            />
          </label>
          <label className="field">
            <span className="label">Datum</span>
            <input type="date" required className={autoClass("purchased_on")} value={form.purchased_on} onChange={(e) => set("purchased_on", e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span className="label">Categorie</span>
          <TreeSelect
            className={autoClass("category_id")}
            nodes={categoryTree(taxonomy, "expense")}
            value={form.category_id}
            onChange={(id) => set("category_id", id)}
            empty="Geen categorie"
          />
        </label>

        {(activeProjects.length > 0 || !full) && (
          <label className="field">
            <span className="label">
              Project <span className="optional">· verbouwing, reis, …</span>
            </span>
            <select value={form.project_id ?? ""} onChange={(e) => setProject(e.target.value || null)} required={!full}>
              {full ? <option value="">Geen project</option> : <option value="">Kies een project</option>}
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section className="card form-section">
        <SplitEditor
          amount={validAmount}
          people={people}
          pots={pots}
          meId={taxonomy.me.id}
          value={split}
          onChange={setSplit}
          receipt={receiptFile}
          onAddPerson={full ? onAddPerson : undefined}
          suggestions={others}
        />
      </section>

      <section className="card form-section">
        {form.warranty === "none" ? (
          <button type="button" className="link-button" style={{ justifySelf: "start" }} onClick={() => set("warranty", "2")}>
            <Icon name="plus" size={14} /> Garantie toevoegen
          </button>
        ) : (
          <div className="field-row">
            <label className="field">
              <span className="label">Garantie</span>
              <select value={form.warranty} onChange={(e) => set("warranty", e.target.value)}>
                {WARRANTY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {form.warranty === "custom" && (
              <label className="field">
                <span className="label">Garantie tot</span>
                <input type="date" required value={form.warranty_custom} onChange={(e) => set("warranty_custom", e.target.value)} />
              </label>
            )}
          </div>
        )}

        {full && (
          <div className="field">
            <span className="label">Tags</span>
            <TagPicker tags={taxonomy.tags} value={form.tag_ids} onChange={(ids) => set("tag_ids", ids)} />
          </div>
        )}

        <label className="field">
          <span className="label">
            <Icon name="note" size={15} /> Notitie
          </span>
          <textarea
            rows={3}
            maxLength={2000}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Serienummer, waar de handleiding ligt, afspraken met de verkoper…"
          />
        </label>
      </section>

      {error && <p className="error">{error}</p>}

      <SubmitButton busy={saving} className="btn btn-primary btn-lg">
        {saving ? "Opslaan…" : "Opslaan"}
      </SubmitButton>
    </form>
  );
}
