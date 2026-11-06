import { useState } from "react";
import { formatAmount } from "../../shared/units";
import { useApi } from "../api";
import { FilterSelect, FilterToggle } from "../components/Controls";
import { Icon } from "../components/Icon";
import { dayLabel } from "../components/Log";
import { SkeletonRows, stagger } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { Link } from "../router";

type StockItem = { id: string; name: string; list_id: string; list: string; amount: number; unit: string | null; low: boolean; expires: string | null };

/**
 * Voorraad over al je lijsten die tellen: wat op of bijna op is eerst, dan wat het eerst vervalt. Uitgerekend uit wat
 * erbij kwam (aankopen), eraf ging (gegeten, gebruikt) en de laatste telling.
 */
export function StockPage() {
  const { data, error } = useApi<{ things: StockItem[] }>("/insights/stock");
  const [onlyLow, setOnlyLow] = useState(false);
  const [list, setList] = useState<string | null>(null);
  const lists = [...new Map((data?.things ?? []).map((t) => [t.list_id, t.list])).entries()];
  const shown = (data?.things ?? []).filter((t) => (!onlyLow || t.low) && (!list || t.list_id === list));
  return (
    <div className="page">
      <PageHead title="Voorraad" />
      <div className="filters">
        <FilterToggle on={onlyLow} onChange={setOnlyLow}>
          <Icon name="alert" size={14} /> Bijna op
        </FilterToggle>
        {lists.length > 1 && <FilterSelect label="Lijst" all="Alle" value={list} onChange={setList} options={lists.map(([value, label]) => ({ value, label }))} />}
      </div>
      {error && <p className="error">{error}</p>}
      {!data && <SkeletonRows rows={6} />}
      {data && !shown.length && <EmptyState icon="package" title={onlyLow ? "Alles is er" : "Nog geen voorraad"} />}
      {shown.length > 0 && (
        <div className="card">
          <ul className="rows stagger">
            {shown.map((t, i) => (
              <li key={t.id} style={stagger(i)}>
                <Link to={`/dingen/${t.id}`} className="row">
                  <span className="cell-main">
                    <span className="row-main">
                      <span className="row-title">{t.name}</span>
                      <span className="row-meta">
                        <span>{[t.list, t.expires ? `vervalt ${dayLabel(t.expires).toLowerCase()}` : null].filter(Boolean).join(" · ")}</span>
                      </span>
                    </span>
                  </span>
                  <span className={`row-end${t.low ? " is-low" : ""}`}>{formatAmount(t.amount, t.unit)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
