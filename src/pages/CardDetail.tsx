import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api";
import { useCard } from "../cards";
import { DEFAULT_CARD_COLOR } from "../color";
import { Barcode } from "../components/Barcode";
import { useConfirm } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/Page";
import { useOnline } from "../device";

export function CardDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const online = useOnline();
  const { card, error } = useCard(id);

  // Scherm aanhouden terwijl je aan de kassa staat.
  useEffect(() => {
    let lock: WakeLockSentinel | undefined;
    navigator.wakeLock
      ?.request("screen")
      .then((l) => (lock = l))
      .catch(() => {});
    return () => {
      lock?.release();
    };
  }, []);

  if (error) return <p className="error page">{error}</p>;
  if (!card) return null;

  const bg = card.color ?? DEFAULT_CARD_COLOR;

  async function remove() {
    if (!card) return;
    const ok = await confirm({ title: `${card.name} verwijderen?`, confirmLabel: "Verwijderen", danger: true });
    if (!ok) return;
    await api.delete(`/loyalty-cards/${card.id}`);
    navigate("/kaarten", { replace: true });
  }

  return (
    <article className="page card-page">
      <PageHeader
        title={card.name}
        back="/kaarten"
        actions={
          online && (
            <Link to={`/kaarten/${card.id}/bewerken`} className="icon-button" aria-label="Bewerken">
              <Icon name="edit" />
            </Link>
          )
        }
      />

      <div className="barcode-panel">
        <div className="barcode-panel-head" style={{ background: bg }} />
        <Barcode format={card.format} value={card.card_number} />
        <p className="card-number">{card.card_number}</p>
      </div>

      {card.notes && <p className="notes">{card.notes}</p>}
      <p className="muted small hint">Leest de kassa de code niet? Zet je scherm op maximale helderheid.</p>

      {online && (
        <button type="button" className="button danger" onClick={remove}>
          <Icon name="trash" /> Kaart verwijderen
        </button>
      )}
    </article>
  );
}
