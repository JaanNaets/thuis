import { useState, type FormEvent } from "react";
import { Navigate, useParams } from "react-router";
import { Link, useNavigate } from "../router";
import { ownersText, templateOf } from "../../shared/fields";
import { isLow } from "../../shared/stock";
import { MOVEMENT_REASONS, UNITS, type ItemDetail as Detail, type ItemLink, type StockAction, type StockActionInput, type Taxonomy } from "../../shared/types";
import { api, useApi } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { CardHead, LevelMeter, QuantityField, SubmitButton, TreeSelect } from "../components/Controls";
import { Icon, type IconName } from "../components/Icon";
import { EditLinkForm, itemPath, linkCost, LinkPurchaseForm } from "../components/ItemLinks";
import { Num, stagger } from "../components/Motion";
import { PageHead } from "../components/Page";
import { AttributeRows, ItemPhoto } from "../components/ProjectFields";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { VendorField } from "../components/VendorField";
import { formatCents, formatDate, formatDateTime, formatNumber, parseQuantity } from "../format";
import { categoryTone, locationTree, memberById, nameForEmail, placeName, useTaxonomy } from "../taxonomy";
import { LogCard } from "./AssetDetail";
import { expiryBadge, unitWord } from "./InventoryList";

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
  const { data: item, error, mutate, reload } = useApi<Detail>(`/items/${id}`);
  const { data: taxonomy } = useTaxonomy();
  const [sheet, setSheet] = useState<StockAction>();
  const [linking, setLinking] = useState<ItemLink | "new">();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  if (error) return <p className="error page">{error}</p>;
  if (!item || !taxonomy) return null;
  // Bezit heeft een eigen fiche.
  if (item.type === "asset") return <Navigate to={itemPath(item)} replace />;

  // Iets van een project (een wijn): terug naar dat project, met de velden van het project.
  const project = taxonomy.projects.find((p) => p.id === item.project_id);
  const template = templateOf(project?.template);
  const canEdit = item.can_edit !== false;
  const home = project ? `/projecten/${project.id}` : "/voorraad";
  const wine = project?.template === "wine";

  const low = isLow(item.quantity, item.min_quantity);
  const expiry = expiryBadge(item.next_expiry);
  const tags = taxonomy.tags.filter((t) => item.tag_ids.includes(t.id));
  const vendor = taxonomy.vendors.find((v) => v.id === item.vendor_id);
  // Een gast ziet de plaatsen van het huishouden niet: verplaatsen en tellen per plaats kan dan niet.
  const actions: StockAction[] = taxonomy.locations.length ? ["add", "consume", "count", "move", "discard"] : ["add", "consume", "discard"];
  const title = (action: StockAction) => (action === "consume" && wine ? "Gedronken" : ACTIONS[action].title);

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
      navigate(home, { replace: true });
    });
  }

  return (
    <article className="page">
      <PageHead
        title={item.name}
        description={project ? [item.brand, project.name].filter(Boolean).join(" · ") : undefined}
        back={project ? { to: home, label: project.name } : { to: "/voorraad", label: "Voorraad" }}
        actions={
          canEdit && (
            <Link to={`${itemPath(item)}/bewerken`} className="btn btn-outline btn-sm">
              <Icon name="edit" size={15} /> Bewerken
            </Link>
          )
        }
        primary={
          canEdit && (
            <Link to={`/aankopen/nieuw?ding=${item.id}`} className="btn btn-primary">
              <Icon name="plus" size={16} /> Bijgekocht
            </Link>
          )
        }
      />

      <div className="split">
        <aside className="split-aside">
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
              <ul className="rows levels">
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
                      {
                        <span className="stepper">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busy || !canEdit}
                            onClick={() => quick("consume", level.location_id)}
                            aria-label="Eén minder"
                          >
                            <Icon name="minus" size={16} />
                          </button>
                          <span className="stepper-value">
                            <strong>
                              <Num value={level.quantity}>{formatNumber(level.quantity)}</Num>
                            </strong>
                          </span>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busy || !canEdit}
                            onClick={() => quick("add", level.location_id)}
                            aria-label="Eén meer"
                          >
                            <Icon name="plus" size={16} />
                          </button>
                        </span>
                      }
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {canEdit && (
              <div className="stock-actions">
                {actions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    className="btn btn-sm btn-outline"
                    disabled={busy || (["consume", "move", "discard"].includes(action) && item.quantity === 0)}
                    onClick={() => setSheet(action)}
                  >
                    <Icon name={ACTIONS[action].icon} size={15} /> {title(action)}
                  </button>
                ))}
              </div>
            )}
            {actionError && <p className="error card-body">{actionError}</p>}
          </section>

          <section className="card">
            {project && (
              <ItemPhoto
                item={item}
                canEdit={canEdit}
                onChange={(version, message) => {
                  mutate({ ...item, photo_version: version });
                  toast(message);
                }}
              />
            )}
            <dl className="dl" style={{ marginTop: -1 }}>
              {project && <AttributeRows defs={project.fields} attributes={item.attributes} />}
              {(project || item.owners.length > 0) && (
                <div>
                  <dt>Eigenaar</dt>
                  <dd>{ownersText(item.owners, (id) => memberById(taxonomy, id)?.name ?? "?")}</dd>
                </div>
              )}
              {item.parent && (
                <div>
                  <dt>Hoort bij</dt>
                  <dd>
                    <Link to={itemPath(item.parent)} className="link-quiet">
                      {item.parent.name}
                    </Link>
                  </dd>
                </div>
              )}
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
                    <Link to={`/verkopers/${vendor.id}`} className="link-quiet">
                      {vendor.name}
                    </Link>
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
                  <dt>{template.brand_label}</dt>
                  <dd>{item.brand}</dd>
                </div>
              )}
              {item.content_amount && item.content_unit && (
                <div>
                  <dt>Inhoud</dt>
                  <dd>
                    {formatNumber(item.content_amount)} {item.content_unit} per {item.unit}
                  </dd>
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
        </aside>

        <div className="split-main">
          {project && (
            <LogCard
              item={item}
              title={wine ? "Proefnotities" : "Logboek"}
              empty={wine ? "Hoe smaakte hij, bij welk gerecht, met wie" : "Notities en wat er gebeurde"}
              canEdit={canEdit}
              onChanged={(message) => {
                toast(message);
                reload();
              }}
            />
          )}

          <PricesCard item={item} onAttach={canEdit ? () => setLinking("new") : undefined} onEdit={canEdit ? setLinking : undefined} />

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
                          <span>{[m.location_name, nameForEmail(taxonomy, m.created_by), formatDateTime(m.created_at)].filter(Boolean).join(" · ")}</span>
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

          {canEdit && (
            <div className="btn-row" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-ghost" style={{ flex: "none" }} disabled={busy} onClick={toggleArchived}>
                <Icon name="archive" size={16} /> {item.archived ? "Terug uit archief" : "Archiveren"}
              </button>
              <button type="button" className="btn btn-danger-ghost" style={{ flex: "none" }} disabled={busy} onClick={remove}>
                <Icon name="trash" size={16} /> Verwijderen
              </button>
            </div>
          )}
        </div>
      </div>

      {canEdit && (
        <Link to={`/aankopen/nieuw?ding=${item.id}`} className="fab" aria-label="Bijgekocht">
          <Icon name="plus" size={24} />
        </Link>
      )}

      <Sheet open={Boolean(linking)} title={linking === "new" ? "Uitgave koppelen" : "Koppeling"} onClose={() => setLinking(undefined)}>
        {linking === "new" && (
          <LinkPurchaseForm
            item={item}
            onDone={(message) => {
              setLinking(undefined);
              toast(message);
              reload();
            }}
          />
        )}
        {linking && linking !== "new" && (
          <EditLinkForm
            item={item}
            link={linking}
            onDone={(message) => {
              setLinking(undefined);
              toast(message);
              reload();
            }}
            onUnlink={async () => {
              await api.delete(`/items/${item.id}/links/${linking.id}`);
              setLinking(undefined);
              toast("Losgemaakt");
              reload();
            }}
          />
        )}
      </Sheet>

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
  const [quantity, setQuantity] = useState(() => (action === "count" || action === "move" ? formatNumber(levelQuantity(initialLocation)) : "1"));
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

type PriceRow = { link: ItemLink; cost: number; perUnit: number; perContent: number | null };

/**
 * Wat je voor dit verbruik betaalde, per keer en per verkoper: de laatste prijs per eenheid en de goedkoopste.
 * Met een inhoud per eenheid (15 kg per zak) ook de prijs per kg, zodat verschillende zakken te vergelijken zijn.
 */
function PricesCard({ item, onAttach, onEdit }: { item: Detail; onAttach?: () => void; onEdit?: (link: ItemLink) => void }) {
  const rows: PriceRow[] = item.links
    .filter((l) => l.role === "refill" && l.quantity)
    .map((link) => {
      const cost = linkCost(link);
      const perUnit = cost / link.quantity!;
      return { link, cost, perUnit, perContent: item.content_amount ? perUnit / item.content_amount : null };
    });
  const others = item.links.filter((l) => !(l.role === "refill" && l.quantity));

  // Per verkoper de laatste aankoop (de lijst staat al met de nieuwste eerst).
  const byVendor = new Map<string, { name: string; last: PriceRow; low: number; count: number }>();
  for (const r of rows) {
    const key = r.link.vendor_id ?? "none";
    const v = byVendor.get(key);
    if (v) {
      v.low = Math.min(v.low, r.perUnit);
      v.count++;
    } else byVendor.set(key, { name: r.link.vendor_name ?? "Onbekende verkoper", last: r, low: r.perUnit, count: 1 });
  }
  const vendors = [...byVendor.values()].sort((a, b) => a.last.perUnit - b.last.perUnit);
  const unit = item.unit;
  const per = (r: PriceRow) =>
    `${formatCents(Math.round(r.perUnit))}/${unit}${r.perContent !== null ? ` · ${formatCents(Math.round(r.perContent))}/${item.content_unit}` : ""}`;

  return (
    <section className="card">
      <CardHead
        icon="coins"
        title="Prijzen"
        description={
          rows.length === 0 ? "Boek wat je bijkoopt als uitgave: dan zie je hier per winkel wat je betaalde" : `Per ${unit}, de goedkoopste bovenaan`
        }
        action={
          onAttach && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onAttach}>
              Uitgave koppelen
            </button>
          )
        }
      />
      {vendors.length > 0 && (
        <ul className="rows">
          {vendors.map((v, i) => (
            <li key={v.name}>
              <div className="row" style={{ minHeight: 52 }}>
                <span className="row-main">
                  <span className="row-title">
                    {v.name} {i === 0 && vendors.length > 1 && <span className="badge badge-success">goedkoopst</span>}
                  </span>
                  <span className="row-meta">
                    <span>laatst {formatDate(v.last.link.purchased_on)}</span>
                    <span>{v.count === 1 ? "1 keer" : `${v.count} keer`}</span>
                    {v.low < v.last.perUnit && <span>ooit {formatCents(Math.round(v.low))}</span>}
                  </span>
                </span>
                <span className="row-end">{per(v.last)}</span>
              </div>
            </li>
          ))}
          <li className="group-row">
            Elke keer <span className="group-count">{rows.length}</span>
          </li>
          {rows.map((r) => (
            <li key={r.link.id}>
              <button type="button" className="row" style={{ minHeight: 48 }} disabled={!onEdit} onClick={() => onEdit?.(r.link)}>
                <span className="row-main">
                  <span className="row-title" style={{ fontWeight: 450 }}>
                    {formatNumber(r.link.quantity!)} {unitWord(r.link.quantity!, unit)} · {formatCents(r.cost)}
                  </span>
                  <span className="row-meta">
                    <span>{[formatDate(r.link.purchased_on), r.link.vendor_name].filter(Boolean).join(" · ")}</span>
                  </span>
                </span>
                <span className="row-end muted">{per(r)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <ul className="rows">
          {others.map((l) => (
            <li key={l.id}>
              <button type="button" className="row" style={{ minHeight: 48 }} disabled={!onEdit} onClick={() => onEdit?.(l)}>
                <span className="row-main">
                  <span className="row-title" style={{ fontWeight: 450 }}>
                    {l.description}
                  </span>
                  <span className="row-meta">
                    <span>{[formatDate(l.purchased_on), l.vendor_name].filter(Boolean).join(" · ")}</span>
                  </span>
                </span>
                <span className="row-end">{formatCents(linkCost(l))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
