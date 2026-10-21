import { useState } from "react";
import type { ExpenseSummary } from "../../shared/types";
import { useApi } from "../api";
import { CardHead } from "../components/Controls";
import { Icon } from "../components/Icon";
import { BalancesCard, CategoryBars, EntryRow, MonthTotal, PotsCard, RecurringCard, useWords } from "../components/Ledger";
import { SkeletonRows, stagger } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { useToast } from "../components/Toast";
import { formatCents, formatMonth, shiftMonth, thisMonth } from "../format";
import { Link } from "../router";
import { activeMembers, refreshTaxonomy, useTaxonomy } from "../taxonomy";

/** Uitgaven van het huishouden: wie moet wie, de potten, deze maand en de vaste kosten. */
export function ExpensesPage() {
  const [month, setMonth] = useState(thisMonth);
  const { data, error, loading, reload } = useApi<ExpenseSummary>(`/expenses/summary?month=${month}`);
  const { data: taxonomy } = useTaxonomy();
  const toast = useToast();
  const { subject, object } = useWords(taxonomy);

  const first = data?.transfers[0];
  const description = data ? (first ? `${subject(first.from)} moet ${object(first.to)} nog ${formatCents(first.amount_cents)}` : "Iedereen staat gelijk") : " ";

  // Een nieuwe pot of geldbeweging: ook de potten in de formulieren bijwerken.
  const changed = () => {
    reload();
    refreshTaxonomy();
  };

  return (
    <div className="page">
      <PageHead
        title="Uitgaven"
        description={description}
        primary={
          <Link to="/aankopen/nieuw" className="btn btn-primary">
            <Icon name="plus" size={16} /> Nieuwe uitgave
          </Link>
        }
      />

      {error && <p className="error">{error}</p>}
      {!data && loading && <SkeletonRows rows={4} />}

      {data && taxonomy && (
        <div className="split">
          <aside className="split-aside">
            <BalancesCard summary={data} taxonomy={taxonomy} people={activeMembers(taxonomy)} projectId={null} onChanged={changed} />
            <PotsCard pots={data.pots} taxonomy={taxonomy} people={activeMembers(taxonomy)} projectId={null} onChanged={changed} />

            <section className="card">
              <CardHead
                icon="wallet"
                title={capitalize(formatMonth(month))}
                action={
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn-outline btn-icon btn-sm"
                      onClick={() => setMonth((m) => shiftMonth(m, -1))}
                      aria-label="Vorige maand"
                    >
                      <Icon name="prev" size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-icon btn-sm"
                      onClick={() => setMonth((m) => shiftMonth(m, 1))}
                      aria-label="Volgende maand"
                      disabled={month >= thisMonth()}
                    >
                      <Icon name="next" size={16} />
                    </button>
                  </div>
                }
              />
              <MonthTotal cents={data.month.total_cents} />
              <p className="month-sub">
                {data.month.by_member.length > 1
                  ? data.month.by_member.map((m) => `${subject(m.member_id)} ${formatCents(m.share_cents)}`).join(" · ")
                  : "uitgegeven deze maand"}
              </p>
              <CategoryBars key={month} rows={data.month.by_category} />
            </section>
          </aside>

          <section className="split-main">
            <h2 className="section-title">In {formatMonth(month).split(" ")[0]}</h2>
            {data.entries.length === 0 ? (
              <EmptyState icon="wallet" title="Nog niets deze maand">
                Elke aankoop, terugbetaling en storting telt hier mee.
              </EmptyState>
            ) : (
              <div className="card table table-entries">
                <div className="table-head" aria-hidden="true">
                  <span>Omschrijving</span>
                  <span>Betaald door</span>
                  <span>Datum</span>
                  <span className="end">Bedrag</span>
                </div>
                <ul className="rows stagger" key={month}>
                  {data.entries.map((e, i) => (
                    <li key={`${e.kind}-${e.id}`} style={stagger(i)}>
                      <EntryRow
                        entry={e}
                        taxonomy={taxonomy}
                        onDeleted={(label) => {
                          toast(`${label} verwijderd`, "trash");
                          changed();
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <RecurringCard items={data.recurring} taxonomy={taxonomy} projectId={null} />
          </section>
        </div>
      )}

      <Link to="/aankopen/nieuw" className="fab" aria-label="Nieuwe uitgave">
        <Icon name="plus" size={24} />
      </Link>
    </div>
  );
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
