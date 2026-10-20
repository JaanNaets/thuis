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
import { CardHead, LevelMeter, QuantityField, SubmitButton, TreeSelect } from "../components/Controls";
import { Icon, type IconName } from "../components/Icon";
import { Num, stagger } from "../components/Motion";
import { PageHead } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { VendorField } from "../components/VendorField";
import { formatDate, formatDateTime, formatNumber, parseQuantity, warrantyStatus } from "../format";
import { categoryTone, locationTree, nameForEmail, placeName, useTaxonomy } from "../taxonomy";
import { expiryBadge, unitWord } from "./InventoryList";
import { WARRANTY_BADGE } from "./PurchaseList";

const ACTIONS: Record<StockAction, { title: string; icon: IconName }> = {
  add: { title: "Erbij", icon: "plus" },
  consume: { title: "Verbruikt", icon: "minus" },
  count: { title: "Tellen", icon: "check" },
  move: { title: "Verplaatsen", icon: "transfer" },
  discard: { title: "Weggooien", icon: "trash" },
};

export function ItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const { data: item, error, mutate } = useApi<Detail>(`/items/${id}`);
  const { data: taxonomy } = useTaxonomy();
  const [sheet, setSheet] = useState<StockAction>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  if (error) return <p className="error page">{error}</p>;
  if (!item || !taxonomy) return null;

  const low = isLow(item.quantity, item.min_quantity);
  const expiry = expiryBadge(item.next_expiry);
  const tags = taxonomy.tags.filter((t) => item.tag_ids.includes(t.id));
  const vendor = taxonomy.vendors.find((v) => v.id === item.vendor_id);
  const asset = item.type === "asset";
  const actions: StockAction[] = asset ? ["add", "count", "move", "discard"] : ["add", "consume", "count", "move", "discard"];
  const title = (action: StockAction) => (action === "discard" && asset ? "Weg uit huis" : ACTIONS[action].title);

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
      const archive = item!.archived === 0;
      mutate(await api.put<Detail>(`/items/${item!.id}/archived`, { archived: archive }));
      toast(archive ? "Gearchiveerd" : "Terug uit het archief", "archive");
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
      toast("Item verwijderd", "trash");
      navigate("/voorraad", { replace: true });
    });
  }

  return (
    <article className="page">
      <PageHead
        title={item.name}
        back={{ to: "/voorraad", label: "Voorraad" }}
        actions={
          <Link to={`/voorraad/${item.id}/bewerken`} className="btn btn-outline btn-sm">
            <Icon name="edit" size={15} /> Bewerken
          </Link>
        }
      />

      <div className="detail-grid">
        <div className="stack">
          <section className="card">
            <div className="stock-head">
              <p className="stock-total">
                <Num value={item.quantity}>{formatNumber(item.quantity)}</Num>
                <small>{unitWord(item.quantity, item.unit)}</small>
              </p>
              <p className="stock-sub">
                {item.archived === 1 && <span className="badge badge-secondary">Gearchiveerd</span>}
                {low && <span className="badge badge-warning">{item.quantity === 0 ? "Op" : "Bijna op"}</span>}
                {expiry && <span className={`badge ${expiry.className}`}>{expiry.label}</span>}
                {item.min_quantity !== null && (
                  <>
                    {item.type === "consumable" && <LevelMeter quantity={item.quantity} min={item.min_quantity} />}
                    <span>
                      minimum {formatNumber(item.min_quantity)} {unitWord(item.min_quantity, item.unit)}
                    </span>
                  </>
                )}
              </p>
            </div>

            {item.levels.length > 0 && (
              <ul className="rows levels" style={{ borderTop: "1px solid var(--border)", borderRadius: 0 }}>
                {item.levels.map((level) => (
                  <li key={level.location_id}>
                    <div className="row">
                      <span className="level-place">
                        <Icon name="pin" size={16} />
                        <span className="row-main">
                          <span className="row-title" style={{ fontSize: 14 }}>
                            {placeName(taxonomy, level.location_id)}
                          </span>
                          {level.next_expiry && <span className="row-meta">vervalt {formatDate(level.next_expiry)}</span>}
                        </span>
                      </span>
                      {asset ? (
                        <strong>{formatNumber(level.quantity)}</strong>
                      ) : (
                        <span className="stepper">
                          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => quick("consume", level.location_id)} aria-label="Eén minder">
                            <Icon name="minus" size={16} />
                          </button>
                          <span className="stepper-value">
                            <strong>
                              <Num value={level.quantity}>{formatNumber(level.quantity)}</Num>
                            </strong>
                          </span>
                          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => quick("add", level.location_id)} aria-label="Eén meer">
                            <Icon name="plus" size={16} />
                          </button>
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="stock-actions">
              {actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  className={`btn btn-sm ${action === "add" ? "btn-primary" : "btn-outline"}`}
                  disabled={busy || (["consume", "move", "discard"].includes(action) && item.quantity === 0)}
                  onClick={() => setSheet(action)}
                >
                  <Icon name={ACTIONS[action].icon} size={15} /> {title(action)}
                </button>
              ))}
            </div>
            {actionError && <p className="error card-body">{actionError}</p>}
          </section>

          <section className="card">
            <dl className="dl" style={{ marginTop: -1 }}>
              <div>
                <dt>Soort</dt>
                <dd>{ITEM_TYPES[item.type].label}</dd>
              </div>
              {item.category_id && (
                <div>
                  <dt>Categorie</dt>
                  <dd>
                    <span className={`dot tone-${categoryTone(taxonomy, item.category_id)}`} /> {categoryPath(taxonomy, item.category_id)}
                  </dd>
                </div>
              )}
              {item.default_location_id && (
                <div>
                  <dt>Standaardplaats</dt>
                  <dd>{placeName(taxonomy, item.default_location_id)}</dd>
                </div>
              )}
              {vendor && (
                <div>
                  <dt>Meestal gekocht bij</dt>
                  <dd>
                    {vendor.name}
                    {vendor.website && (
                      <a className="btn btn-ghost btn-icon btn-sm" href={vendor.website} target="_blank" rel="noreferrer" aria-label="Website">
                        <Icon name="external" size={15} />
                      </a>
                    )}
                  </dd>
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
              <p className="tag-line" style={{ paddingTop: 4 }}>
                {tags.map((t) => (
                  <span key={t.id} className={`tag static tone-${t.color ?? "butter"}`}>
                    {t.name}
                  </span>
                ))}
              </p>
            )}
            {item.notes && (
              <p className="note-block">
                <Icon name="note" size={16} />
                <span>{item.notes}</span>
              </p>
            )}
          </section>
        </div>

        <div className="stack">
          {item.purchases.length > 0 && (
            <section className="card">
              <CardHead icon="receipt" title="Aankoop" description="Bewijsstuk en garantie" />
              <ul className="rows">
                {item.purchases.map((p) => {
                  const warranty = warrantyStatus(p.warranty_until);
                  return (
                    <li key={p.id}>
                      <Link to={`/aankopen/${p.id}`} className="row">
                        <span className="row-media">
                          <Icon name="receipt" size={16} />
                        </span>
                        <span className="row-main">
                          <span className="row-title">{p.description}</span>
                          <span className="row-meta">
                            <span>{formatDate(p.purchased_on)}</span>
                            {warranty.tone !== "none" && <span className={`badge ${WARRANTY_BADGE[warranty.tone]}`}>{warranty.label}</span>}
                          </span>
                        </span>
                        <Icon name="next" size={16} className="row-chevron" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="card">
            <CardHead icon="clock" title="Geschiedenis" description="Elke wijziging, met wie en waar" />
            {item.movements.length === 0 ? (
              <p className="card-body muted small">Nog niets gebeurd.</p>
            ) : (
              <ol className="rows history stagger">
                {item.movements.map((m, i) => (
                  <li key={m.id} style={stagger(i)}>
                    <div className="row">
                      <span className={`delta ${m.delta > 0 ? "up" : "down"}`}>
                        {m.delta > 0 ? "+" : "−"}
                        {formatNumber(Math.abs(m.delta))}
                      </span>
                      <span className="row-main">
                        <span className="row-title" style={{ fontSize: 14 }}>
                          {MOVEMENT_REASONS[m.reason] ?? m.reason}
                          {m.vendor_name && <span className="muted"> bij {m.vendor_name}</span>}
                        </span>
                        <span className="row-meta">
                          <span>
                            {[m.location_name, nameForEmail(taxonomy, m.created_by), formatDateTime(m.created_at)].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        {m.note && (
                          <span className="row-meta" style={{ color: "var(--foreground)" }}>
                            <Icon name="note" size={13} /> {m.note}
                          </span>
                        )}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="btn-row" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost" style={{ flex: "none" }} disabled={busy} onClick={toggleArchived}>
              <Icon name="archive" size={16} /> {item.archived ? "Terug uit archief" : "Archiveren"}
            </button>
            <button type="button" className="btn btn-danger-ghost" style={{ flex: "none" }} disabled={busy} onClick={remove}>
              <Icon name="trash" size={16} /> Verwijderen
            </button>
          </div>
        </div>
      </div>

      <Sheet open={Boolean(sheet)} title={sheet ? `${title(sheet)} · ${item.name}` : ""} onClose={() => setSheet(undefined)}>
        {sheet && (
          <StockForm
            item={item}
            taxonomy={taxonomy}
            action={sheet}
            onDone={(updated, message) => {
              mutate(updated);
              setSheet(undefined);
              toast(message);
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
  onDone: (updated: Detail, message: string) => void;
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
    action === "count" || action === "move" ? formatNumber(levelQuantity(initialLocation)) : "1",
  );
  const [expires, setExpires] = useState("");
  const [vendor, setVendor] = useState(() => taxonomy.vendors.find((v) => v.id === item.vendor_id)?.name ?? "");
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
      vendor: action === "add" ? vendor : null,
      note: note || null,
    };
    setBusy(true);
    setError(undefined);
    try {
      const updated = await api.post<Detail>(`/items/${item.id}/stock`, input);
      const word = unitWord(parsed, item.unit);
      const message = {
        add: `${formatNumber(parsed)} ${word} erbij`,
        consume: `${formatNumber(parsed)} ${word} verbruikt`,
        discard: `${formatNumber(parsed)} ${word} weg`,
        count: `Geteld: ${formatNumber(parsed)} ${word}`,
        move: `${formatNumber(parsed)} ${word} verplaatst`,
      }[action];
      onDone(updated, message);
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
            <TreeSelect nodes={allPlaces} value={toLocationId} onChange={setToLocationId} empty="Kies" disabled={new Set(locationId ? [locationId] : [])} />
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
        <span className="label">{action === "count" ? `Hoeveel ${UNITS[item.unit]} zijn er nu?` : `Hoeveel ${UNITS[item.unit]}`}</span>
        <QuantityField value={quantity} onChange={setQuantity} min={action === "count" ? 0 : 1} label="Hoeveelheid" />
      </div>

      {action === "add" && (
        <div className="field-row">
          <div className="field">
            <span className="label">Gekocht bij</span>
            <VendorField vendors={taxonomy.vendors} value={vendor} onChange={setVendor} placeholder="Verkoper" />
          </div>
          {item.type === "consumable" && (
            <label className="field">
              <span className="label">Vervalt op</span>
              <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </label>
          )}
        </div>
      )}

      <label className="field">
        <span className="label">
          <Icon name="note" size={15} /> Notitie
        </span>
        <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="optioneel" />
      </label>

      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <SubmitButton busy={busy}>Bewaren</SubmitButton>
      </div>
    </form>
  );
}
