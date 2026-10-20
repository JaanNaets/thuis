import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { isLow } from "../../shared/stock";
import {
  ITEM_TYPES,
  MOVEMENT_REASONS,
  UNITS,
  type ItemDetail as Detail,
  type StockAction,
  type StockActionInput,
  type Taxonomy,
} from "../../shared/types";
import { api, useApi } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { QuantityField, TreeSelect } from "../components/Controls";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { formatDate, formatDateTime, formatNumber, formatQuantity, parseQuantity, warrantyStatus } from "../format";
import { categoryTone, locationTree, nameForEmail, placeName, useTaxonomy } from "../taxonomy";
import { expiryBadge } from "./InventoryList";

const ACTION_TITLES: Record<StockAction, string> = {
  add: "Erbij",
  consume: "Verbruikt",
  discard: "Weggooien",
  count: "Tellen",
  move: "Verplaatsen",
};

type SheetState = { action: StockAction; locationId?: string };

export function ItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: item, error, mutate } = useApi<Detail>(`/items/${id}`);
  const { data: taxonomy } = useTaxonomy();
  const [sheet, setSheet] = useState<SheetState>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  if (error) return <p className="error page">{error}</p>;
  if (!item || !taxonomy) return null;

  const qty = (q: number) => formatQuantity(q, item.unit, UNITS);
  const low = isLow(item.quantity, item.min_quantity);
  const expiry = expiryBadge(item.next_expiry);
  const tags = taxonomy.tags.filter((t) => item.tag_ids.includes(t.id));
  const asset = item.type === "asset";
  const actions: StockAction[] = asset ? ["add", "count", "move", "discard"] : ["add", "consume", "count", "move", "discard"];

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const quick = (action: "add" | "consume", locationId: string) =>
    run(async () => {
      mutate(await api.post<Detail>(`/items/${item.id}/stock`, { action, quantity: 1, location_id: locationId }));
    });

  async function toggleArchived() {
    run(async () => {
      mutate(await api.put<Detail>(`/items/${item!.id}/archived`, { archived: item!.archived === 0 }));
    });
  }

  async function remove() {
    const ok = await confirm({
      title: "Item verwijderen?",
      body: `"${item!.name}" en de hele geschiedenis verdwijnen. Weg uit huis maar wil je het bijhouden? Kies dan Archiveren.`,
      confirmLabel: "Verwijderen",
      danger: true,
    });
    if (!ok) return;
    run(async () => {
      await api.delete(`/items/${item!.id}`);
      navigate("/voorraad", { replace: true });
    });
  }

  return (
    <article className="page">
      <PageHeader
        title={item.name}
        back="/voorraad"
        actions={
          <Link to={`/voorraad/${item.id}/bewerken`} className="icon-button" aria-label="Bewerken">
            <Icon name="edit" />
          </Link>
        }
      />

      <div className="detail-grid">
        <div className="stack">
          <section className={`stock-card tone-${categoryTone(taxonomy, item.category_id)}`} aria-label="Voorraad">
            {item.archived === 1 && <p className="badge expired">Gearchiveerd</p>}
            <p className="stock-total">{qty(item.quantity)}</p>
            <p className="stock-sub">
              {low && <span className="badge low">{item.quantity === 0 ? "Op" : "Bijna op"}</span>}
              {expiry && <span className={`badge ${expiry.tone}`}>{expiry.label}</span>}
              {item.min_quantity !== null && <span>minimum {qty(item.min_quantity)}</span>}
            </p>

            {item.levels.length > 0 && (
              <ul className="levels">
                {item.levels.map((level) => (
                  <li key={level.location_id}>
                    <span className="level-place">
                      <Icon name="pin" size={16} />
                      <span>
                        {placeName(taxonomy, level.location_id)}
                        {level.next_expiry && <small> · vervalt {formatDate(level.next_expiry)}</small>}
                      </span>
                    </span>
                    {asset ? (
                      <strong>{formatNumber(level.quantity)}</strong>
                    ) : (
                      <span className="stepper small">
                        <button
                          type="button"
                          className="icon-button small"
                          disabled={busy}
                          onClick={() => quick("consume", level.location_id)}
                          aria-label="Eén minder"
                        >
                          <Icon name="minus" size={18} />
                        </button>
                        <strong>{formatNumber(level.quantity)}</strong>
                        <button
                          type="button"
                          className="icon-button small"
                          disabled={busy}
                          onClick={() => quick("add", level.location_id)}
                          aria-label="Eén meer"
                        >
                          <Icon name="plus" size={18} />
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="stock-actions">
              {actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  className={`button ${action === "add" ? "primary" : ""}`}
                  disabled={busy || (["consume", "move", "discard"].includes(action) && item.quantity === 0)}
                  onClick={() => setSheet({ action })}
                >
                  {action === "discard" && asset ? "Weg uit huis" : ACTION_TITLES[action]}
                </button>
              ))}
            </div>
            {actionError && <p className="error">{actionError}</p>}
          </section>

          <section className="info-card">
            <dl className="info-lines">
              <div>
                <dt>Soort</dt>
                <dd>{ITEM_TYPES[item.type].label}</dd>
              </div>
              {item.category_name && (
                <div>
                  <dt>Categorie</dt>
                  <dd>{taxonomy.categories.length ? categoryPath(taxonomy, item.category_id) : item.category_name}</dd>
                </div>
              )}
              {item.default_location_id && (
                <div>
                  <dt>Standaardplaats</dt>
                  <dd>{placeName(taxonomy, item.default_location_id)}</dd>
                </div>
              )}
              {item.brand && (
                <div>
                  <dt>Merk</dt>
                  <dd>{item.brand}</dd>
                </div>
              )}
              {item.barcode && (
                <div>
                  <dt>Barcode</dt>
                  <dd className="mono">{item.barcode}</dd>
                </div>
              )}
            </dl>
            {tags.length > 0 && (
              <p className="receipt-tags">
                {tags.map((t) => (
                  <span key={t.id} className={`tag-chip static tone-${t.color ?? "butter"}`}>
                    {t.name}
                  </span>
                ))}
              </p>
            )}
            {item.notes && <p className="receipt-notes">{item.notes}</p>}
          </section>
        </div>

        <div className="stack">
          {item.purchases.length > 0 && (
            <section>
              <h2>Aankoop</h2>
              <ul className="link-list">
                {item.purchases.map((p) => {
                  const warranty = warrantyStatus(p.warranty_until);
                  return (
                    <li key={p.id}>
                      <Link to={`/aankopen/${p.id}`} className="tone-peach">
                        <Icon name="receipt" size={18} />
                        <span className="link-main">
                          {p.description}
                          <small>
                            {formatDate(p.purchased_on)}
                            {warranty.tone !== "none" && ` · ${warranty.label}`}
                          </small>
                        </span>
                        <Icon name="next" size={18} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section>
            <h2>Geschiedenis</h2>
            {item.movements.length === 0 ? (
              <p className="muted">Nog niets gebeurd.</p>
            ) : (
              <ol className="history">
                {item.movements.map((m) => (
                  <li key={m.id}>
                    <span className={`delta ${m.delta > 0 ? "up" : "down"}`}>
                      {m.delta > 0 ? "+" : "−"}
                      {formatNumber(Math.abs(m.delta))}
                    </span>
                    <span className="history-main">
                      <strong>{MOVEMENT_REASONS[m.reason] ?? m.reason}</strong>
                      <small>
                        {[m.location_name, nameForEmail(taxonomy, m.created_by), formatDateTime(m.created_at)]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                      {m.note && <small>{m.note}</small>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>

      <div className="button-row end-actions">
        <button type="button" className="button quiet" disabled={busy} onClick={toggleArchived}>
          <Icon name="archive" /> {item.archived ? "Terug uit archief" : "Archiveren"}
        </button>
        <button type="button" className="button danger" disabled={busy} onClick={remove}>
          <Icon name="trash" /> Verwijderen
        </button>
      </div>

      <Sheet open={Boolean(sheet)} title={sheet ? ACTION_TITLES[sheet.action] : ""} onClose={() => setSheet(undefined)}>
        {sheet && (
          <StockForm
            item={item}
            taxonomy={taxonomy}
            action={sheet.action}
            onDone={(updated) => {
              mutate(updated);
              setSheet(undefined);
            }}
          />
        )}
      </Sheet>
    </article>
  );
}

function categoryPath(taxonomy: Taxonomy, id: string | null): string | null {
  const byId = new Map(taxonomy.categories.map((c) => [c.id, c]));
  const names: string[] = [];
  let node = id ? byId.get(id) : undefined;
  while (node && names.length < 10) {
    names.unshift(node.name);
    node = node.parent_id ? byId.get(node.parent_id) : undefined;
  }
  return names.join(" › ") || null;
}

function StockForm({
  item,
  taxonomy,
  action,
  onDone,
}: {
  item: Detail;
  taxonomy: Taxonomy;
  action: StockAction;
  onDone: (updated: Detail) => void;
}) {
  const levels = item.levels;
  const only = levels.length === 1 ? levels[0].location_id : null;
  const initialLocation = {
    add: item.default_location_id ?? levels[0]?.location_id ?? null,
    consume: null, // automatisch: wat het eerst vervalt
    discard: null,
    count: only ?? item.default_location_id,
    move: levels[0]?.location_id ?? null,
  }[action];

  const [locationId, setLocationId] = useState<string | null>(initialLocation);
  const [toLocationId, setToLocationId] = useState<string | null>(
    item.default_location_id && item.default_location_id !== initialLocation ? item.default_location_id : null,
  );
  const levelQuantity = (id: string | null) => levels.find((l) => l.location_id === id)?.quantity ?? 0;
  const [quantity, setQuantity] = useState(() =>
    action === "count" ? formatNumber(levelQuantity(initialLocation)) : action === "move" ? formatNumber(levelQuantity(initialLocation)) : "1",
  );
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const parsed = parseQuantity(quantity);
  const allPlaces = locationTree(taxonomy);
  const stockedPlaces = allPlaces.filter((l) => levels.some((lv) => lv.location_id === l.id));
  const fromStock = action === "consume" || action === "discard" || action === "move";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (parsed === null || Number.isNaN(parsed) || (action !== "count" && parsed <= 0)) {
      setError("Vul een geldige hoeveelheid in.");
      return;
    }
    const input: StockActionInput = {
      action,
      quantity: parsed,
      location_id: locationId,
      to_location_id: action === "move" ? toLocationId : null,
      expires_on: action === "add" && expires ? expires : null,
      note: note || null,
    };
    setBusy(true);
    setError(undefined);
    try {
      onDone(await api.post<Detail>(`/items/${item.id}/stock`, input));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      {action === "move" ? (
        <div className="field-row">
          <label className="field">
            <span className="label">Van</span>
            <TreeSelect
              nodes={stockedPlaces}
              value={locationId}
              onChange={(id) => {
                setLocationId(id);
                setQuantity(formatNumber(levelQuantity(id)));
              }}
              empty="Kies"
            />
          </label>
          <label className="field">
            <span className="label">Naar</span>
            <TreeSelect
              nodes={allPlaces}
              value={toLocationId}
              onChange={setToLocationId}
              empty="Kies"
              disabled={new Set(locationId ? [locationId] : [])}
            />
          </label>
        </div>
      ) : (
        <label className="field">
          <span className="label">{action === "count" ? "Waar heb je geteld?" : "Waar"}</span>
          <TreeSelect
            nodes={fromStock ? stockedPlaces : allPlaces}
            value={locationId}
            onChange={(id) => {
              setLocationId(id);
              if (action === "count") setQuantity(formatNumber(levelQuantity(id)));
            }}
            empty={fromStock ? "Automatisch (wat eerst vervalt)" : "Standaardplaats"}
          />
        </label>
      )}

      <div className="field">
        <span className="label">{action === "count" ? `Hoeveel ${UNITS[item.unit]} zijn er nu?` : `Hoeveel (${UNITS[item.unit]})`}</span>
        <QuantityField value={quantity} onChange={setQuantity} min={action === "count" ? 0 : 1} label="Hoeveelheid" />
      </div>

      {action === "add" && item.type === "consumable" && (
        <label className="field">
          <span className="label">Vervalt op</span>
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </label>
      )}

      <label className="field">
        <span className="label">Notitie</span>
        <input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Opslaan…" : "Opslaan"}
        </button>
      </div>
    </form>
  );
}
