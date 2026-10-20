import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import {
  ITEM_TYPES,
  UNITS,
  type BarcodeLookup,
  type ItemDetail,
  type ItemInput,
  type ItemType,
  type ProductSuggestion,
  type PurchaseDetail,
  type Taxonomy,
  type Unit,
} from "../../shared/types";
import { api, useApi } from "../api";
import type { ScanResult } from "../barcode-detect";
import { QuantityField, Segmented, TreeSelect } from "../components/Controls";
import { PageHeader } from "../components/Page";
import { ScanButtons } from "../components/ScanButtons";
import { TagPicker } from "../components/TagPicker";
import { formatDate, formatNumber, parseQuantity } from "../format";
import { categoryTree, locationTree, useTaxonomy } from "../taxonomy";

type FormState = {
  name: string;
  type: ItemType;
  category_id: string | null;
  default_location_id: string | null;
  unit: Unit;
  barcode: string;
  brand: string;
  min_quantity: string;
  notes: string;
  tag_ids: string[];
  initial_quantity: string;
  initial_expires: string;
};

function toFormState(item?: ItemDetail): FormState {
  return {
    name: item?.name ?? "",
    type: item?.type ?? "consumable",
    category_id: item?.category_id ?? null,
    default_location_id: item?.default_location_id ?? null,
    unit: item?.unit ?? "stuk",
    barcode: item?.barcode ?? "",
    brand: item?.brand ?? "",
    min_quantity: item?.min_quantity !== null && item?.min_quantity !== undefined ? formatNumber(item.min_quantity) : "",
    notes: item?.notes ?? "",
    tag_ids: item?.tag_ids ?? [],
    initial_quantity: "1",
    initial_expires: "",
  };
}

/** "330 ml", "6 x 1,5 l", "500 g" → een passende eenheid, als die er duidelijk uit blijkt. */
function unitFromQuantityText(text: string | null): Unit | null {
  if (!text) return null;
  if (/\b(\d+\s*[x×])/i.test(text)) return "pak";
  if (/\d\s*(ml|cl|l)\b/i.test(text)) return "fles";
  return null;
}

export function ItemFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { data: taxonomy, error } = useTaxonomy();
  if (error && !taxonomy) return <p className="error page">{error}</p>;
  if (!taxonomy) return null;
  if (id) return <EditItem id={id} taxonomy={taxonomy} />;
  const purchaseId = params.get("aankoop");
  if (purchaseId) return <ItemFromPurchase purchaseId={purchaseId} taxonomy={taxonomy} />;
  return <ItemForm taxonomy={taxonomy} initialBarcode={params.get("barcode") ?? undefined} />;
}

function EditItem({ id, taxonomy }: { id: string; taxonomy: Taxonomy }) {
  const { data, error } = useApi<ItemDetail>(`/items/${id}`);
  if (error) return <p className="error page">{error}</p>;
  if (!data) return null;
  return <ItemForm existing={data} taxonomy={taxonomy} />;
}

function ItemFromPurchase({ purchaseId, taxonomy }: { purchaseId: string; taxonomy: Taxonomy }) {
  const { data, error } = useApi<PurchaseDetail>(`/purchases/${purchaseId}`);
  if (error) return <p className="error page">{error}</p>;
  if (!data) return null;
  return <ItemForm taxonomy={taxonomy} purchase={data} />;
}

