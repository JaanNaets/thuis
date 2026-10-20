import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { expiresSoon, isLow } from "../../shared/stock";
import { descendantIds, flattenTree, rootOf } from "../../shared/tree";
import { UNITS, type BarcodeLookup, type ItemDetail, type ItemListItem, type ItemType, type Taxonomy } from "../../shared/types";
import { api, useApi } from "../api";
import type { ScanResult } from "../barcode-detect";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { TreeSelect } from "../components/Controls";
import { Icon } from "../components/Icon";
import { Num, SkeletonRows, stagger } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { daysUntil, formatDate, formatNumber, today } from "../format";
import { categoryTone, categoryTree, locationTree, useTaxonomy } from "../taxonomy";

type View = "all" | "low" | "expiring";

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
  const [view, setView] = useState<View>("all");
  const [type, setType] = useState<ItemType | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [tagId, setTagId] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [actionError, setActionError] = useState<string>();

  const { data, error, loading, reload, mutate } = useApi<ItemListItem[]>(archived ? "/items?archived=1" : "/items");
  const { data: taxonomy } = useTaxonomy();
  const now = today();

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
        if (view === "low" && !isLow(item.quantity, item.min_quantity)) return false;
        if (view === "expiring" && !expiresSoon(item.next_expiry, now)) return false;
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
  }, [data, taxonomy, query, view, type, locationId, categoryId, tagId, now]);

  const lowCount = data?.filter((i) => isLow(i.quantity, i.min_quantity)).length ?? 0;
  const expiringCount = data?.filter((i) => expiresSoon(i.next_expiry, now)).length ?? 0;
  const filtered = Boolean(query.trim() || view !== "all" || type || locationId || categoryId || tagId || archived);

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

  const description = data ? (
    archived ? (
      "Gearchiveerd: weg uit huis, geschiedenis bewaard"
    ) : (
      <>
        {data.length === 1 ? "1 item" : `${data.length} items`}
        {lowCount > 0 && ` · ${lowCount} bijna op`}
        {expiringCount > 0 && ` · ${expiringCount} vervalt binnenkort`}
      </>
    )
  ) : (
    " "
  );

  return (
    <div className="page">
      <PageHead
        title="Voorraad"
        description={description}
        primary={
          <Link to="/voorraad/nieuw" className="btn btn-primary">
            <Icon name="plus" size={16} /> Nieuw item
          </Link>
        }
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

      <div className="chips" role="group" aria-label="Snelle filters">
        <Chip on={view === "low"} onClick={() => setView(view === "low" ? "all" : "low")} count={lowCount}>
          Bijna op
        </Chip>
        <Chip on={view === "expiring"} onClick={() => setView(view === "expiring" ? "all" : "expiring")} count={expiringCount}>
          Vervalt binnenkort
        </Chip>
        <Chip on={type === "consumable"} onClick={() => setType(type === "consumable" ? null : "consumable")}>
          Verbruik
        </Chip>
        <Chip on={type === "asset"} onClick={() => setType(type === "asset" ? null : "asset")}>
          Bezit
        </Chip>
        <Chip on={archived} onClick={() => setArchived((a) => !a)}>
          <Icon name="archive" size={14} /> Archief
        </Chip>
      </div>

      {taxonomy && (
        <div className="filter-row">
          <TreeSelect
            label="Plaats"
            className={locationId ? "active" : undefined}
            nodes={locationTree(taxonomy)}
            value={locationId}
            onChange={setLocationId}
            empty="Alle plaatsen"
          />
          <TreeSelect
            label="Categorie"
            className={categoryId ? "active" : undefined}
            nodes={categoryTree(taxonomy, "item")}
            value={categoryId}
            onChange={setCategoryId}
            empty="Alle categorieën"
          />
          {taxonomy.tags.length > 0 && (
            <select aria-label="Tag" className={tagId ? "active" : undefined} value={tagId ?? ""} onChange={(e) => setTagId(e.target.value || null)}>
              <option value="">Alle tags</option>
              {taxonomy.tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {(error || actionError) && <p className="error">{error ?? actionError}</p>}
      {(!data || !taxonomy) && loading && <SkeletonRows rows={6} />}
      {!error && !loading && taxonomy && shown.length === 0 && (
        <EmptyState
          icon="package"
          title={filtered ? "Niets gevonden" : "Nog niets in voorraad"}
          action={
            !filtered && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setScanning(true)}>
                <Icon name="scan" size={16} /> Scan iets uit je kast
              </button>
            )
          }
        >
          {filtered ? "Pas de filters aan of zoek op iets anders." : "Scan een barcode: naam, merk en categorie komen vanzelf."}
        </EmptyState>
      )}

      {taxonomy &&
        groupByCategory(shown, taxonomy).map((group) => (
          <section key={group.id ?? "none"} className="group">
            <h2 className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className={`dot tone-${group.tone}`} />
              {group.name}
              <span style={{ color: "var(--ring)" }}>{group.items.length}</span>
            </h2>
            <div className="card">
              <ul className="rows stagger">
                {group.items.map((item, i) => (
                  <li key={item.id} style={stagger(i)}>
                    <StockRow item={item} taxonomy={taxonomy} onQuick={quick} />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}

      <Link to="/voorraad/nieuw" className="fab" aria-label="Nieuw item">
        <Icon name="plus" size={24} />
      </Link>

      {scanning && <BarcodeScanner hint="Scan een product" onResult={onScan} onClose={() => setScanning(false)} />}
    </div>
  );
}

function Chip({ on, onClick, count, children }: { on: boolean; onClick: () => void; count?: number; children: ReactNode }) {
  return (
    <button type="button" className="chip" aria-pressed={on} onClick={onClick}>
      {children}
      {count !== undefined && count > 0 && <span className="chip-count">{count}</span>}
    </button>
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
          {(meta || low || expiry) && (
            <span className="row-meta">
              {meta && <span>{meta}</span>}
              {low && <span className="badge badge-warning">{item.quantity === 0 ? "Op" : "Bijna op"}</span>}
              {expiry && <span className={`badge ${expiry.className}`}>{expiry.label}</span>}
            </span>
          )}
        </span>
      </Link>
      {item.type === "consumable" ? (
        <div className="stepper">
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
