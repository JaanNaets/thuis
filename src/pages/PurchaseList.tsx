import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Link } from "../router";
import type { PurchaseListItem } from "../../shared/types";
import { useApi } from "../api";
import { FilterToggle, Tabs } from "../components/Controls";
import { Icon } from "../components/Icon";
import { SkeletonRows, stagger } from "../components/Motion";
import { EmptyState, PageHead, toneForCategory } from "../components/Page";
import { formatCents, formatDate, warrantyStatus, type WarrantyStatus } from "../format";
import { useTaxonomy } from "../taxonomy";

export const WARRANTY_BADGE: Record<WarrantyStatus["tone"], string> = {
  ok: "badge-success",
  soon: "badge-warning",
  expired: "badge-secondary badge-muted",
  none: "badge-muted",
};

const hasWarranty = (p: PurchaseListItem) => ["ok", "soon"].includes(warrantyStatus(p.warranty_until).tone);

type Tab = "all" | "warranty";

export function PurchaseList() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  // Vanuit Instellingen → Verkopers: enkel de aankopen bij die verkoper.
  const [searchParams, setSearchParams] = useSearchParams();
  const vendorId = searchParams.get("verkoper");
  const { data: taxonomy } = useTaxonomy();
  const vendor = taxonomy?.vendors.find((v) => v.id === vendorId);
  const debouncedQuery = useDebounced(query.trim(), 300);
  const filtered = Boolean(debouncedQuery) || Boolean(vendorId);

  const params = new URLSearchParams();
  if (debouncedQuery) params.set("q", debouncedQuery);
  if (vendorId) params.set("vendor", vendorId);
  const { data, error, loading } = useApi<PurchaseListItem[]>(`/purchases?${params}`);
  const withWarranty = data?.filter(hasWarranty) ?? [];
  const shown = tab === "warranty" ? withWarranty : (data ?? []);

  return (
    <div className="page">
      <PageHead
        title="Aankopen"
        description="Kastickets, facturen en garanties, met wie wat betaalde"
        primary={
          <Link to="/aankopen/nieuw" className="btn btn-primary">
            <Icon name="plus" size={16} /> Nieuwe aankoop
          </Link>
        }
      />

      <Tabs
        label="Aankopen"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "all", label: filtered ? "Resultaten" : "Alle", count: data?.length },
          { value: "warranty", label: "Met garantie", count: data ? withWarranty.length : undefined },
        ]}
      />

      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder="Zoek op omschrijving, verkoper, tag…"
            aria-label="Zoek op omschrijving, verkoper, categorie, tag of notitie"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {vendorId && (
        <div className="filters">
          <FilterToggle on onChange={() => setSearchParams({}, { replace: true })}>
            <Icon name="store" size={14} /> {vendor?.name ?? "Verkoper"} <Icon name="close" size={14} />
          </FilterToggle>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {!data && loading && <SkeletonRows />}
      {data && shown.length === 0 && (
        <EmptyState
          icon="receipt"
          title={filtered || tab !== "all" ? "Niets gevonden" : "Nog geen aankopen"}
          action={
            !filtered &&
            tab === "all" && (
              <Link to="/aankopen/nieuw" className="btn btn-outline btn-sm">
                <Icon name="plus" size={16} /> Eerste aankoop
              </Link>
            )
          }
        >
          {filtered || tab !== "all" ? "Probeer een ander woord of een andere tab." : "Trek een foto van een kasticket: de app vult de rest in."}
        </EmptyState>
      )}

      {shown.length > 0 && (
        <div className="card table table-purchases">
          <div className="table-head" aria-hidden="true">
            <span>Aankoop</span>
            <span>Verkoper</span>
            <span>Datum</span>
            <span className="xl">Garantie</span>
            <span className="end">Bedrag</span>
          </div>
          <ul className="rows stagger" key={tab}>
            {shown.map((p, i) => {
              const warranty = warrantyStatus(p.warranty_until);
              const tone = p.category_color ?? toneForCategory(p.category_name);
              const running = warranty.tone === "ok" || warranty.tone === "soon";
              return (
                <li key={p.id} style={stagger(i)}>
                  <Link to={`/aankopen/${p.id}`} className="row">
                    <span className="cell-main">
                      <span className={`row-media ${p.thumbnail_file_id ? "" : `tone-${tone}`}`}>
                        {p.thumbnail_file_id ? (
                          <img src={`/api/files/${p.thumbnail_file_id}`} alt="" loading="lazy" />
                        ) : (
                          <Icon name={p.file_count > 0 ? "file" : "receipt"} size={17} />
                        )}
                      </span>
                      <span className="row-main">
                        <span className="row-title">{p.description}</span>
                        <span className="row-meta narrow-only">
                          <span>{[p.vendor_name, formatDate(p.purchased_on)].filter(Boolean).join(" · ")}</span>
                          {running && <span className={`badge ${WARRANTY_BADGE[warranty.tone]}`}>{warranty.label}</span>}
                        </span>
                        {p.category_name && <span className="row-meta wide-only">{p.category_name}</span>}
                      </span>
                    </span>
                    <span className="col">
                      <span>{p.vendor_name ?? "—"}</span>
                    </span>
                    <span className="col">
                      <span>{formatDate(p.purchased_on)}</span>
                    </span>
                    <span className="col xl">{running && <span className={`badge ${WARRANTY_BADGE[warranty.tone]}`}>{warranty.label}</span>}</span>
                    <span className="row-end">{formatCents(p.amount_cents)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Link to="/aankopen/nieuw" className="fab" aria-label="Nieuwe aankoop">
        <Icon name="plus" size={24} />
      </Link>
    </div>
  );
}

/** Wacht tot je even stopt met typen voor we de server bevragen. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
