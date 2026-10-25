import { useState, type FormEvent } from "react";
import { Navigate, useParams } from "react-router";
import { isLow } from "../../shared/stock";
import { ITEM_ORIGINS, type ItemDetail, type ItemLink, type ItemLogEntry, type Taxonomy } from "../../shared/types";
import { api, useApi } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { CardHead, SubmitButton } from "../components/Controls";
import { Icon } from "../components/Icon";
import { EditLinkForm, itemPath, itemToInput, linkCost, LinkPurchaseForm, roleText } from "../components/ItemLinks";
import { stagger, useCountUp } from "../components/Motion";
import { PageHead } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { formatCents, formatDate, formatNumber, today, warrantyStatus } from "../format";
import { Link, useNavigate } from "../router";
import { categoryTone, nameForEmail, placeName, refreshTaxonomy, useTaxonomy } from "../taxonomy";
import { originText } from "./AssetList";
import { unitWord } from "./InventoryList";
import { WARRANTY_BADGE } from "./PurchaseList";

type Editing = { kind: "tips" } | { kind: "log"; entry?: ItemLogEntry } | { kind: "link"; link: ItemLink } | { kind: "attach" };

/** Eén regel in het logboek: een notitie of een uitgave, op datum. */
type Entry = { kind: "log"; date: string; entry: ItemLogEntry } | { kind: "cost"; date: string; link: ItemLink };

/**
 * Een ding dat je hebt (de kachel, de wasmachine): herkomst en wat het kostte, "goed om te weten",
 * een logboek met notities en kosten door elkaar, en wat erbij hoort (pellets, filters).
 */
