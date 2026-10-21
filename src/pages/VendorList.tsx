import { useState } from "react";
import type { VendorListItem } from "../../shared/types";
import { VENDOR_KINDS, type VendorKind } from "../../shared/vendor";
import { useApi } from "../api";
import { FilterSelect, Tabs } from "../components/Controls";
import { Icon } from "../components/Icon";
import { SkeletonRows, stagger } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { VendorLogo } from "../components/VendorLogo";
import { formatCents, formatDate } from "../format";
import { Link } from "../router";

type Tab = "all" | VendorKind | "none";
type Sort = "name" | "total" | "recent";

const SORTS: { value: Sort; label: string }[] = [
  { value: "total", label: "Meest uitgegeven" },
  { value: "recent", label: "Laatst gekocht" },
];

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Winkels, webshops, vakmensen: waar je koopt, met je klantnummer, contacten en wat je er uitgaf. */
export function VendorList() {
  const { data, error, loading } = useApi<VendorListItem[]>("/vendors");
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("name");

  const q = fold(query.trim());
  const matches = (data ?? []).filter((v) => !q || [v.name, v.customer_number, v.category_name, v.notes].some((field) => field && fold(field).includes(q)));
  const count = (t: Tab) => matches.filter((v) => t === "all" || (t === "none" ? !v.kind : v.kind === t)).length;
  const kinds = (Object.keys(VENDOR_KINDS) as VendorKind[]).filter((k) => data?.some((v) => v.kind === k));
  const shown = matches
    .filter((v) => tab === "all" || (tab === "none" ? !v.kind : v.kind === tab))
    .sort((a, b) =>
      sort === "total" ? b.total_cents - a.total_cents : sort === "recent" ? (b.last_purchase_on ?? "").localeCompare(a.last_purchase_on ?? "") : 0,
    );

  return (
    <div className="page">
      <PageHead
        title="Verkopers"
        description="Winkels, webshops en vakmensen, met je account en contacten"
        primary={
          <Link to="/verkopers/nieuw" className="btn btn-primary">
            <Icon name="plus" size={16} /> Nieuwe verkoper
          </Link>
        }
      />

      {kinds.length > 0 && (
        <Tabs
          label="Soort"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "all", label: q ? "Resultaten" : "Alle", count: data ? count("all") : undefined },
            ...kinds.map((k) => ({ value: k as Tab, label: VENDOR_KINDS[k].plural, count: count(k) })),
            ...(data?.some((v) => !v.kind) ? [{ value: "none" as Tab, label: "Zonder soort", count: count("none") }] : []),
          ]}
        />
      )}

      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder="Zoek op naam, klantnummer, categorie…"
            aria-label="Zoek op naam, klantnummer, categorie of notitie"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="filters">
        <FilterSelect
          label="Volgorde"
          all="Naam"
          value={sort === "name" ? null : sort}
          onChange={(v) => setSort((v as Sort | null) ?? "name")}
          options={SORTS}
        />
      </div>

      {error && <p className="error">{error}</p>}
      {!data && loading && <SkeletonRows />}
      {data && shown.length === 0 && (
        <EmptyState
          icon="store"
          title={q || tab !== "all" ? "Niets gevonden" : "Nog geen verkopers"}
          action={
            !q &&
            tab === "all" && (
              <Link to="/verkopers/nieuw" className="btn btn-outline btn-sm">
                <Icon name="plus" size={16} /> Eerste verkoper
              </Link>
            )
          }
        >
          {q || tab !== "all" ? "Probeer een ander woord of een andere tab." : "Ze verschijnen ook vanzelf zodra je bij een aankoop een verkoper invult."}
        </EmptyState>
      )}

      {shown.length > 0 && (
        <div className="card table table-vendors">
          <div className="table-head" aria-hidden="true">
            <span>Verkoper</span>
            <span>Soort</span>
            <span>Laatste aankoop</span>
            <span className="end">Uitgegeven</span>
          </div>
          <ul className="rows stagger" key={`${tab}-${sort}`}>
            {shown.map((v, i) => {
              const kind = v.kind ? VENDOR_KINDS[v.kind].label : null;
              const extra = [
                v.customer_number && `klant ${v.customer_number}`,
                v.card_count > 0 && (v.card_count === 1 ? "kaart" : `${v.card_count} kaarten`),
              ].filter(Boolean);
              return (
                <li key={v.id} style={stagger(i)}>
                  <Link to={`/verkopers/${v.id}`} className="row">
                    <span className="cell-main">
                      <VendorLogo vendor={v} />
                      <span className="row-main">
                        <span className="row-title">{v.name}</span>
                        <span className="row-meta narrow-only">
                          <span>{[kind, v.category_name].filter(Boolean).join(" · ") || (v.usage === 1 ? "1 aankoop" : `${v.usage} aankopen`)}</span>
                          {extra.length > 0 && <span>{extra.join(" · ")}</span>}
                        </span>
                        <span className="row-meta wide-only">
                          <span>{[v.usage === 1 ? "1 aankoop" : `${v.usage} aankopen`, ...extra].join(" · ")}</span>
                        </span>
                      </span>
                    </span>
                    <span className="col">
                      <span>{[kind, v.category_name].filter(Boolean).join(" · ") || "—"}</span>
                    </span>
                    <span className="col">{v.last_purchase_on ? <span>{formatDate(v.last_purchase_on)}</span> : <span className="muted">—</span>}</span>
                    <span className="row-end">{v.total_cents ? formatCents(v.total_cents) : <span className="muted">—</span>}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Link to="/verkopers/nieuw" className="fab" aria-label="Nieuwe verkoper">
        <Icon name="plus" size={24} />
      </Link>
    </div>
  );
}
