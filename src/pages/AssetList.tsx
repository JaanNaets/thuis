import { Fragment, useMemo, useState } from "react";
import { descendantIds } from "../../shared/tree";
import { ITEM_ORIGINS, type ItemListItem, type ItemOrigin, type Taxonomy } from "../../shared/types";
import { useApi } from "../api";
import { FilterSelect, Tabs } from "../components/Controls";
import { Icon } from "../components/Icon";
import { SkeletonRows, stagger } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { formatCents, formatDate, warrantyStatus } from "../format";
import { Link } from "../router";
import { categoryTone, categoryTree, locationTree, placeName, useTaxonomy } from "../taxonomy";
import { groupByCategory } from "./InventoryList";
import { WARRANTY_BADGE } from "./PurchaseList";

type Tab = "all" | "warranty" | "archived";

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** "Gekocht bij Coolblue", "Gekregen van Marc", "Had ik al". */
export function originText(item: Pick<ItemListItem, "origin" | "origin_note" | "bought_at">): string | null {
  switch (item.origin) {
    case "bought":
      return item.bought_at ? `Gekocht bij ${item.bought_at}` : "Gekocht";
    case "gift":
      return item.origin_note ? `Gekregen van ${item.origin_note}` : "Gekregen";
    case "had":
      return item.origin_note ? `Had ik al · ${item.origin_note}` : "Had ik al";
    default:
      return item.bought_at ? `Gekocht bij ${item.bought_at}` : null;
  }
}

const hasWarranty = (i: ItemListItem) => ["ok", "soon"].includes(warrantyStatus(i.warranty_until).tone);

/** Alles wat je hebt: gekocht, gekregen of al lang in huis, met wat het kostte en hoe lang de garantie nog loopt. */
export function AssetList() {
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<ItemOrigin | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const archived = tab === "archived";
  const { data, error, loading } = useApi<ItemListItem[]>(archived ? "/items?archived=1" : "/items");
  const { data: taxonomy } = useTaxonomy();

  const assets = useMemo(() => (data ?? []).filter((i) => i.type === "asset"), [data]);
  const shown = useMemo(() => {
    if (!taxonomy) return [];
    const places = locationId ? descendantIds(taxonomy.locations, locationId) : null;
    const cats = categoryId ? descendantIds(taxonomy.categories, categoryId) : null;
    const q = fold(query.trim());
    return assets.filter((i) => {
      if (tab === "warranty" && !hasWarranty(i)) return false;
      if (origin && i.origin !== origin) return false;
      if (cats && !(i.category_id && cats.has(i.category_id))) return false;
      if (places && !i.levels.some((l) => places.has(l.location_id)) && !(i.default_location_id && places.has(i.default_location_id))) return false;
      if (q && ![i.name, i.brand, i.category_name, i.notes, i.origin_note, i.bought_at].some((h) => h && fold(h).includes(q))) return false;
      return true;
    });
  }, [assets, taxonomy, tab, origin, locationId, categoryId, query]);

  const filtered = Boolean(query.trim() || origin || locationId || categoryId);
  const spent = assets.reduce((sum, i) => sum + i.cost_cents, 0);
  const groups = taxonomy ? groupByCategory(shown, taxonomy) : [];
  let index = 0;

  return (
    <div className="page">
      <PageHead
        title="Bezit"
        description={
          data && !archived && assets.length > 0
            ? `${assets.length === 1 ? "1 ding" : `${assets.length} dingen`} · ${formatCents(spent)} uitgegeven`
            : "Wat je hebt: gekocht, gekregen of al lang in huis"
        }
        primary={
          <Link to="/bezit/nieuw" className="btn btn-primary">
            <Icon name="plus" size={16} /> Nieuw bezit
          </Link>
        }
      />

      <Tabs
        label="Bezit"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "all", label: filtered ? "Resultaten" : "Alles", count: archived ? undefined : shown.length },
          { value: "warranty", label: "Met garantie", count: archived ? undefined : assets.filter(hasWarranty).length },
          { value: "archived", label: "Niet meer in huis" },
        ]}
      />

      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder="Zoek op naam, merk, van wie…"
            aria-label="Zoek op naam, merk, categorie, notitie of van wie"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {taxonomy && (
        <div className="filters">
          <FilterSelect
            label="Herkomst"
            all="Alle"
            value={origin}
            onChange={(v) => setOrigin(v as ItemOrigin | null)}
            options={(Object.keys(ITEM_ORIGINS) as ItemOrigin[]).map((o) => ({ value: o, label: ITEM_ORIGINS[o].label }))}
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
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {(!data || !taxonomy) && loading && <SkeletonRows rows={5} />}
      {data && taxonomy && shown.length === 0 && (
        <EmptyState
          icon="armchair"
          title={filtered || tab !== "all" ? "Niets gevonden" : "Nog geen bezit"}
          action={
            !filtered &&
            tab === "all" && (
              <Link to="/bezit/nieuw" className="btn btn-outline btn-sm">
                <Icon name="plus" size={16} /> Eerste ding
              </Link>
            )
          }
        >
          {filtered || tab !== "all"
            ? "Pas de filters aan of kies een andere tab."
            : "De kachel, de wasmachine, de fiets: met wat ze kostten, onderhoud, tips en wat erbij hoort."}
        </EmptyState>
      )}

      {taxonomy && shown.length > 0 && (
        <div className="card table table-assets">
          <div className="table-head" aria-hidden="true">
            <span>Ding</span>
            <span>Herkomst</span>
            <span>Sinds</span>
            <span className="xl">Garantie</span>
            <span className="end">Kosten</span>
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
                    <AssetRow item={item} taxonomy={taxonomy} />
                  </li>
                ))}
              </Fragment>
            ))}
          </ul>
        </div>
      )}

      <Link to="/bezit/nieuw" className="fab" aria-label="Nieuw bezit">
        <Icon name="plus" size={24} />
      </Link>
    </div>
  );
}

