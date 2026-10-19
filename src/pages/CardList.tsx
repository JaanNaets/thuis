import { Link } from "react-router";
import { useCards } from "../cards";
import { DEFAULT_CARD_COLOR, textColorFor } from "../color";
import { Icon } from "../components/Icon";
import { EmptyState, PageHero } from "../components/Page";

export function CardList() {
  const { data, error, loading } = useCards();

  return (
    <div className="page">
      <PageHero
        title="Klantenkaarten"
        tone="lilac"
        summary={
          data && data.length > 0 && `${data.length === 1 ? "1 kaart" : `${data.length} kaarten`} · ook zonder internet`
        }
        action={
          <Link to="/kaarten/nieuw" className="button primary">
            <Icon name="plus" /> Nieuwe kaart
          </Link>
        }
      />

      {error && <p className="error">{error}</p>}
      {!error && !loading && data?.length === 0 && (
        <EmptyState icon="card" tone="lilac">
          Nog geen kaarten. Scan de barcode van je eerste klantenkaart.
        </EmptyState>
      )}

      <ul className="cards">
        {data?.map((card) => {
          const bg = card.color ?? DEFAULT_CARD_COLOR;
          return (
            <li key={card.id}>
              <Link
                to={`/kaarten/${card.id}`}
                className="card-tile"
                style={{ background: bg, color: textColorFor(bg) }}
              >
                <span className="card-name">{card.name}</span>
                <span className="card-digits">•••• {card.card_number.slice(-4)}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <Link to="/kaarten/nieuw" className="fab" aria-label="Nieuwe kaart">
        <Icon name="plus" size={26} />
      </Link>
    </div>
  );
}
