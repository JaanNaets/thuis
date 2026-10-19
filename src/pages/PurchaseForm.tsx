import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import type { Purchase, PurchaseInput, PurchaseWithFiles } from "../../shared/types";
import { api, useApi } from "../api";
import { FilePicker } from "../components/FilePicker";
import { PageHeader } from "../components/Page";
import { addYears, centsToInput, parseEuro, today } from "../format";
import { prepareUpload } from "../image";

const CATEGORIES = [
  "Boodschappen",
  "Elektronica",
  "Huishoudtoestellen",
  "Meubels",
  "Kleding",
  "Gereedschap",
  "Tuin",
  "Auto & fiets",
  "Andere",
];

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
  store: string;
  purchased_on: string;
  amount: string;
  category: string;
  warranty: string;
  warranty_custom: string;
  notes: string;
};

function initialWarranty(p: Purchase): Pick<FormState, "warranty" | "warranty_custom"> {
  if (!p.warranty_until) return { warranty: "none", warranty_custom: "" };
  for (const years of ["1", "2", "3", "5"]) {
    if (addYears(p.purchased_on, Number(years)) === p.warranty_until) {
      return { warranty: years, warranty_custom: "" };
    }
  }
  return { warranty: "custom", warranty_custom: p.warranty_until };
}

function toFormState(p?: Purchase): FormState {
  if (!p) {
    return {
      description: "",
      store: "",
      purchased_on: today(),
      amount: "",
      category: "",
      warranty: "2",
      warranty_custom: "",
      notes: "",
    };
  }
  return {
    description: p.description,
    store: p.store ?? "",
    purchased_on: p.purchased_on,
    amount: centsToInput(p.amount_cents),
    category: p.category ?? "",
    ...initialWarranty(p),
    notes: p.notes ?? "",
  };
}

export function PurchaseFormPage() {
  const { id } = useParams();
  if (!id) return <PurchaseForm />;
  return <EditPurchase id={id} />;
}

function EditPurchase({ id }: { id: string }) {
  const { data, error } = useApi<PurchaseWithFiles>(`/purchases/${id}`);
  if (error) return <p className="error page">{error}</p>;
  if (!data) return null;
  return <PurchaseForm existing={data} />;
}

function PurchaseForm({ existing }: { existing?: Purchase }) {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(() => toFormState(existing));
  const [files, setFiles] = useState<File[]>([]);
  // Onthoudt de aankoop na de eerste save, zodat een mislukte upload opnieuw proberen geen dubbele aankoop maakt.
  const [savedId, setSavedId] = useState(existing?.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const amountCents = parseEuro(form.amount);

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

    const input: PurchaseInput = {
      description: form.description,
      store: form.store,
      purchased_on: form.purchased_on,
      amount_cents: amountCents,
      category: form.category,
      warranty_until: warrantyUntil(),
      notes: form.notes,
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

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHeader title={existing ? "Aankoop bewerken" : "Nieuwe aankoop"} back={-1} />

      {!existing && (
        <section className="field">
          <span className="label">Bewijsstuk</span>
          <FilePicker files={files} onChange={setFiles} />
        </section>
      )}

      <label className="field">
        <span className="label">Omschrijving *</span>
        <input
          required
          maxLength={200}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="bv. Wasmachine Bosch Serie 6"
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span className="label">Winkel</span>
          <input maxLength={100} value={form.store} onChange={(e) => set("store", e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Bedrag (€)</span>
          <input
            inputMode="decimal"
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
            value={form.purchased_on}
            onChange={(e) => set("purchased_on", e.target.value)}
          />
        </label>
        <label className="field">
          <span className="label">Categorie</span>
          <input
            list="categories"
            maxLength={50}
            value={form.category}
            onChange={(e) => set("category", e.target.value)}
          />
          <datalist id="categories">
            {CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
      </div>

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
