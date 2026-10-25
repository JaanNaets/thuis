import { useEffect, useState, type FormEvent } from "react";
import {
  LINK_ROLES,
  UNITS,
  type ItemDetail,
  type ItemInput,
  type ItemLink,
  type ItemLinkInput,
  type ItemListItem,
  type ItemType,
  type LinkRole,
  type PurchaseListItem,
  type Taxonomy,
} from "../../shared/types";
import { api, useApi } from "../api";
import { centsToInput, formatCents, formatDate, formatNumber, parseEuro, parseQuantity } from "../format";
import { QuantityField, SubmitButton, Switch } from "./Controls";
import { Icon } from "./Icon";
import { Spinner } from "./Motion";

/** Waar een ding woont: bezit op /bezit, verbruik op /voorraad. */
export function itemPath(item: { id: string; type: ItemType }): string {
  return `${item.type === "asset" ? "/bezit" : "/voorraad"}/${item.id}`;
}

/** De rollen die bij een soort ding passen. Verbruik koop je bij; bezit koop je, onderhoud je, herstel je. */
export function rolesFor(type: ItemType): LinkRole[] {
  return type === "consumable" ? ["refill", "other"] : ["purchase", "maintenance", "repair", "part", "other"];
}

/** Wat een koppeling kostte: het eigen bedrag, of anders het hele bedrag van de uitgave. */
export function linkCost(link: Pick<ItemLink, "amount_cents" | "purchase_amount_cents">): number {
  return link.amount_cents ?? link.purchase_amount_cents ?? 0;
}

/** "Bijgekocht · 20 zakken", "Onderhoud". */
export function roleText(role: LinkRole, quantity: number | null, unit: keyof typeof UNITS): string {
  const label = LINK_ROLES[role].label;
  return quantity ? `${label} · ${formatNumber(quantity)} ${quantity === 1 ? unit : UNITS[unit]}` : label;
}

/** Een item opnieuw bewaren met één veld anders (bv. "goed om te weten"): de API wil het hele item. */
export function itemToInput(item: ItemDetail, taxonomy: Taxonomy, patch: Partial<ItemInput> = {}): ItemInput {
  return {
    name: item.name,
    type: item.type,
    category_id: item.category_id,
    default_location_id: item.default_location_id,
    unit: item.unit,
    barcode: item.barcode,
    brand: item.brand,
    vendor: taxonomy.vendors.find((v) => v.id === item.vendor_id)?.name ?? null,
    min_quantity: item.min_quantity,
    notes: item.notes,
    parent_id: item.parent_id,
    origin: item.origin,
    origin_note: item.origin_note,
    acquired_on: item.acquired_on,
    value_cents: item.value_cents,
    content_amount: item.content_amount,
    content_unit: item.content_unit,
    tag_ids: item.tag_ids,
    ...patch,
  };
}

type Fields = { role: LinkRole; quantity: string; amount: string; note: string; addStock: boolean };