export function AssetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const { data: item, error, reload, mutate } = useApi<ItemDetail>(`/items/${id}`);
  const { data: taxonomy } = useTaxonomy();
  const [editing, setEditing] = useState<Editing>();

  if (error) return <p className="error page">{error}</p>;
  if (!item || !taxonomy) return null;
  // Verbruik heeft een eigen fiche in Voorraad.
  if (item.type !== "asset") return <Navigate to={`/voorraad/${item.id}`} replace />;

  const warranty = warrantyStatus(item.warranty_until);
  const origin = originText(item);
  const place = item.levels.length > 0 ? item.levels.map((l) => placeName(taxonomy, l.location_id)).join(", ") : placeName(taxonomy, item.default_location_id);
  const tags = taxonomy.tags.filter((t) => item.tag_ids.includes(t.id));
  const newCost = `/aankopen/nieuw?ding=${item.id}&rol=maintenance`;
  const timeline: Entry[] = [
    ...item.log.map((entry): Entry => ({ kind: "log", date: entry.happened_on, entry })),
    ...item.links.map((link): Entry => ({ kind: "cost", date: link.purchased_on, link })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const done = (message: string) => {
    setEditing(undefined);
    toast(message);
    reload();
  };

  async function toggleArchived() {
    const archive = item!.archived === 0;
    mutate(await api.put<ItemDetail>(`/items/${item!.id}/archived`, { archived: archive }));
    toast(archive ? "Niet meer in huis" : "Terug in huis", "archive");
  }

  async function remove() {
    const ok = await confirm({
      title: `${item!.name} verwijderen?`,
      body: "Het logboek verdwijnt mee; de uitgaven zelf blijven. Verkocht of weggegeven? Kies dan Niet meer in huis.",
      confirmLabel: "Verwijderen",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/items/${item!.id}`);
    refreshTaxonomy();
    toast("Verwijderd", "trash");
    navigate("/bezit", { replace: true });
  }

  async function unlink(link: ItemLink) {
    const ok = await confirm({ title: `"${link.description}" losmaken?`, body: "De uitgave zelf blijft bestaan.", confirmLabel: "Losmaken", danger: true });
    if (!ok) return;
    await api.delete(`/items/${item!.id}/links/${link.id}`);
    done("Losgemaakt");
  }

  return (
    <article className="page">
      <PageHead
        title={item.name}
        badge={item.archived ? <span className="badge">Niet meer in huis</span> : undefined}
        description={[origin, item.acquired_on && `sinds ${formatDate(item.acquired_on)}`].filter(Boolean).join(" · ") || undefined}
        back={{ to: "/bezit", label: "Bezit" }}
        actions={
          <Link to={`/bezit/${item.id}/bewerken`} className="btn btn-outline btn-sm">
            <Icon name="edit" size={15} /> Bewerken
          </Link>
        }
        primary={
          <Link to={newCost} className="btn btn-primary">
            <Icon name="plus" size={16} /> Kost toevoegen
          </Link>
        }
      />

      <div className="split">
        <aside className="split-aside">
          <section className="card">
            <AssetTotal item={item} />
            <dl className="dl">
              {item.origin && (
                <div>
                  <dt>Herkomst</dt>
                  <dd>{origin ?? ITEM_ORIGINS[item.origin].label}</dd>
                </div>
              )}
              {item.value_cents !== null && item.cost_cents > 0 && (
                <div>
                  <dt>{item.origin === "bought" ? "Wat het kostte" : "Geschatte waarde"}</dt>
                  <dd>{formatCents(item.value_cents)}</dd>
                </div>
              )}
              {item.acquired_on && (
                <div>
                  <dt>Sinds</dt>
                  <dd>{formatDate(item.acquired_on)}</dd>
                </div>
              )}
              {warranty.tone !== "none" && (
                <div>
                  <dt>Garantie</dt>
                  <dd>
                    <span className={`badge ${WARRANTY_BADGE[warranty.tone]}`}>{warranty.label}</span>
                  </dd>
                </div>
              )}
              {place && (
                <div>
                  <dt>Plaats</dt>
                  <dd>{place}</dd>
                </div>
              )}
              {item.category_name && (
                <div>
                  <dt>Categorie</dt>
                  <dd>
                    <span className={`dot tone-${categoryTone(taxonomy, item.category_id)}`} /> {item.category_name}
                  </dd>
                </div>
              )}
              {item.brand && (
                <div>
                  <dt>Merk</dt>
                  <dd>{item.brand}</dd>
                </div>
              )}
              {item.quantity > 1 && (
                <div>
                  <dt>Aantal</dt>
                  <dd>{formatNumber(item.quantity)}</dd>
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
          </section>

          <section className="card">
            <CardHead
              icon="sparkles"
              title="Goed om te weten"
              description={item.notes ? undefined : "Instellingen, tips, waar de handleiding ligt"}
              action={
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing({ kind: "tips" })}>
                  <Icon name="edit" size={15} /> {item.notes ? "Bewerken" : "Toevoegen"}
                </button>
              }
            />
            {item.notes && <p className="tips-block">{item.notes}</p>}
          </section>
        </aside>

        <div className="split-main">
          <section className="card">
            <CardHead
              icon="clock"
              title="Logboek"
              description={timeline.length === 0 ? "Onderhoud, herstellingen en notities, met de kosten erbij" : undefined}
              action={
                <div className="btn-row">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ kind: "attach" })}>
                    Uitgave koppelen
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing({ kind: "log" })}>
                    <Icon name="plus" size={15} /> Notitie
                  </button>
                </div>
              }
            />
            {timeline.length > 0 && (
              <ul className="rows timeline stagger">
                {timeline.map((e, i) => (
                  <li key={e.kind === "log" ? `l${e.entry.id}` : `c${e.link.id}`} style={stagger(i)}>
                    {e.kind === "log" ? (
                      <button type="button" className="row" onClick={() => setEditing({ kind: "log", entry: e.entry })}>
                        <span className="timeline-date">{formatDate(e.date)}</span>
                        <span className="row-main">
                          <span className="timeline-text">{e.entry.text}</span>
                          <span className="row-meta">
                            <span>{nameForEmail(taxonomy, e.entry.created_by)}</span>
                          </span>
                        </span>
                      </button>
                    ) : (
                      <div className="row">
                        <Link to={`/aankopen/${e.link.purchase_id}`} className="row-link">
                          <span className="timeline-date">{formatDate(e.date)}</span>
                          <span className="row-main">
                            <span className="row-title">{e.link.description}</span>
                            <span className="row-meta">
                              <span className="badge">{roleText(e.link.role, e.link.quantity, item.unit)}</span>
                              {e.link.vendor_name && <span>{e.link.vendor_name}</span>}
                              {e.link.note && <span>{e.link.note}</span>}
                            </span>
                          </span>
                        </Link>
                        <span className="row-end">{formatCents(linkCost(e.link))}</span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => setEditing({ kind: "link", link: e.link })}
                          aria-label="Koppeling aanpassen"
                        >
                          <Icon name="dots" size={15} />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <CardHead
              icon="package"
              title="Hoort erbij"
              description={item.children.length === 0 ? "Pellets, filters, zakken: wat je voor dit ding koopt of erbij hoort" : undefined}
              action={
                <Link to={`/voorraad/nieuw?hoortbij=${item.id}`} className="btn btn-outline btn-sm">
                  <Icon name="plus" size={15} /> Verbruik
                </Link>
              }
            />
            {item.children.length > 0 && (
              <ul className="rows">
                {item.children.map((child) => {
                  const low = child.type === "consumable" && isLow(child.quantity, child.min_quantity);
                  return (
                    <li key={child.id}>
                      <Link to={itemPath(child)} className="row" style={{ minHeight: 52 }}>
                        <span className="cell-main">
                          <span className={`row-media tone-${categoryTone(taxonomy, child.category_id)}`}>
                            <Icon name={child.type === "asset" ? "armchair" : "package"} size={16} />
                          </span>
                          <span className="row-main">
                            <span className="row-title">{child.name}</span>
                            {low && (
                              <span className="row-meta">
                                <span className="badge badge-warning">{child.quantity === 0 ? "Op" : "Bijna op"}</span>
                              </span>
                            )}
                          </span>
                        </span>
                        {child.type === "consumable" && (
                          <span className="row-end">
                            {formatNumber(child.quantity)} <span className="muted small">{unitWord(child.quantity, child.unit)}</span>
                          </span>
                        )}
                        <Icon name="next" size={16} className="row-chevron" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {item.children.length === 0 && <p className="footnote">Een bestaand item hang je eraan bij dat item: Bewerken → Hoort bij.</p>}
          </section>

          <div className="btn-row" style={{ justifySelf: "start" }}>
            <button type="button" className="btn btn-ghost" onClick={toggleArchived}>
              <Icon name="archive" size={16} /> {item.archived ? "Terug in huis" : "Niet meer in huis"}
            </button>
            <button type="button" className="btn btn-danger-ghost" onClick={remove}>
              <Icon name="trash" size={16} /> Verwijderen
            </button>
          </div>
        </div>
      </div>

      <Link to={newCost} className="fab" aria-label="Kost toevoegen">
        <Icon name="plus" size={24} />
      </Link>

      <Sheet open={Boolean(editing)} title={sheetTitle(editing)} onClose={() => setEditing(undefined)}>
        {editing?.kind === "tips" && <TipsForm item={item} taxonomy={taxonomy} onDone={done} />}
        {editing?.kind === "log" && <LogForm item={item} entry={editing.entry} onDone={done} />}
        {editing?.kind === "attach" && <LinkPurchaseForm item={item} onDone={done} />}
        {editing?.kind === "link" && <EditLinkForm item={item} link={editing.link} onDone={done} onUnlink={() => unlink(editing.link)} />}
      </Sheet>
    </article>
  );
}

function sheetTitle(e: Editing | undefined): string {
  if (!e) return "";
  if (e.kind === "tips") return "Goed om te weten";
  if (e.kind === "log") return e.entry ? "Notitie" : "Nieuwe notitie";
  if (e.kind === "attach") return "Uitgave koppelen";
  return "Koppeling";
}

/**
 * Wat het ding tot nu toe kostte: de aankoop plus onderhoud en herstellingen.
 * Gekregen of al in huis, en nog geen kosten: de geschatte waarde.
 */
function AssetTotal({ item }: { item: ItemDetail }) {
  const bought = item.links.filter((l) => l.role === "purchase").reduce((sum, l) => sum + linkCost(l), 0);
  const after = item.cost_cents - bought;
  const shown = item.cost_cents || item.value_cents || 0;
  const amount = useCountUp(shown);
  let sub = "nog geen kosten";
  if (bought && after) sub = `aankoop ${formatCents(bought)} + ${formatCents(after)} erna`;
  else if (bought) sub = "aankoopprijs";
  else if (after) sub = "aan onderhoud en herstellingen";
  else if (item.value_cents) sub = item.origin === "bought" ? "wat het kostte" : "geschatte waarde";
  return (
    <div className="purchase-summary">
      <span className="amount-big">{shown ? formatCents(amount) : "—"}</span>
      <span className="muted">{sub}</span>
    </div>
  );
}

function TipsForm({ item, taxonomy, onDone }: { item: ItemDetail; taxonomy: Taxonomy; onDone: (message: string) => void }) {
  const [notes, setNotes] = useState(item.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put(`/items/${item.id}`, itemToInput(item, taxonomy, { notes: notes || null }));
      onDone("Bewaard");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="field">
        <span className="label">Goed om te weten</span>
        <textarea
          rows={6}
          maxLength={4000}
          autoFocus
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={"bv. Blazer op 2 → vermogen max 3, anders oververhit\nHandleiding in de lade van de kast in de gang"}
        />
        <span className="hint">Wat altijd geldt. Wat op een bepaalde dag gebeurde, zet je in het logboek.</span>
      </label>
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <SubmitButton busy={busy}>Bewaren</SubmitButton>
      </div>
    </form>
  );
}

function LogForm({ item, entry, onDone }: { item: ItemDetail; entry?: ItemLogEntry; onDone: (message: string) => void }) {
  const confirm = useConfirm();
  const [date, setDate] = useState(entry?.happened_on ?? today());
  const [text, setText] = useState(entry?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { happened_on: date, text };
      if (entry) await api.put(`/items/${item.id}/log/${entry.id}`, body);
      else await api.post(`/items/${item.id}/log`, body);
      onDone(entry ? "Notitie bijgewerkt" : "Notitie bewaard");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!entry || !(await confirm({ title: "Notitie verwijderen?", confirmLabel: "Verwijderen", danger: true }))) return;
    await api.delete(`/items/${item.id}/log/${entry.id}`);
    onDone("Notitie verwijderd");
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="field">
        <span className="label">Datum</span>
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Wat gebeurde er</span>
        <textarea
          rows={4}
          required
          maxLength={2000}
          autoFocus={!entry}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="bv. Foutcode E3, opgelost door de aszak leeg te maken"
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        {entry && (
          <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={remove}>
            <Icon name="trash" size={16} /> Verwijderen
          </button>
        )}
        <SubmitButton busy={busy}>Bewaren</SubmitButton>
      </div>
    </form>
  );
}