function ItemForm({
  existing,
  taxonomy,
  purchase,
  initialBarcode,
}: {
  existing?: ItemDetail;
  taxonomy: Taxonomy;
  purchase?: PurchaseDetail;
  initialBarcode?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState<FormState>(() => {
    const state = toFormState(existing);
    if (purchase) {
      // Iets met garantie is meestal een toestel of gereedschap: dat houd je bij als bezit.
      state.name = purchase.description;
      state.type = purchase.warranty_until ? "asset" : "consumable";
    }
    if (initialBarcode) state.barcode = initialBarcode;
    return state;
  });
  const [autoFilled, setAutoFilled] = useState<Set<keyof FormState>>(new Set());
  const touched = useRef(new Set<keyof FormState>());
  const [lookup, setLookup] = useState<{ state: "busy" } | { state: "known"; itemId: string } | { state: "found" } | { state: "none" }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    touched.current.add(key);
    setAutoFilled((prev) => (prev.has(key) ? new Set([...prev].filter((k) => k !== key)) : prev));
    setForm((f) => ({ ...f, [key]: value }));
  };
  const autoClass = (key: keyof FormState) => (autoFilled.has(key) ? "auto" : undefined);

  function applySuggestion(s: ProductSuggestion | null) {
    if (!s) {
      setLookup({ state: "none" });
      return;
    }
    const fields: Partial<FormState> = {};
    if (s.name) fields.name = s.quantity_text ? `${s.name} ${s.quantity_text}` : s.name;
    if (s.brand) fields.brand = s.brand;
    if (s.category_id && taxonomy.categories.some((c) => c.id === s.category_id)) fields.category_id = s.category_id;
    const unit = unitFromQuantityText(s.quantity_text);
    if (unit) fields.unit = unit;
    const fill = (Object.keys(fields) as (keyof FormState)[]).filter((k) => !touched.current.has(k));
    setForm((f) => ({ ...f, ...Object.fromEntries(fill.map((k) => [k, fields[k]])) }));
    setAutoFilled(new Set(fill));
    setLookup({ state: "found" });
  }

  async function lookupBarcode(barcode: string) {
    setLookup({ state: "busy" });
    try {
      const result = await api.get<BarcodeLookup>(`/items/lookup?barcode=${encodeURIComponent(barcode)}`);
      if (result.item_id && result.item_id !== existing?.id) setLookup({ state: "known", itemId: result.item_id });
      else if (existing) setLookup(undefined);
      else applySuggestion(result.suggestion);
    } catch {
      setLookup({ state: "none" });
    }
  }

  // Gescand in de voorraadlijst: het voorstel kwam al mee; anders zelf opzoeken. Enkel bij het openen.
  useEffect(() => {
    if (!initialBarcode) return;
    const suggestion = (location.state as { suggestion?: ProductSuggestion | null } | null)?.suggestion;
    if (suggestion !== undefined) applySuggestion(suggestion);
    else lookupBarcode(initialBarcode);
  }, []);

  function onScan(result: ScanResult) {
    set("barcode", result.rawValue);
    lookupBarcode(result.rawValue);
  }

  const minQuantity = parseQuantity(form.min_quantity);
  const initialQuantity = parseQuantity(form.initial_quantity);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (Number.isNaN(minQuantity) || Number.isNaN(initialQuantity)) {
      setError("Een hoeveelheid is niet geldig.");
      return;
    }
    const input: ItemInput = {
      name: form.name,
      type: form.type,
      category_id: form.category_id,
      default_location_id: form.default_location_id,
      unit: form.unit,
      barcode: form.barcode,
      brand: form.brand,
      min_quantity: minQuantity,
      notes: form.notes,
      tag_ids: form.tag_ids,
      initial: existing
        ? undefined
        : {
            quantity: initialQuantity ?? 0,
            location_id: form.default_location_id,
            expires_on: form.initial_expires || null,
            purchase_id: purchase?.id ?? null,
          },
    };

    setSaving(true);
    setError(undefined);
    try {
      const saved = existing
        ? await api.put<ItemDetail>(`/items/${existing.id}`, input)
        : await api.post<ItemDetail>("/items", input);
      navigate(`/voorraad/${saved.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHeader title={existing ? "Item bewerken" : "Nieuw item"} back={-1} />

      {purchase && (
        <p className="read-status ok">
          Wordt gekoppeld aan de aankoop "{purchase.description}" van {formatDate(purchase.purchased_on)}.
        </p>
      )}

      <section className="field">
        <span className="label">Barcode</span>
        <ScanButtons tone="sky" hint="Scan de barcode van het product" onResult={onScan} />
        {lookup?.state === "busy" && <p className="read-status busy">Product opzoeken</p>}
        {lookup?.state === "found" && <p className="read-status ok">Gevonden in Open Food Facts. Kijk het even na.</p>}
        {lookup?.state === "none" && !existing && (
          <p className="read-status none">Dit product kennen we niet. Vul het zelf in; volgende keer herkent de app het.</p>
        )}
        {lookup?.state === "known" && (
          <p className="read-status partial">
            Dit item heb je al. <Link to={`/voorraad/${lookup.itemId}`} className="link">Open het</Link> om de voorraad aan te passen.
          </p>
        )}
      </section>

      <label className="field">
        <span className="label">Naam *</span>
        <input
          required
          maxLength={200}
          className={autoClass("name")}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="bv. Halfvolle melk"
        />
      </label>

      <div className="field">
        <span className="label">Soort</span>
        <Segmented
          label="Soort"
          value={form.type}
          onChange={(v) => set("type", v)}
          options={(Object.keys(ITEM_TYPES) as ItemType[]).map((t) => ({ value: t, label: ITEM_TYPES[t].label }))}
        />
        <p className="muted small">{ITEM_TYPES[form.type].hint}</p>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="label">Categorie</span>
          <TreeSelect
            className={autoClass("category_id")}
            nodes={categoryTree(taxonomy, "item")}
            value={form.category_id}
            onChange={(id) => set("category_id", id)}
            empty="Geen categorie"
          />
        </label>
        <label className="field">
          <span className="label">Standaardplaats</span>
          <TreeSelect
            nodes={locationTree(taxonomy)}
            value={form.default_location_id}
            onChange={(id) => set("default_location_id", id)}
            empty="Geen"
          />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="label">Merk</span>
          <input maxLength={100} className={autoClass("brand")} value={form.brand} onChange={(e) => set("brand", e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Barcode</span>
          <input
            inputMode="numeric"
            maxLength={64}
            value={form.barcode}
            onChange={(e) => set("barcode", e.target.value)}
            onBlur={() => form.barcode && form.barcode !== existing?.barcode && lookupBarcode(form.barcode)}
          />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="label">Eenheid</span>
          <select className={autoClass("unit")} value={form.unit} onChange={(e) => set("unit", e.target.value as Unit)}>
            {(Object.keys(UNITS) as Unit[]).map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Bijna op onder</span>
          <input
            inputMode="decimal"
            value={form.min_quantity}
            placeholder="geen"
            aria-invalid={Number.isNaN(minQuantity)}
            onChange={(e) => set("min_quantity", e.target.value)}
          />
        </label>
      </div>

      {!existing && (
        <fieldset className="field split-panel">
          <legend className="label">Nu in huis</legend>
          <QuantityField value={form.initial_quantity} onChange={(v) => set("initial_quantity", v)} label="Hoeveelheid nu in huis" />
          {form.type === "consumable" && (
            <label className="field">
              <span className="label">Vervalt op</span>
              <input type="date" value={form.initial_expires} onChange={(e) => set("initial_expires", e.target.value)} />
            </label>
          )}
        </fieldset>
      )}

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
          placeholder={form.type === "asset" ? "Serienummer, waar de handleiding ligt, …" : ""}
        />
      </label>

      {error && <p className="error">{error}</p>}

      <button type="submit" className="button primary" disabled={saving}>
        {saving ? "Opslaan…" : "Opslaan"}
      </button>
    </form>
  );
}
