import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { PurchaseListItem } from "../../shared/types";
import { useApi } from "../api";
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

export function PurchaseList() {
  const [query, setQuery] = useState("");
  const [onlyWarranty, setOnlyWarranty] = useState(false);
  // Vanuit Meer → Verkopers: enkel de aankopen bij die verkoper.
  const [searchParams, setSearchParams] = useSearchParams();
  const vendorId = searchParams.get("verkoper");
  const { data: taxonomy } = useTaxonomy();
  const vendor = taxonomy?.vendors.find((v) => v.id === vendorId);
  const debouncedQuery = useDebounced(query.trim(), 300);
  const filtered = Boolean(debouncedQuery) || onlyWarranty || Boolean(vendorId);

  const params = new URLSearchParams();
  if (debouncedQuery) params.set("q", debouncedQuery);
  if (onlyWarranty) params.set("warranty", "active");
  if (vendorId) params.set("vendor", vendorId);
  const { data, error, loading } = useApi<PurchaseListItem[]>(`/purchases?${params}`);

  return (
    <div className="page">
      <PageHead
        title="Aankopen"
        description={data ? <Summary items={data} filtered={filtered} /> : " "}
        primary={
          <Link to="/aankopen/nieuw" className="btn btn-primary">
            <Icon name="plus" size={16} /> Nieuwe aankoop
          </Link>
        }
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
      <div className="chips">
        {vendorId && (
          <button type="button" className="chip" aria-pressed="true" onClick={() => setSearchParams({}, { replace: true })}>
            <Icon name="store" size={14} /> {vendor?.name ?? "Verkoper"} <Icon name="close" size={14} />
          </button>
        )}
        <button type="button" className="chip" aria-pressed={onlyWarranty} onClick={() => setOnlyWarranty((v) => !v)}>
          <Icon name="clock" size={14} /> Met lopende garantie
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {!data && loading && <SkeletonRows />}
      {data?.length === 0 && (
        <EmptyState
          icon="receipt"
          title={filtered ? "Niets gevonden" : "Nog geen aankopen"}
          action={
            !filtered && (
              <Link to="/aankopen/nieuw" className="btn btn-primary btn-sm">
                <Icon name="plus" size={16} /> Eerste aankoop
              </Link>
            )
          }
        >
          {filtered ? "Probeer een ander woord." : "Trek een foto van een kasticket: de app vult de rest in."}
        </EmptyState>
      )}

      {data && data.length > 0 && (
        <div className="card">
          <ul className="rows stagger">
            {data.map((p, i) => {
              const warranty = warrantyStatus(p.warranty_until);
              const tone = p.category_color ?? toneForCategory(p.category_name);
              return (
                <li key={p.id} style={stagger(i)}>
                  <Link to={`/aankopen/${p.id}`} className="row">
                    <span className={`row-media ${p.thumbnail_file_id ? "" : `tone-${tone}`}`}>
                      {p.thumbnail_file_id ? (
                        <img src={`/api/files/${p.thumbnail_file_id}`} alt="" loading="lazy" />
                      ) : (
                        <Icon name={p.file_count > 0 ? "file" : "receipt"} size={18} />
                      )}
                    </span>
                    <span className="row-main">
                      <span className="row-title">{p.description}</span>
                      <span className="row-meta">
                        <span>{[p.vendor_name, formatDate(p.purchased_on)].filter(Boolean).join(" · ")}</span>
                        {(warranty.tone === "ok" || warranty.tone === "soon") && (
                          <span className={`badge ${WARRANTY_BADGE[warranty.tone]}`}>{warranty.label}</span>
                        )}
                      </span>
                    </span>
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

function Summary({ items, filtered }: { items: PurchaseListItem[]; filtered: boolean }) {
  if (filtered) return <>{items.length === 1 ? "1 resultaat" : `${items.length} resultaten`}</>;
  if (items.length === 0) return <>Kastickets, facturen en garanties</>;
  const running = items.filter((p) => ["ok", "soon"].includes(warrantyStatus(p.warranty_until).tone)).length;
  return (
    <>
      {items.length === 1 ? "1 aankoop" : `${items.length} aankopen`}
      {running > 0 && ` · ${running} met lopende garantie`}
    </>
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