/** Rol, aantal (bij bijkopen), bedrag en notitie: dezelfde velden vanaf een uitgave of vanaf een ding. */
function LinkFields({
  type,
  unit,
  value,
  onChange,
  purchaseAmount,
}: {
  type: ItemType;
  unit: keyof typeof UNITS;
  value: Fields;
  onChange: (next: Fields) => void;
  purchaseAmount: number | null;
}) {
  const set = (patch: Partial<Fields>) => onChange({ ...value, ...patch });
  return (
    <>
      <label className="field">
        <span className="label">Waarvoor</span>
        <select value={value.role} onChange={(e) => set({ role: e.target.value as LinkRole })}>
          {rolesFor(type).map((r) => (
            <option key={r} value={r}>
              {LINK_ROLES[r].label}
            </option>
          ))}
        </select>
        <span className="hint">{LINK_ROLES[value.role].hint}</span>
      </label>
      {value.role === "refill" && (
        <div className="field">
          <span className="label">Hoeveel {UNITS[unit]}</span>
          <QuantityField value={value.quantity} onChange={(quantity) => set({ quantity })} label="Hoeveelheid" />
        </div>
      )}
      <label className="field">
        <span className="label">
          Bedrag <span className="optional">· {purchaseAmount ? `leeg = het hele bedrag (${formatCents(purchaseAmount)})` : "optioneel"}</span>
        </span>
        <input inputMode="decimal" value={value.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="€ 0,00" />
        <span className="hint">Enkel invullen als er op de uitgave nog andere dingen staan.</span>
      </label>
      {value.role === "refill" && (
        <Switch checked={value.addStock} onChange={(addStock) => set({ addStock })} label="In voorraad zetten" hint="Telt meteen bij wat er in huis is." />
      )}
      <label className="field">
        <span className="label">
          <Icon name="note" size={15} /> Notitie
        </span>
        <input maxLength={500} value={value.note} onChange={(e) => set({ note: e.target.value })} placeholder="optioneel" />
      </label>
    </>
  );
}

function toLinkInput(purchaseId: string, f: Fields): ItemLinkInput | { error: string } {
  const quantity = f.role === "refill" ? parseQuantity(f.quantity) : null;
  if (f.role === "refill" && (!quantity || Number.isNaN(quantity))) return { error: "Vul in hoeveel je kocht." };
  const amount = f.amount.trim() ? parseEuro(f.amount) : null;
  if (amount !== null && Number.isNaN(amount)) return { error: "Het bedrag is niet geldig." };
  return { purchase_id: purchaseId, role: f.role, quantity, amount_cents: amount, note: f.note || null, add_stock: f.role === "refill" && f.addStock };
}

/** Vanaf een uitgave: kies het ding waar ze aan hangt. */
export function LinkItemForm({ purchase, onDone }: { purchase: { id: string; amount_cents: number | null }; onDone: (message: string) => void }) {
  const { data: items } = useApi<ItemListItem[]>("/items");
  const [itemId, setItemId] = useState("");
  const [fields, setFields] = useState<Fields>({ role: "purchase", quantity: "1", amount: "", note: "", addStock: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const item = items?.find((i) => i.id === itemId);

  // Ander ding: de rol die er het best bij past.
  useEffect(() => {
    if (item) setFields((f) => (rolesFor(item.type).includes(f.role) ? f : { ...f, role: rolesFor(item.type)[0] }));
  }, [item]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!item) return setError("Kies waarvoor deze uitgave is.");
    const input = toLinkInput(purchase.id, fields);
    if ("error" in input) return setError(input.error);
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/items/${item.id}/links`, input);
      onDone(`Gekoppeld aan ${item.name}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!items) return <Spinner />;
  const assets = items.filter((i) => i.type === "asset");
  const consumables = items.filter((i) => i.type === "consumable");
  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="field">
        <span className="label">Ding</span>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} required>
          <option value="">Kies…</option>
          {assets.length > 0 && (
            <optgroup label="Bezit">
              {assets.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </optgroup>
          )}
          {consumables.length > 0 && (
            <optgroup label="Verbruik">
              {consumables.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {item && <LinkFields type={item.type} unit={item.unit} value={fields} onChange={setFields} purchaseAmount={purchase.amount_cents} />}
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <SubmitButton busy={busy}>Koppelen</SubmitButton>
      </div>
    </form>
  );
}

/** Vanaf een ding: zoek een uitgave die er al is (bv. de kuisbeurt van vorig jaar) en hang ze eraan. */
export function LinkPurchaseForm({ item, onDone }: { item: Pick<ItemDetail, "id" | "type" | "unit" | "links">; onDone: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [chosen, setChosen] = useState<PurchaseListItem>();
  const [fields, setFields] = useState<Fields>({
    role: rolesFor(item.type)[item.type === "asset" ? 1 : 0],
    quantity: "1",
    amount: "",
    note: "",
    addStock: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const { data: purchases } = useApi<PurchaseListItem[]>(`/purchases${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`);
  const linked = new Set(item.links.map((l) => l.purchase_id));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    const input = toLinkInput(chosen.id, fields);
    if ("error" in input) return setError(input.error);
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/items/${item.id}/links`, input);
      onDone(`${chosen.description} gekoppeld`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (chosen) {
    return (
      <form className="form" onSubmit={onSubmit}>
        <button type="button" className="row picked-row" onClick={() => setChosen(undefined)}>
          <span className="row-media">
            <Icon name="receipt" size={16} />
          </span>
          <span className="row-main">
            <span className="row-title">{chosen.description}</span>
            <span className="row-meta">
              <span>{[formatDate(chosen.purchased_on), chosen.vendor_name].filter(Boolean).join(" · ")}</span>
            </span>
          </span>
          <span className="row-end">{formatCents(chosen.amount_cents)}</span>
        </button>
        <LinkFields type={item.type} unit={item.unit} value={fields} onChange={setFields} purchaseAmount={chosen.amount_cents} />
        {error && <p className="error">{error}</p>}
        <div className="sheet-actions">
          <SubmitButton busy={busy}>Koppelen</SubmitButton>
        </div>
      </form>
    );
  }

  const shown = (purchases ?? []).filter((p) => !linked.has(p.id)).slice(0, 30);
  return (
    <div className="form">
      <label className="search">
        <Icon name="search" size={16} />
        <input type="search" autoFocus placeholder="Zoek een uitgave…" aria-label="Zoek een uitgave" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {!purchases ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <p className="hint">Niets gevonden. Probeer een ander woord.</p>
      ) : (
        <ul className="rows pick-list">
          {shown.map((p) => (
            <li key={p.id}>
              <button type="button" className="row" onClick={() => setChosen(p)}>
                <span className="row-main">
                  <span className="row-title">{p.description}</span>
                  <span className="row-meta">
                    <span>{[formatDate(p.purchased_on), p.vendor_name].filter(Boolean).join(" · ")}</span>
                  </span>
                </span>
                <span className="row-end">{formatCents(p.amount_cents)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Een koppeling aanpassen (rol, aantal, bedrag) of losmaken. */
export function EditLinkForm({
  item,
  link,
  onDone,
  onUnlink,
}: {
  item: Pick<ItemDetail, "id" | "type" | "unit">;
  link: ItemLink;
  onDone: (message: string) => void;
  onUnlink: () => void;
}) {
  const [fields, setFields] = useState<Fields>({
    role: link.role,
    quantity: link.quantity ? formatNumber(link.quantity) : "1",
    amount: link.amount_cents !== null ? centsToInput(link.amount_cents) : "",
    note: link.note ?? "",
    addStock: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const input = toLinkInput(link.purchase_id, fields);
    if ("error" in input) return setError(input.error);
    setBusy(true);
    setError(undefined);
    try {
      await api.put(`/items/${item.id}/links/${link.id}`, input);
      onDone("Koppeling bijgewerkt");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <p className="muted" style={{ marginTop: -8 }}>
        {link.description} · {formatDate(link.purchased_on)}
        {link.vendor_name && ` · ${link.vendor_name}`}
      </p>
      <LinkFields type={item.type} unit={item.unit} value={fields} onChange={setFields} purchaseAmount={link.purchase_amount_cents} />
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={onUnlink}>
          Losmaken
        </button>
        <SubmitButton busy={busy}>Bewaren</SubmitButton>
      </div>
    </form>
  );
}
