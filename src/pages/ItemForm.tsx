import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useParams, useSearchParams } from "react-router";
import { Link, useNavigate } from "../router";
import {
  CONTENT_UNITS,
  ITEM_ORIGINS,
  ITEM_TYPES,
  UNITS,
  type BarcodeLookup,
  type ContentUnit,
  type ItemDetail,
  type ItemInput,
  type ItemListItem,
  type ItemOrigin,
  type ItemType,
  type ProductSuggestion,
  type PurchaseDetail,
  type Taxonomy,
  type Unit,
} from "../../shared/types";
import { api, useApi } from "../api";
import type { ScanResult } from "../barcode-detect";
import { Alert, QuantityField, Segmented, SubmitButton, TreeSelect } from "../components/Controls";
import { Icon } from "../components/Icon";
import { itemPath } from "../components/ItemLinks";
import { PageHead } from "../components/Page";
import { ScanButtons } from "../components/ScanButtons";
import { TagPicker } from "../components/TagPicker";
import { useToast } from "../components/Toast";
import { VendorField } from "../components/VendorField";
import { centsToInput, formatDate, formatNumber, parseEuro, parseQuantity, today } from "../format";
import { categoryTree, locationTree, useTaxonomy } from "../taxonomy";

type FormState = {
  name: string;
  type: ItemType;
  category_id: string | null;
  default_location_id: string | null;
  unit: Unit;
  barcode: string;
  brand: string;
  vendor: string;
  min_quantity: string;
  notes: string;
  tag_ids: string[];
  initial_quantity: string;
  initial_expires: string;
  parent_id: string | null;
  origin: ItemOrigin;
  origin_note: string;
  acquired_on: string;
  /** Bezit zonder aankoop: geschatte waarde. */
  value: string;
  content_amount: string;
  content_unit: ContentUnit;
  /** Uit een aankoop: wat dit item ervan kostte. */
  price: string;
};

