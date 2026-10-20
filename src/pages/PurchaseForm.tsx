import { useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import type { ReceiptGuess, ReceiptReadResult } from "../../shared/receipt";
import { splitEqual } from "../../shared/split";
import type { Purchase, PurchaseDetail, PurchaseInput, SplitMode, Taxonomy } from "../../shared/types";
import { api, useApi } from "../api";
import { Avatar, Segmented, TreeSelect } from "../components/Controls";
import { FilePicker } from "../components/FilePicker";
import { PageHeader } from "../components/Page";
import { TagPicker } from "../components/TagPicker";
import { addYears, centsToInput, formatCents, parseEuro, today } from "../format";
import { prepareUpload } from "../image";
import { readReceipt } from "../receipt";
import { activeMembers, categoryTree, useTaxonomy } from "../taxonomy";

// Wettelijke garantie in België is 2 jaar; daarom de standaard.
const WARRANTY_OPTIONS = [
  { value: "2", label: "2 jaar (wettelijk)" },
  { value: "1", label: "1 jaar" },
  { value: "3", label: "3 jaar" },
  { value: "5", label: "5 jaar" },
  { value: "none", label: "Geen garantie" },
  { value: "custom", label: "Andere datum…" },
];

// "" = gezamenlijke rekening (in de database: paid_by NULL).
const JOINT = "";

type FormState = {
  description: string;
  store: string;
  purchased_on: string;
  amount: string;
  category_id: string | null;
  warranty: string;
  warranty_custom: string;
  notes: string;
  paid_by: string;
  split_mode: SplitMode;
  /** Bij "aangepast": bedrag per lid, zoals getypt. */
  shares: Record<string, string>;
  tag_ids: string[];
};

type ReadState = { state: "busy" } | { state: "done"; result: ReceiptReadResult } | { state: "error"; message: string };

/** Welke formuliervelden we kunnen invullen vanuit een gelezen ticket. */
function guessToFields(g: ReceiptGuess, taxonomy: Taxonomy | undefined): Partial<FormState> {
  const fields: Partial<FormState> = {};
  if (g.description) fields.description = g.description;
  if (g.store) fields.store = g.store;
  if (g.amount_cents !== null) fields.amount = centsToInput(g.amount_cents);
  if (g.purchased_on) fields.purchased_on = g.purchased_on;
  const category = taxonomy?.categories.find(
    (c) => c.domain === "expense" && c.name.toLowerCase() === g.category?.toLowerCase(),
  );
  if (category) fields.category_id = category.id;
  return fields;
}

function readMessage(read: ReadState): { text: string; tone: "busy" | "ok" | "partial" | "none" } {
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

function toFormState(p: PurchaseDetail | undefined, meId: string): FormState {
  if (!p) {
    return {
      description: "",
      store: "",
      purchased_on: today(),
      amount: "",
      category_id: null,
      warranty: "2",
      warranty_custom: "",
      notes: "",
      paid_by: meId,
      split_mode: "equal",
      shares: {},
      tag_ids: [],
    };
  }
  return {
    description: p.description,
    store: p.store ?? "",
    purchased_on: p.purchased_on,
    amount: centsToInput(p.amount_cents),
    category_id: p.category_id,
    ...initialWarranty(p),
    notes: p.notes ?? "",
    paid_by: p.paid_by ?? JOINT,
    split_mode: p.split_mode ?? "equal",
    shares: Object.fromEntries(p.shares.map((s) => [s.member_id, centsToInput(s.share_cents)])),
    tag_ids: p.tag_ids,
  };
}

export function PurchaseFormPage() {
  const { id } = useParams();
  const { data: taxonomy, error } = useTaxonomy();
  if (error && !taxonomy) return <p className="error page">{error}</p>;
  if (!taxonomy) return null;
  if (!id) return <PurchaseForm taxonomy={taxonomy} />;
  return <EditPurchase id={id} taxonomy={taxonomy} />;
}

function EditPurchase({ id, taxonomy }: { id: string; taxonomy: Taxonomy }) {
  const { data, error } = useApi<PurchaseDetail>(`/purchases/${id}`);
  if (error) return <p className="error page">{error}</p>;
  if (!data) return null;
  return <PurchaseForm existing={data} taxonomy={taxonomy} />;
}

function PurchaseForm({ existing, taxonomy }: { existing?: PurchaseDetail; taxonomy: Taxonomy }) {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(() => toFormState(existing, taxonomy.me.id));
  const [files, setFiles] = useState<File[]>([]);
  // Onthoudt de aankoop na de eerste save, zodat een mislukte upload opnieuw proberen geen dubbele aankoop maakt.
  const [savedId, setSavedId] = useState(existing?.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [read, setRead] = useState<ReadState>();
  // Velden die automatisch ingevuld werden (zacht gemarkeerd) en velden die je zelf aanpaste (die blijven af).
  const [autoFilled, setAutoFilled] = useState<Set<keyof FormState>>(new Set());
  const touched = useRef(new Set<keyof FormState>());

  const members = activeMembers(taxonomy);
  // Wie betaalde, staat altijd in de lijst, ook als die intussen op inactief staat.
  const payers = [...members, ...taxonomy.members.filter((m) => m.id === form.paid_by && m.active === 0)];
  const canSplit = members.length > 1 && form.paid_by !== JOINT;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    touched.current.add(key);
    setAutoFilled((prev) => (prev.has(key) ? new Set([...prev].filter((k) => k !== key)) : prev));
    setForm((f) => ({ ...f, [key]: value }));
  };

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

  const customShares = members.map((m) => ({ member_id: m.id, share_cents: parseEuro(form.shares[m.id] ?? "") ?? 0 }));
  const customLeft = (validAmount ?? 0) - customShares.reduce((sum, s) => sum + (Number.isNaN(s.share_cents) ? 0 : s.share_cents), 0);

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
    const custom = canSplit && form.split_mode === "custom";
    if (custom && (customLeft !== 0 || customShares.some((s) => Number.isNaN(s.share_cents)))) {
      setError("De delen zijn samen niet gelijk aan het bedrag.");
      return;
    }

    const input: PurchaseInput = {
      description: form.description,
      store: form.store,
      purchased_on: form.purchased_on,
      amount_cents: amountCents,
      category_id: form.category_id,
      paid_by: form.paid_by || null,
      // Alleen in het huishouden: alles is voor jezelf, dus "gelijk" (= één deel) volstaat.
      split_mode: form.paid_by ? (canSplit ? form.split_mode : "equal") : null,
      shares: custom ? customShares : undefined,
      warranty_until: warrantyUntil(),
      notes: form.notes,
      tag_ids: form.tag_ids,
    };

    setSaving(true);
    setError(undefined);
    try {
      const saved = savedId
        ? await api.put<Purchase>(`/purchases/${savedId}`, input)
        : await api.post<Purchase>("/purchases", input);
      setSavedId(saved.id);

      if (files.length > 0) {
        const body = new FormData();
        for (const file of files) body.append("file", await prepareUpload(file));
        await api.post(`/purchases/${saved.id}/files`, body);
      }

      navigate(`/aankopen/${saved.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  const payer = taxonomy.members.find((m) => m.id === form.paid_by);
  const equalPreview =
    canSplit && form.split_mode === "equal" && validAmount
      ? splitEqual(validAmount, members.map((m) => m.id), form.paid_by)
      : null;

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHeader title={existing ? "Aankoop bewerken" : "Nieuwe aankoop"} back={-1} />

      {!existing && (
        <section className="field">
          <span className="label">Bewijsstuk</span>
          <FilePicker files={files} onChange={onFilesChange} />
          {read && (
            <p className={`read-status ${readMessage(read).tone}`} role="status">
              {readMessage(read).text}
            </p>
          )}
        </section>
      )}

      <label className="field">
        <span className="label">Omschrijving *</span>
        <input
          required
          maxLength={200}
          className={autoClass("description")}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="bv. Wasmachine Bosch Serie 6"
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span className="label">Winkel</span>
          <input
            maxLength={100}
            className={autoClass("store")}
            value={form.store}
            onChange={(e) => set("store", e.target.value)}
          />
        </label>
        <label className="field">
          <span className="label">Bedrag (€)</span>
          <input
            inputMode="decimal"
            className={autoClass("amount")}
            value={form.amount}
            onChange={(e) => set("amount", e.target.value)}
            placeholder="0,00"
            aria-invalid={Number.isNaN(amountCents)}
          />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="label">Aankoopdatum *</span>
          <input
            type="date"
            required
            className={autoClass("purchased_on")}
            value={form.purchased_on}
            onChange={(e) => set("purchased_on", e.target.value)}
          />
        </label>
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
      </div>

      <fieldset className="field split-panel">
        <legend className="label">Betaald door</legend>
        <Segmented
          label="Betaald door"
          value={form.paid_by}
          onChange={(v) => set("paid_by", v)}
          options={[
            ...payers.map((m) => ({
              value: m.id,
              tone: m.color ?? undefined,
              label: (
                <>
                  <Avatar member={m} size="small" /> {m.id === taxonomy.me.id ? "Ik" : m.name}
                </>
              ),
            })),
            { value: JOINT, label: "Gezamenlijk" },
          ]}
        />
        {form.paid_by === JOINT && (
          <p className="muted small">Van de gezamenlijke rekening: telt niet mee in wie wat betaalde.</p>
        )}

        {canSplit && (
          <>
            <span className="label split-label">Voor wie</span>
            <Segmented
              label="Verdeling"
              value={form.split_mode}
              onChange={(v) => set("split_mode", v)}
              options={[
                { value: "equal", label: "Iedereen" },
                { value: "personal", label: `Enkel ${payer?.id === taxonomy.me.id ? "mij" : (payer?.name ?? "betaler")}` },
                { value: "custom", label: "Aangepast" },
              ]}
            />
            {equalPreview && (
              <p className="muted small">
                {equalPreview
                  .map((s) => `${taxonomy.members.find((m) => m.id === s.member_id)?.name} ${formatCents(s.share_cents)}`)
                  .join(" · ")}
              </p>
            )}
            {form.split_mode === "custom" && (
              <div className="share-inputs">
                {members.map((m) => (
                  <label key={m.id} className="share-input">
                    <Avatar member={m} size="small" />
                    <span>{m.name}</span>
                    <input
                      inputMode="decimal"
                      placeholder="0,00"
                      value={form.shares[m.id] ?? ""}
                      aria-invalid={Number.isNaN(parseEuro(form.shares[m.id] ?? ""))}
                      onChange={(e) => set("shares", { ...form.shares, [m.id]: e.target.value })}
                    />
                  </label>
                ))}
                <p className={`small ${customLeft === 0 ? "muted" : "error"}`}>
                  {customLeft === 0
                    ? "Klopt: samen het volledige bedrag."
                    : customLeft > 0
                      ? `Nog ${formatCents(customLeft)} te verdelen`
                      : `${formatCents(-customLeft)} te veel verdeeld`}
                </p>
              </div>
            )}
          </>
        )}
        {members.length < 2 && form.paid_by !== JOINT && (
          <p className="muted small">Voeg je partner toe bij Meer → Huishouden om uitgaven te verdelen.</p>
        )}
      </fieldset>

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
            <input
              type="date"
              required
              value={form.warranty_custom}
              onChange={(e) => set("warranty_custom", e.target.value)}
            />
          </label>
        )}
      </div>

      <div className="field">
        <span className="label">Tags</span>
        <TagPicker tags={taxonomy.tags} value={form.tag_ids} onChange={(ids) => set("tag_ids", ids)} />
      </div>

      <label className="field">
        <span className="label">Notities</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Serienummer, waar de handleiding ligt, …"
        />
      </label>

      {error && <p className="error">{error}</p>}

      <button type="submit" className="button primary" disabled={saving}>
        {saving ? "Opslaan…" : "Opslaan"}
      </button>
    </form>
  );
}
