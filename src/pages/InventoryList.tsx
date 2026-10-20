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
import { EmptyState, PageHero, toneForCategory } from "../components/Page";
import { daysUntil, formatDate, formatQuantity, today } from "../format";
import { categoryTone, categoryTree, locationTree, useTaxonomy } from "../taxonomy";

type View = "all" | "low" | "expiring";

/** Zoeken zonder op hoofdletters of accenten te letten ("creme" vindt "Crème"). */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function expiryBadge(nextExpiry: string | null): { label: string; tone: "soon" | "expired" } | null {
  if (!nextExpiry || !expiresSoon(nextExpiry, today())) return null;
  const days = daysUntil(nextExpiry);
  if (days < 0) return { label: "Vervallen", tone: "expired" };
  if (days === 0) return { label: "Vervalt vandaag", tone: "soon" };
  if (days === 1) return { label: "Vervalt morgen", tone: "soon" };
  return { label: `Vervalt ${formatDate(nextExpiry).replace(/ \d{4}$/, "")}`, tone: "soon" };
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
          const haystack = [item.name, item.brand, item.barcode, item.category_name, ...item.tag_ids.map((id) => tagNames.get(id))];
          if (!haystack.some((h) => h && fold(h).includes(q))) return false;
        }
        return true;
      });
  }, [data, taxonomy, query, view, type, locationId, categoryId, tagId, now]);

  const lowCount = data?.filter((i) => isLow(i.quantity, i.min_quantity)).length ?? 0;
  const expiringCount = data?.filter((i) => expiresSoon(i.next_expiry, now)).length ?? 0;
  const filtered = Boolean(query.trim() || view !== "all" || type || locationId || categoryId || tagId);

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

  const summary = data && !archived && (
    <>
      {data.length === 1 ? "1 item" : `${data.length} items`}
      {lowCount > 0 && ` · ${lowCount} bijna op`}
      {expiringCount > 0 && ` · ${expiringCount} vervalt binnenkort`}
    </>
  );

  return (
    <div className="page">
      <PageHero
        title="Voorraad"
        tone="sky"
        summary={summary}
        action={
          <Link to="/voorraad/nieuw" className="button primary">
            <Icon name="plus" /> Nieuw item
          </Link>
        }
      />

      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder="Zoeken"
            aria-label="Zoek op naam, merk, barcode, categorie of tag"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button type="button" className="icon-button tinted tone-sky" onClick={() => setScanning(true)} aria-label="Barcode scannen">
          <Icon name="scan" />
        </button>
      </div>

      <div className="chips" role="group" aria-label="Snelle filters">
        <Chip on={view === "all" && !type && !archived} onClick={() => (setView("all"), setType(null), setArchived(false))}>
          Alles
        </Chip>
        <Chip on={view === "low"} onClick={() => setView(view === "low" ? "all" : "low")} tone="butter">
          Bijna op{lowCount > 0 && ` · ${lowCount}`}
        </Chip>
        <Chip on={view === "expiring"} onClick={() => setView(view === "expiring" ? "all" : "expiring")} tone="rose">
          Vervalt binnenkort{expiringCount > 0 && ` · ${expiringCount}`}
        </Chip>
        <Chip on={type === "consumable"} onClick={() => setType(type === "consumable" ? null : "consumable")}>
          Verbruik
        </Chip>
        <Chip on={type === "asset"} onClick={() => setType(type === "asset" ? null : "asset")}>
          Bezit
        </Chip>
        <Chip on={archived} onClick={() => setArchived((a) => !a)}>
          <Icon name="archive" size={16} /> Archief
        </Chip>
      </div>

      {taxonomy && (
        <div className="filter-row">
          <TreeSelect
            className={locationId ? "active" : undefined}
            nodes={locationTree(taxonomy)}
            value={locationId}
            onChange={setLocationId}
            empty="Alle plaatsen"
          />
          <TreeSelect
            className={categoryId ? "active" : undefined}
            nodes={categoryTree(taxonomy, "item")}
            value={categoryId}
            onChange={setCategoryId}
            empty="Alle categorieën"
          />
          {taxonomy.tags.length > 0 && (
            <select className={tagId ? "active" : undefined} value={tagId ?? ""} onChange={(e) => setTagId(e.target.value || null)}>
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
      {!error && !loading && taxonomy && shown.length === 0 && (
        <EmptyState icon="package" tone="sky">
          {filtered || archived ? "Niets gevonden." : "Nog niets in voorraad. Scan de barcode van iets uit je kast."}
        </EmptyState>
      )}

      {taxonomy &&
        groupByCategory(shown, taxonomy).map((group) => (
          <section key={group.id ?? "none"} className="stock-group">
            <h2 className={`group-title tone-${group.tone}`}>
              <span>{group.name}</span>
              <span className="group-count">{group.items.length}</span>
            </h2>
            <ul className="list">
              {group.items.map((item) => (
                <li key={item.id}>
                  <StockRow item={item} taxonomy={taxonomy} onQuick={quick} />
                </li>
              ))}
            </ul>
          </section>
        ))}

      <Link to="/voorraad/nieuw" className="fab" aria-label="Nieuw item">
        <Icon name="plus" size={26} />
      </Link>

      {scanning && <BarcodeScanner hint="Scan een product" onResult={onScan} onClose={() => setScanning(false)} />}
    </div>
  );
}

function Chip({ on, onClick, tone = "sage", children }: { on: boolean; onClick: () => void; tone?: string; children: ReactNode }) {
  return (
    <button type="button" className={`chip tone-${tone} ${on ? "active" : ""}`} aria-pressed={on} onClick={onClick}>
      {children}
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
    .map(([id, list]) => {
      const category = taxonomy.categories.find((c) => c.id === id);
      return {
        id,
        name: category?.name ?? "Zonder categorie",
        tone: id ? categoryTone(taxonomy, id) : toneForCategory(null),
        items: list,
      };
    });
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

  return (
    <div className={`list-item stock-item ${item.quantity === 0 ? "empty-stock" : ""}`}>
      <Link to={`/voorraad/${item.id}`} className="stock-link">
        <div className={`thumb tone-${categoryTone(taxonomy, item.category_id)}`}>
          <span className="thumb-letter">{item.name.charAt(0).toUpperCase()}</span>
        </div>
        <div className="list-main">
          <strong>{item.name}</strong>
          <span className="muted">
            {/* "Diepvries · Diepvries" (categorie en plaats) één keer tonen. */}
            {[...new Set([subcategory, places || (item.quantity === 0 ? "op" : null)])].filter(Boolean).join(" · ")}
          </span>
          {(low || expiry) && (
            <span className="badges">
              {low && <span className="badge low">{item.quantity === 0 ? "Op" : "Bijna op"}</span>}
              {expiry && <span className={`badge ${expiry.tone}`}>{expiry.label}</span>}
            </span>
          )}
        </div>
      </Link>
      {item.type === "consumable" ? (
        <div className="stepper">
          <button
            type="button"
            className="icon-button"
            disabled={item.quantity <= 0}
            onClick={() => onQuick(item, "consume")}
            aria-label={`Eén ${item.name} verbruikt`}
          >
            <Icon name="minus" />
          </button>
          <span className="stepper-value">
            <strong>{formatQuantity(item.quantity, item.unit, UNITS).split(" ")[0]}</strong>
            <span>{formatQuantity(item.quantity, item.unit, UNITS).split(" ").slice(1).join(" ")}</span>
          </span>
          <button type="button" className="icon-button" onClick={() => onQuick(item, "add")} aria-label={`Eén ${item.name} erbij`}>
            <Icon name="plus" />
          </button>
        </div>
      ) : (
        <span className="amount">{formatQuantity(item.quantity, item.unit, UNITS)}</span>
      )}
    </div>
  );
}