function toFormState(item: ItemDetail | undefined, taxonomy: Taxonomy, type: ItemType): FormState {
  return {
    name: item?.name ?? "",
    type: item?.type ?? type,
    category_id: item?.category_id ?? null,
    default_location_id: item?.default_location_id ?? null,
    unit: item?.unit ?? "stuk",
    barcode: item?.barcode ?? "",
    brand: item?.brand ?? "",
    vendor: taxonomy.vendors.find((v) => v.id === item?.vendor_id)?.name ?? "",
    min_quantity: item?.min_quantity !== null && item?.min_quantity !== undefined ? formatNumber(item.min_quantity) : "",
    notes: item?.notes ?? "",
    tag_ids: item?.tag_ids ?? [],
    initial_quantity: "1",
    initial_expires: "",
    parent_id: item?.parent_id ?? null,
    origin: item?.origin ?? "bought",
    origin_note: item?.origin_note ?? "",
    acquired_on: item?.acquired_on ?? "",
    value: item?.value_cents ? centsToInput(item.value_cents) : "",
    content_amount: item?.content_amount ? formatNumber(item.content_amount) : "",
    content_unit: item?.content_unit ?? "kg",
    price: "",
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
  const toast = useToast();
  const [params] = useSearchParams();
  // Vanuit Bezit: een bezit; vanuit Voorraad: verbruik.
  const routeType: ItemType = location.pathname.startsWith("/bezit") ? "asset" : "consumable";
  const { data: allItems } = useApi<ItemListItem[]>("/items");
  const [form, setForm] = useState<FormState>(() => {
    const state = toFormState(existing, taxonomy, routeType);
    if (purchase) {
      state.name = purchase.description;
      // Vanuit een aankoop zonder duidelijke route: iets met garantie is meestal een toestel (bezit).
      if (!location.pathname.startsWith("/bezit")) state.type = purchase.warranty_until ? "asset" : "consumable";
      state.vendor = purchase.vendor_name ?? "";
      state.origin = "bought";
      state.acquired_on = purchase.purchased_on;
      state.price = purchase.amount_cents ? centsToInput(purchase.amount_cents) : "";
    }
    if (!existing && params.get("hoortbij")) state.parent_id = params.get("hoortbij");
    if (initialBarcode) state.barcode = initialBarcode;
    return state;
  });
  const asset = form.type === "asset";
  // Hoort bij: een bezit (de kachel, de stofzuiger), niet zichzelf.
  const parents = (allItems ?? []).filter((i) => i.type === "asset" && i.id !== existing?.id);
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
  const contentAmount = parseQuantity(form.content_amount);
  const value = form.value.trim() ? parseEuro(form.value) : null;
  const price = form.price.trim() ? parseEuro(form.price) : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (Number.isNaN(minQuantity) || Number.isNaN(initialQuantity) || Number.isNaN(contentAmount)) {
      setError("Een hoeveelheid is niet geldig.");
      return;
    }
    if (Number.isNaN(value) || Number.isNaN(price)) {
      setError("Een bedrag is niet geldig.");
      return;
    }
    const input: ItemInput = {
      name: form.name,
      type: form.type,
      category_id: form.category_id,
      default_location_id: form.default_location_id,
      unit: asset ? "stuk" : form.unit,
      barcode: asset ? null : form.barcode,
      brand: form.brand,
      vendor: asset ? null : form.vendor,
      min_quantity: asset ? null : minQuantity,
      notes: form.notes,
      parent_id: form.parent_id,
      origin: asset ? form.origin : null,
      origin_note: asset && form.origin !== "bought" ? form.origin_note || null : null,
      acquired_on: asset ? form.acquired_on || null : null,
      // Gekocht met een aankoop erbij: de kost komt van die aankoop; anders een geschatte waarde.
      value_cents: asset && !purchase ? value : null,
      content_amount: asset ? null : contentAmount,
      content_unit: asset || !contentAmount ? null : form.content_unit,
      tag_ids: form.tag_ids,
      initial: existing
        ? undefined
        : {
            quantity: initialQuantity ?? 0,
            location_id: form.default_location_id,
            expires_on: asset ? null : form.initial_expires || null,
            purchase_id: purchase?.id ?? null,
            amount_cents: purchase && price !== purchase.amount_cents ? price : null,
          },
    };

    setSaving(true);
    setError(undefined);
    try {
      const saved = existing ? await api.put<ItemDetail>(`/items/${existing.id}`, input) : await api.post<ItemDetail>("/items", input);
      toast(existing ? "Bijgewerkt" : "Bewaard");
      navigate(itemPath(saved), { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHead
        title={existing ? (asset ? "Bezit bewerken" : "Item bewerken") : asset ? "Nieuw bezit" : "Nieuw item"}
        back={{ to: -1, label: existing ? existing.name : asset ? "Bezit" : "Voorraad" }}
      />

      {purchase && (
        <Alert tone="ok">
          Wordt gekoppeld aan de aankoop "{purchase.description}" van {formatDate(purchase.purchased_on)}.
        </Alert>
      )}

      {!asset && (
        <section className="card form-section">
          <div className="field">
            <span className="label">Barcode</span>
            <span className="hint">Scan het product: naam, merk en categorie komen vanzelf.</span>
          </div>
          <ScanButtons hint="Scan de barcode van het product" onResult={onScan} />
          {lookup?.state === "busy" && <Alert tone="busy">Product opzoeken</Alert>}
          {lookup?.state === "found" && <Alert tone="ok">Gevonden in Open Food Facts. Kijk het even na.</Alert>}
          {lookup?.state === "none" && !existing && <Alert tone="none">Dit product kennen we niet. Vul het zelf in; volgende keer herkent de app het.</Alert>}
          {lookup?.state === "known" && (
            <Alert tone="partial">
              Dit item heb je al.{" "}
              <Link to={`/voorraad/${lookup.itemId}`} className="link">
                Open het
              </Link>{" "}
              om de voorraad aan te passen.
            </Alert>
          )}
        </section>
      )}

      <section className="card form-section">
        <label className="field">
          <span className="label">Naam</span>
          <input
            required
            maxLength={200}
            className={autoClass("name")}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={asset ? "bv. Pelletkachel, Wasmachine" : "bv. Halfvolle melk, Pellets"}
          />
        </label>

        <div className="field">
          <span className="label">Soort</span>
          <Segmented
            label="Soort"
            value={form.type}
            onChange={(v) => set("type", v)}
            options={(Object.keys(ITEM_TYPES) as ItemType[]).map((t) => ({ value: t, label: <span>{ITEM_TYPES[t].label}</span> }))}
          />
          <span className="hint">{ITEM_TYPES[form.type].hint}</span>
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
            <TreeSelect nodes={locationTree(taxonomy)} value={form.default_location_id} onChange={(id) => set("default_location_id", id)} empty="Geen" />
          </label>
        </div>

        {!asset && (
          <div className="field">
            <span className="label">
              Meestal gekocht bij <span className="optional">· verkoper</span>
            </span>
            <VendorField vendors={taxonomy.vendors} value={form.vendor} onChange={(v) => set("vendor", v)} />
          </div>
        )}

        {asset ? (
          <label className="field">
            <span className="label">Merk</span>
            <input maxLength={100} className={autoClass("brand")} value={form.brand} onChange={(e) => set("brand", e.target.value)} />
          </label>
        ) : (
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
                className="mono"
                value={form.barcode}
                onChange={(e) => set("barcode", e.target.value)}
                onBlur={() => form.barcode && form.barcode !== existing?.barcode && lookupBarcode(form.barcode)}
              />
            </label>
          </div>
        )}

        {!asset && (
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
                placeholder="geen minimum"
                aria-invalid={Number.isNaN(minQuantity)}
                onChange={(e) => set("min_quantity", e.target.value)}
              />
            </label>
          </div>
        )}

        {!asset && (
          <div className="field">
            <span className="label">
              Inhoud per {form.unit} <span className="optional">· om prijzen per kg of liter te vergelijken</span>
            </span>
            <div className="field-row">
              <input
                inputMode="decimal"
                value={form.content_amount}
                onChange={(e) => set("content_amount", e.target.value)}
                placeholder="bv. 15"
                aria-label="Inhoud"
                aria-invalid={Number.isNaN(contentAmount)}
              />
              <select value={form.content_unit} onChange={(e) => set("content_unit", e.target.value as ContentUnit)} aria-label="Eenheid van de inhoud">
                {CONTENT_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {parents.length > 0 && (
          <label className="field">
            <span className="label">
              Hoort bij <span className="optional">· {asset ? "bv. de afstandsbediening bij de tv" : "bv. pellets bij de kachel"}</span>
            </span>
            <select value={form.parent_id ?? ""} onChange={(e) => set("parent_id", e.target.value || null)}>
              <option value="">Niets</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {asset && (
        <section className="card form-section">
          <div className="field">
            <span className="label">Herkomst</span>
            <Segmented
              label="Herkomst"
              value={form.origin}
              onChange={(v) => set("origin", v)}
              options={(Object.keys(ITEM_ORIGINS) as ItemOrigin[]).map((o) => ({ value: o, label: <span>{ITEM_ORIGINS[o].label}</span> }))}
            />
          </div>
          {form.origin !== "bought" && (
            <label className="field">
              <span className="label">{form.origin === "gift" ? "Van wie" : "Waar komt het vandaan"}</span>
              <input
                maxLength={200}
                value={form.origin_note}
                onChange={(e) => set("origin_note", e.target.value)}
                placeholder={form.origin === "gift" ? "bv. Marc en Ann" : "bv. van het vorige huis"}
              />
            </label>
          )}
          <div className="field-row">
            <label className="field">
              <span className="label">Sinds</span>
              <input type="date" max={today()} value={form.acquired_on} onChange={(e) => set("acquired_on", e.target.value)} />
            </label>
            {purchase ? (
              <label className="field">
                <span className="label">
                  Prijs <span className="optional">· van de aankoop</span>
                </span>
                <input
                  inputMode="decimal"
                  value={form.price}
                  onChange={(e) => set("price", e.target.value)}
                  placeholder="€ 0,00"
                  aria-invalid={Number.isNaN(price)}
                />
              </label>
            ) : (
              <label className="field">
                <span className="label">{form.origin === "bought" ? "Wat het kostte" : "Geschatte waarde"}</span>
                <input
                  inputMode="decimal"
                  value={form.value}
                  onChange={(e) => set("value", e.target.value)}
                  placeholder="optioneel"
                  aria-invalid={Number.isNaN(value)}
                />
              </label>
            )}
          </div>
          {form.origin === "bought" && !purchase && !existing && (
            <span className="hint">Staat de aankoop in de app? Koppel ze daarna op de fiche, dan komt de garantie mee.</span>
          )}
        </section>
      )}

      {!existing && (
        <section className="card form-section">
          <div className="field">
            <span className="label">{asset ? "Hoeveel" : "Nu in huis"}</span>
            <QuantityField value={form.initial_quantity} onChange={(v) => set("initial_quantity", v)} label="Hoeveelheid nu in huis" />
          </div>
          {!asset && (
            <div className="field-row">
              <label className="field">
                <span className="label">Vervalt op</span>
                <input type="date" value={form.initial_expires} onChange={(e) => set("initial_expires", e.target.value)} />
              </label>
              {purchase && (
                <label className="field">
                  <span className="label">
                    Betaald <span className="optional">· voor dit item</span>
                  </span>
                  <input
                    inputMode="decimal"
                    value={form.price}
                    onChange={(e) => set("price", e.target.value)}
                    placeholder="€ 0,00"
                    aria-invalid={Number.isNaN(price)}
                  />
                </label>
              )}
            </div>
          )}
        </section>
      )}

      <section className="card form-section">
        <div className="field">
          <span className="label">Tags</span>
          <TagPicker tags={taxonomy.tags} value={form.tag_ids} onChange={(ids) => set("tag_ids", ids)} />
        </div>

        <label className="field">
          <span className="label">
            <Icon name={asset ? "sparkles" : "note"} size={15} /> {asset ? "Goed om te weten" : "Notitie"}
          </span>
          <textarea
            rows={asset ? 4 : 3}
            maxLength={4000}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder={asset ? "Instellingen, tips, serienummer, waar de handleiding ligt…" : "bv. enkel de bio-versie"}
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
