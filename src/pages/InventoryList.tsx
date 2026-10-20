import { Fragment, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { expiresSoon, isLow } from "../../shared/stock";
import { descendantIds, flattenTree, rootOf } from "../../shared/tree";
import { ITEM_TYPES, UNITS, type BarcodeLookup, type ItemDetail, type ItemListItem, type ItemType, type Taxonomy } from "../../shared/types";
import { api, useApi } from "../api";
import type { ScanResult } from "../barcode-detect";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { FilterSelect, LevelMeter, Tabs } from "../components/Controls";
import { Icon } from "../components/Icon";
import { Num, SkeletonRows, stagger } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { daysUntil, formatDate, formatNumber, today } from "../format";
import { categoryTone, categoryTree, locationTree, useTaxonomy } from "../taxonomy";

type Tab = "all" | "low" | "expiring" | "archived";

/** Zoeken zonder op hoofdletters of accenten te letten ("creme" vindt "Crème"). */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function expiryBadge(nextExpiry: string | null): { label: string; className: string } | null {
  if (!nextExpiry || !expiresSoon(nextExpiry, today())) return null;
  const days = daysUntil(nextExpiry);
  if (days < 0) return { label: "Vervallen", className: "badge-danger" };
  if (days === 0) return { label: "Vervalt vandaag", className: "badge-warning" };
  if (days === 1) return { label: "Vervalt morgen", className: "badge-warning" };
  return { label: `Vervalt ${formatDate(nextExpiry).replace(/ \d{4}$/, "")}`, className: "badge-warning" };
}

/** "1 fles" / "3 flessen": het woord bij een aantal. */
export function unitWord(quantity: number, unit: keyof typeof UNITS): string {
  return quantity === 1 ? unit : UNITS[unit];
}

export function InventoryList() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [type, setType] = useState<ItemType | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [tagId, setTagId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [actionError, setActionError] = useState<string>();

  const archived = tab === "archived";
  const { data, error, loading, reload, mutate } = useApi<ItemListItem[]>(archived ? "/items?archived=1" : "/items");
  const { data: taxonomy } = useTaxonomy();
  const now = today();

  // De tellers in de tabs komen van de gewone lijst; in het archief blijven de laatste staan.
  const lastCounts = useRef<{ all: number; low: number; expiring: number }>(undefined);
  const counts = useMemo(() => {
    if (data && !archived) {
      lastCounts.current = {
        all: data.length,
        low: data.filter((i) => isLow(i.quantity, i.min_quantity)).length,
        expiring: data.filter((i) => expiresSoon(i.next_expiry, now)).length,
      };
    }
    return lastCounts.current;
  }, [data, archived, now]);

  // Op een plaats gefilterd: toon enkel wat daar (of in een vak eronder) ligt.
  const shown = useMemo(() => {
    if (!data || !taxonomy) return [];
    const places = locationId ? descendantIds(taxonomy.locations, locationId) : null;
    const cats = categoryId ? descendantIds(taxonomy.categories, categoryId) : null;
    const tagNames = new Map(taxonomy.tags.map((t) => [t.id, t.name]));
    const vendorNames = new Map(taxonomy.vendors.map((v) => [v.id, v.name]));
    const q = fold(query.trim());

    return data
      .map((item) => {
        if (!places) return item;
        const levels = item.levels.filter((l) => places.has(l.location_id));
        const quantity = levels.reduce((sum, l) => sum + l.quantity, 0);
        return { ...item, levels, quantity };
      })
      .filter((item) => {
        if (places && item.levels.length === 0 && !(item.default_location_id && places.has(item.default_location_id))) return false;
        if (cats && !(item.category_id && cats.has(item.category_id))) return false;
        if (tagId && !item.tag_ids.includes(tagId)) return false;
        if (type && item.type !== type) return false;
        if (tab === "low" && !isLow(item.quantity, item.min_quantity)) return false;
        if (tab === "expiring" && !expiresSoon(item.next_expiry, now)) return false;
        if (q) {
          const haystack = [
            item.name,
            item.brand,
            item.barcode,
            item.category_name,
            item.notes,
            item.vendor_id && vendorNames.get(item.vendor_id),
            ...item.tag_ids.map((id) => tagNames.get(id)),
          ];
          if (!haystack.some((h) => h && fold(h).includes(q))) return false;
        }
        return true;
      });
  }, [data, taxonomy, query, tab, type, locationId, categoryId, tagId, now]);

  const filtered = Boolean(query.trim() || type || locationId || categoryId || tagId);

  async function quick(item: ItemListItem, action: "add" | "consume") {
    setActionError(undefined);
    const delta = action === "add" ? 1 : -1;
    mutate((list) => list?.map((i) => (i.id === item.id ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i)));
    try {
      const { movements: _m, purchases: _p, ...updated } = await api.post<ItemDetail>(`/items/${item.id}/stock`, { action, quantity: 1 });
      mutate((list) => list?.map((i) => (i.id === item.id ? updated : i)));
    } catch (err) {
      setActionError((err as Error).message);
      reload();
    }
  }

  async function onScan(result: ScanResult) {
    setScanning(false);
    try {
      const found = await api.get<BarcodeLookup>(`/items/lookup?barcode=${encodeURIComponent(result.rawValue)}`);
      if (found.item_id) navigate(`/voorraad/${found.item_id}`);
      else navigate(`/voorraad/nieuw?barcode=${encodeURIComponent(result.rawValue)}`, { state: { suggestion: found.suggestion } });
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  const groups = taxonomy ? groupByCategory(shown, taxonomy) : [];
  let index = 0;

  return (
    <div className="page">
      <PageHead
        title="Voorraad"
        badge={counts && counts.low > 0 ? <span className="badge badge-warning">{counts.low} bijna op</span> : undefined}
        description="Wat er in huis is, waar het ligt en wanneer het vervalt"
        primary={
          <Link to="/voorraad/nieuw" className="btn btn-primary">
            <Icon name="plus" size={16} /> Nieuw item
          </Link>
        }
      />

      <Tabs
        label="Voorraad"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "all", label: "Alles", count: counts?.all },
          { value: "low", label: "Bijna op", count: counts?.low },
          { value: "expiring", label: "Vervalt binnenkort", count: counts?.expiring },
          { value: "archived", label: "Archief" },
        ]}
      />

      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder="Zoek op naam, merk, verkoper…"
            aria-label="Zoek op naam, merk, barcode, verkoper, categorie, tag of notitie"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button type="button" className="btn btn-outline btn-icon" onClick={() => setScanning(true)} aria-label="Barcode scannen">
          <Icon name="scan" />
        </button>
      </div>

      {taxonomy && (
        <div className="filters">
          <FilterSelect
            label="Soort"
            all="Alle"
            value={type}
            onChange={(v) => setType(v as ItemType | null)}
            options={(Object.keys(ITEM_TYPES) as ItemType[]).map((t) => ({ value: t, label: ITEM_TYPES[t].label }))}
          />
          <FilterSelect
            label="Plaats"
            all="Overal"
            value={locationId}
            onChange={setLocationId}
            options={locationTree(taxonomy).map((l) => ({ value: l.id, label: l.name, depth: l.depth }))}
          />
          <FilterSelect
            label="Categorie"
            all="Alle"
            value={categoryId}
            onChange={setCategoryId}
            options={categoryTree(taxonomy, "item").map((c) => ({ value: c.id, label: c.name, depth: c.depth }))}
          />
          {taxonomy.tags.length > 0 && (
            <FilterSelect label="Tag" all="Alle" value={tagId} onChange={setTagId} options={taxonomy.tags.map((t) => ({ value: t.id, label: t.name }))} />
          )}
        </div>
      )}

      {(error || actionError) && <p className="error">{error ?? actionError}</p>}
      {(!data || !taxonomy) && loading && <SkeletonRows rows={6} />}
      {!error && !loading && taxonomy && shown.length === 0 && (
        <EmptyState
          icon="package"
          title={filtered || tab !== "all" ? "Niets gevonden" : "Nog niets in voorraad"}
          action={
            !filtered &&
            tab === "all" && (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setScanning(true)}>
                <Icon name="scan" size={16} /> Scan iets uit je kast
              </button>
            )
          }
        >
          {filtered || tab !== "all" ? "Pas de filters aan of kies een andere tab." : "Scan een barcode: naam, merk en categorie komen vanzelf."}
        </EmptyState>
      )}

      {taxonomy && shown.length > 0 && (
        <div className="card table table-stock">
          <div className="table-head" aria-hidden="true">
            <span>Item</span>
            <span>Plaats</span>
            <span className="xl">Vervalt</span>
            <span className="xl">Niveau</span>
            <span className="end">Voorraad</span>
          </div>
          <ul className="rows stagger" key={tab}>
            {groups.map((group) => (
              <Fragment key={group.id ?? "none"}>
                <li className="group-row" style={stagger(index++)}>
                  <span className={`dot tone-${group.tone}`} />
                  {group.name}
                  <span className="group-count">{group.items.length}</span>
                </li>
                {group.items.map((item) => (
                  <li key={item.id} style={stagger(index++)}>
                    <StockRow item={item} taxonomy={taxonomy} onQuick={quick} />
                  </li>
                ))}
              </Fragment>
            ))}
          </ul>
        </div>
      )}

      <Link to="/voorraad/nieuw" className="fab" aria-label="Nieuw item">
        <Icon name="plus" size={24} />
      </Link>

      {scanning && <BarcodeScanner hint="Scan een product" onResult={onScan} onClose={() => setScanning(false)} />}
    </div>
  );
}