function AssetRow({ item, taxonomy }: { item: ItemListItem; taxonomy: Taxonomy }) {
  const warranty = warrantyStatus(item.warranty_until);
  const running = warranty.tone === "ok" || warranty.tone === "soon";
  const origin = originText(item);
  const place = placeName(taxonomy, item.levels[0]?.location_id ?? item.default_location_id);
  return (
    <Link to={`/bezit/${item.id}`} className="row">
      <span className="cell-main">
        <span className={`row-media tone-${categoryTone(taxonomy, item.category_id)}`}>
          <Icon name="armchair" size={16} />
        </span>
        <span className="row-main">
          <span className="row-title">{item.name}</span>
          <span className="row-meta narrow-only">
            <span>{[origin, item.acquired_on && formatDate(item.acquired_on)].filter(Boolean).join(" · ") || place || "—"}</span>
            {running && <span className={`badge ${WARRANTY_BADGE[warranty.tone]}`}>{warranty.label}</span>}
          </span>
          {(item.brand || place) && <span className="row-meta wide-only">{[item.brand, place].filter(Boolean).join(" · ")}</span>}
        </span>
      </span>
      <span className="col">{origin ? <span>{origin}</span> : <span className="muted">—</span>}</span>
      <span className="col">{item.acquired_on ? <span>{formatDate(item.acquired_on)}</span> : <span className="muted">—</span>}</span>
      <span className="col xl">
        {running ? <span className={`badge ${WARRANTY_BADGE[warranty.tone]}`}>{warranty.label}</span> : <span className="muted">—</span>}
      </span>
      <span className="row-end">
        {item.cost_cents ? (
          formatCents(item.cost_cents)
        ) : item.value_cents ? (
          <span className="muted">≈ {formatCents(item.value_cents)}</span>
        ) : (
          <span className="muted">—</span>
        )}
      </span>
    </Link>
  );
}
