import { Link } from "react-router";
import { useCards } from "../cards";
import { DEFAULT_CARD_COLOR, textColorFor } from "../color";
import { Icon } from "../components/Icon";
import { SkeletonRows, stagger } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";

export function CardList() {
  const { data, error, loading } = useCards();

  return (
    <div className="page">
      <PageHead
        title="Klantenkaarten"
        description={
          data && data.length > 0 ? `${data.length === 1 ? "1 kaart" : `${data.length} kaarten`} · ook zonder internet` : "Altijd bij de hand, ook zonder bereik"
        }
        primary={
          <Link to="/kaarten/nieuw" className="btn btn-primary">
            <Icon name="plus" size={16} /> Nieuwe kaart
          </Link>
        }
      />

      {error && <p className="error">{error}</p>}
      {!data && loading && <SkeletonRows rows={3} />}
      {!error && !loading && data?.length === 0 && (
        <EmptyState
          icon="card"
          title="Nog geen kaarten"
          action={
            <Link to="/kaarten/nieuw" className="btn btn-primary btn-sm">
              <Icon name="plus" size={16} /> Eerste kaart
            </Link>
          }
        >
          Scan de barcode van je klantenkaart, of kies een screenshot uit de app van de winkel.
        </EmptyState>
      )}

      <ul className="cards stagger">
        {data?.map((card, i) => {
          const bg = card.color ?? DEFAULT_CARD_COLOR;
          return (
            <li key={card.id} style={stagger(i)}>
              <Link to={`/kaarten/${card.id}`} className="card-tile" style={{ background: bg, color: textColorFor(bg) }}>
                <span className="card-name">{card.name}</span>
                <span className="card-digits">•••• {card.card_number.slice(-4)}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <Link to="/kaarten/nieuw" className="fab" aria-label="Nieuwe kaart">
        <Icon name="plus" size={24} />
      </Link>
    </div>
  );
}