/** Groepeert per hoofdcategorie, in de volgorde van de categorieënlijst; "Zonder categorie" achteraan. */
function groupByCategory(items: ItemListItem[], taxonomy: Taxonomy) {
  const order = flattenTree(taxonomy.categories.filter((c) => c.domain === "item")).map((c) => c.id);
  const groups = new Map<string | null, ItemListItem[]>();
  for (const item of items) {
    const root = item.category_id ? (rootOf(taxonomy.categories, item.category_id)?.id ?? null) : null;
    groups.set(root, [...(groups.get(root) ?? []), item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : order.indexOf(a) - order.indexOf(b)))
    .map(([id, list]) => ({
      id,
      name: taxonomy.categories.find((c) => c.id === id)?.name ?? "Zonder categorie",
      tone: categoryTone(taxonomy, id),
      items: list,
    }));
}

function StockRow({
  item,
  taxonomy,
  onQuick,
}: {
  item: ItemListItem;
  taxonomy: Taxonomy;
  onQuick: (item: ItemListItem, action: "add" | "consume") => void;
}) {
  const low = isLow(item.quantity, item.min_quantity);
  const expiry = expiryBadge(item.next_expiry);
  const places = item.levels
    .map((l) => taxonomy.locations.find((loc) => loc.id === l.location_id)?.name)
    .filter(Boolean)
    .join(", ");
  const subcategory = item.category_id && rootOf(taxonomy.categories, item.category_id)?.id !== item.category_id ? item.category_name : null;
  // "Diepvries · Diepvries" (categorie en plaats) één keer tonen.
  const meta = [...new Set([subcategory, places || null])].filter(Boolean).join(" · ");

  return (
    <div className={`row stock-item ${item.quantity === 0 ? "empty-stock" : ""}`}>
      <Link to={`/voorraad/${item.id}`} className="row-link">
        <span className={`row-media tone-${categoryTone(taxonomy, item.category_id)}`}>
          <span className="letter">{item.name.charAt(0).toUpperCase()}</span>
        </span>
        <span className="row-main">
          <span className="row-title">{item.name}</span>
          {(meta || low || expiry || subcategory) && (
            <span className="row-meta">
              {meta && <span className="narrow-only">{meta}</span>}
              {subcategory && <span className="wide-only">{subcategory}</span>}
              {low && <span className="badge badge-warning">{item.quantity === 0 ? "Op" : "Bijna op"}</span>}
              {expiry && <span className={`badge ${expiry.className} narrow-only`}>{expiry.label}</span>}
            </span>
          )}
        </span>
      </Link>
      <span className="col">
        <span>{places || "—"}</span>
      </span>
      <span className="col xl">{expiry ? <span className={`badge ${expiry.className}`}>{expiry.label}</span> : <span className="muted">—</span>}</span>
      <span className="col xl">{item.min_quantity !== null && item.type === "consumable" ? <LevelMeter quantity={item.quantity} min={item.min_quantity} /> : <span className="muted">—</span>}</span>
      {item.type === "consumable" ? (
        <div className="stepper col-end">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={item.quantity <= 0}
            onClick={() => onQuick(item, "consume")}
            aria-label={`Eén ${item.name} verbruikt`}
          >
            <Icon name="minus" size={16} />
          </button>
          <span className="stepper-value">
            <strong>
              <Num value={item.quantity}>{formatNumber(item.quantity)}</Num>
            </strong>
            <small>{unitWord(item.quantity, item.unit)}</small>
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => onQuick(item, "add")} aria-label={`Eén ${item.name} erbij`}>
            <Icon name="plus" size={16} />
          </button>
        </div>
      ) : (
        <span className="row-end">
          {formatNumber(item.quantity)} <span className="muted small">{unitWord(item.quantity, item.unit)}</span>
        </span>
      )}
    </div>
  );
}
