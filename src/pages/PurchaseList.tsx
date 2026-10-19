import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { PurchaseListItem } from "../../shared/types";
import { useApi } from "../api";
import { Icon } from "../components/Icon";
import { EmptyState, PageHero, toneForCategory } from "../components/Page";
import { formatCents, formatDate, warrantyStatus } from "../format";

export function PurchaseList() {
  const [query, setQuery] = useState("");
  const [onlyWarranty, setOnlyWarranty] = useState(false);
  const debouncedQuery = useDebounced(query.trim(), 300);
  const filtered = Boolean(debouncedQuery) || onlyWarranty;

  const params = new URLSearchParams();
  if (debouncedQuery) params.set("q", debouncedQuery);
  if (onlyWarranty) params.set("warranty", "active");
  const { data, error, loading } = useApi<PurchaseListItem[]>(`/purchases?${params}`);

  return (
    <div className="page">
      <PageHero
        title="Aankopen"
        tone="peach"
        summary={data && <Summary items={data} filtered={filtered} />}
        action={
          <Link to="/aankopen/nieuw" className="button primary">
            <Icon name="plus" /> Nieuwe aankoop
          </Link>
        }
      />

      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder="Zoeken"
            aria-label="Zoek op omschrijving, winkel of categorie"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={`chip ${onlyWarranty ? "active" : ""}`}
          aria-pressed={onlyWarranty}
          onClick={() => setOnlyWarranty((v) => !v)}
        >
          Met garantie
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {!error && !loading && data?.length === 0 && (
        <EmptyState icon="receipt" tone="peach">
          {filtered ? "Niets gevonden." : "Nog geen aankopen. Trek een foto van je eerste kasticket."}
        </EmptyState>
      )}

      <ul className="list">
        {data?.map((p) => {
          const warranty = warrantyStatus(p.warranty_until);
          return (
            <li key={p.id}>
              <Link to={`/aankopen/${p.id}`} className="list-item">
                <div className={`thumb tone-${toneForCategory(p.category)}`}>
                  {p.thumbnail_file_id ? (
                    <img src={`/api/files/${p.thumbnail_file_id}`} alt="" loading="lazy" />
                  ) : (
                    <Icon name={p.file_count > 0 ? "file" : "receipt"} />
                  )}
                </div>
                <div className="list-main">
                  <strong>{p.description}</strong>
                  <span className="muted">
                    {[p.store, formatDate(p.purchased_on)].filter(Boolean).join(" · ")}
                  </span>
                  {warranty.tone !== "none" && <span className={`badge ${warranty.tone}`}>{warranty.label}</span>}
                </div>
                <span className="amount">{formatCents(p.amount_cents)}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <Link to="/aankopen/nieuw" className="fab" aria-label="Nieuwe aankoop">
        <Icon name="plus" size={26} />
      </Link>
    </div>
  );
}

function Summary({ items, filtered }: { items: PurchaseListItem[]; filtered: boolean }) {
  if (filtered) return <>{items.length === 1 ? "1 resultaat" : `${items.length} resultaten`}</>;
  if (items.length === 0) return null;
  const running = items.filter((p) => ["ok", "soon"].includes(warrantyStatus(p.warranty_until).tone)).length;
  return (
    <>
      {items.length === 1 ? "1 aankoop bewaard" : `${items.length} aankopen bewaard`}
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
