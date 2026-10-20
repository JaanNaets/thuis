import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api";
import { useCard } from "../cards";
import { DEFAULT_CARD_COLOR } from "../color";
import { Barcode } from "../components/Barcode";
import { useConfirm } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/Page";
import { useToast } from "../components/Toast";
import { useOnline } from "../device";

export function CardDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
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
    toast("Kaart verwijderd", "trash");
    navigate("/kaarten", { replace: true });
  }

  return (
    <article className="page card-page">
      <PageHead
        title={card.name}
        back={{ to: "/kaarten", label: "Kaarten" }}
        actions={
          online && (
            <Link to={`/kaarten/${card.id}/bewerken`} className="btn btn-outline btn-sm">
              <Icon name="edit" size={15} /> Bewerken
            </Link>
          )
        }
      />

      <div className="card barcode-panel">
        <div className="barcode-panel-head" style={{ background: bg }} />
        <Barcode format={card.format} value={card.card_number} />
        <p className="card-number">{card.card_number}</p>
      </div>

      {card.notes && (
        <p className="note-block" style={{ margin: "16px 0 0" }}>
          <Icon name="note" size={16} />
          <span>{card.notes}</span>
        </p>
      )}
      <p className="hint" style={{ margin: "16px 2px 0" }}>
        Leest de kassa de code niet? Zet je scherm op maximale helderheid.
      </p>

      {online && (
        <button type="button" className="btn btn-danger-ghost" onClick={remove} style={{ marginTop: 24 }}>
          <Icon name="trash" size={16} /> Kaart verwijderen
        </button>
      )}
    </article>
  );
}
