import type { SharedSummary } from "../../shared/types";
import { useApi } from "../api";
import { Avatar, CardHead } from "../components/Controls";
import { Icon } from "../components/Icon";
import { EntryRow, useWords } from "../components/Ledger";
import { SkeletonRows, stagger, useCountUp } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { formatCents } from "../format";
import { memberById, useTaxonomy } from "../taxonomy";

/**
 * Voor een gast: wat er buiten de projecten met jou gedeeld werd (een etentje, een cadeau samen), en wie wie
 * daarvan nog moet. Ook wat gedeeld werd voor je kon aanmelden: je bent dezelfde persoon.
 */
export function SharedPage() {
  const { data, error, loading } = useApi<SharedSummary>("/expenses/shared");
  const { data: taxonomy } = useTaxonomy();
  const { subject, object } = useWords(taxonomy);

  const description = !data
    ? " "
    : data.balance_cents > 0
      ? `Je krijgt nog ${formatCents(data.balance_cents)}`
      : data.balance_cents < 0
        ? `Je moet nog ${formatCents(-data.balance_cents)}`
        : "Alles is verrekend";

  return (
    <div className="page">
      <PageHead title="Gedeeld" description={description} />

      {error && <p className="error">{error}</p>}
      {!data && loading && <SkeletonRows rows={4} />}

      {data && taxonomy && (
        <div className="split">
          <aside className="split-aside">
            <section className="card">
              <CardHead icon="transfer" title="Wie moet wie" description="Over alles wat buiten de projecten gedeeld werd" />
              {data.transfers.length === 0 ? (
                <div className="card-body">
                  <p className="balance-even">
                    <span className="ok">
                      <Icon name="check" size={16} />
                    </span>
                    Alles is verrekend
                  </p>
                </div>
              ) : (
                data.transfers.map((t) => (
                  <SharedBalance
                    key={`${t.from}-${t.to}`}
                    cents={t.amount_cents}
                    text={`${subject(t.from)} moet ${object(t.to)} nog`}
                    from={memberById(taxonomy, t.from)}
                    to={memberById(taxonomy, t.to)}
                  />
                ))
              )}
              <p className="footnote">Terugbetaald? Iemand van het huishouden duidt het aan.</p>
            </section>
          </aside>

          <section className="split-main">
            <h2 className="section-title">Uitgaven</h2>
            {data.entries.length === 0 ? (
              <EmptyState icon="wallet" title="Nog niets gedeeld">
                Wat iemand van het huishouden met jou deelt, buiten een project, verschijnt hier.
              </EmptyState>
            ) : (
              <div className="card table table-entries">
                <div className="table-head" aria-hidden="true">
                  <span>Omschrijving</span>
                  <span>Betaald door</span>
                  <span>Datum</span>
                  <span className="end">Jouw deel</span>
                </div>
                <ul className="rows stagger">
                  {data.entries.map((e, i) => (
                    <li key={`${e.kind}-${e.id}`} style={stagger(i)}>
                      <EntryRow entry={e} taxonomy={taxonomy} myShare={e.kind === "purchase" ? (data.my_shares[e.id] ?? 0) : undefined} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function SharedBalance({
  cents,
  text,
  from,
  to,
}: {
  cents: number;
  text: string;
  from?: Parameters<typeof Avatar>[0]["member"];
  to?: Parameters<typeof Avatar>[0]["member"];
}) {
  const amount = useCountUp(cents);
  return (
    <div className="balance">
      <div>
        <div className="balance-people">
          <Avatar member={from} />
          <Icon name="arrow" size={16} />
          <Avatar member={to} />
        </div>
        <p className="balance-label" style={{ marginTop: 12 }}>
          {text}
        </p>
        <p className="balance-amount">{formatCents(amount)}</p>
      </div>
    </div>
  );
}
