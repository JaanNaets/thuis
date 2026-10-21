import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import {
  UNITS,
  type LoyaltyCard,
  type PurchaseListItem,
  type Taxonomy,
  type VendorBranch,
  type VendorBranchInput,
  type VendorContact,
  type VendorContactInput,
  type VendorDetail as Detail,
} from "../../shared/types";
import { displayWebsite, formatCompanyNumber, formatIban, VENDOR_KINDS } from "../../shared/vendor";
import { api, useApi } from "../api";
import { useCards } from "../cards";
import { useConfirm } from "../components/ConfirmDialog";
import { Avatar, CardHead, SubmitButton } from "../components/Controls";
import { Icon } from "../components/Icon";
import { stagger, useCountUp } from "../components/Motion";
import { PageHead, toneForCategory } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { VendorLogo } from "../components/VendorLogo";
import { formatCents, formatDate, formatQuantity, warrantyStatus } from "../format";
import { Link, useNavigate } from "../router";
import { memberById, refreshTaxonomy, useTaxonomy } from "../taxonomy";
import { WARRANTY_BADGE } from "./PurchaseList";

type Editing = { kind: "contact"; contact?: VendorContact } | { kind: "branch"; branch?: VendorBranch } | { kind: "cards" };

/** Alles over één verkoper: wat je er kocht, je account, contacten, vestigingen, kaarten en garanties. */
export function VendorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const { data: v, error, reload } = useApi<Detail>(`/vendors/${id}`);
  const { data: taxonomy } = useTaxonomy();
  const [editing, setEditing] = useState<Editing>();

  if (error) return <p className="error page">{error}</p>;
  if (!v || !taxonomy) return null;

  const kind = v.kind ? VENDOR_KINDS[v.kind].label : null;
  const owner = memberById(taxonomy, v.account_member_id);
  const hasAccount = Boolean(v.customer_number || v.account_login || owner);
  const hasCompany = Boolean(v.company_number || v.iban);
  const branchName = (branchId: string | null) => v.branches.find((b) => b.id === branchId)?.name;

  async function remove() {
    if (!v) return;
    const ok = await confirm({
      title: `${v.name} verwijderen?`,
      body: v.purchase_count > 0 ? `De ${v.purchase_count} aankopen blijven bewaard, zonder verkoper. Contacten en vestigingen verdwijnen mee.` : undefined,
      confirmLabel: "Verwijderen",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/vendors/${v.id}`);
    refreshTaxonomy();
    toast("Verkoper verwijderd", "trash");
    navigate("/verkopers", { replace: true });
  }

  async function unlinkCard(card: LoyaltyCard) {
    if (!v) return;
    await api.delete(`/vendors/${v.id}/cards/${card.id}`);
    toast(`${card.name} losgekoppeld`);
    reload();
  }

  const done = (message: string) => {
    setEditing(undefined);
    toast(message);
    reload();
  };

  return (
    <article className="page">
      <PageHead
        title={v.name}
        badge={kind ? <span className="badge">{kind}</span> : undefined}
        description={v.category_name ?? (v.website ? displayWebsite(v.website) : undefined)}
        back={{ to: "/verkopers", label: "Verkopers" }}
        actions={
          <Link to={`/verkopers/${v.id}/bewerken`} className="btn btn-outline btn-sm">
            <Icon name="edit" size={15} /> Bewerken
          </Link>
        }
        primary={
          <Link to={`/aankopen/nieuw?verkoper=${v.id}`} className="btn btn-primary">
            <Icon name="plus" size={16} /> Nieuwe aankoop
          </Link>
        }
      />

      <div className="split">
        <aside className="split-aside">
          <section className="card">
            <VendorTotal vendor={v} />
            <dl className="dl">
              {v.category_name && (
                <div>
                  <dt>Koop je er meestal</dt>
                  <dd>
                    <span className={`dot tone-${v.category_color ?? toneForCategory(v.category_name)}`} /> {v.category_name}
                  </dd>
                </div>
              )}
              {v.website && (
                <div>
                  <dt>Website</dt>
                  <dd>
                    <a href={v.website} target="_blank" rel="noreferrer" className="link-quiet">
                      {displayWebsite(v.website)}
                    </a>
                  </dd>
                </div>
              )}
              {v.phone && (
                <div>
                  <dt>Telefoon</dt>
                  <dd>
                    <a href={`tel:${v.phone}`} className="link-quiet">
                      {v.phone}
                    </a>
                  </dd>
                </div>
              )}
              {v.email && (
                <div>
                  <dt>E-mail</dt>
                  <dd>
                    <a href={`mailto:${v.email}`} className="link-quiet">
                      {v.email}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            {v.notes && (
              <p className="note-block">
                <Icon name="note" size={16} />
                <span>{v.notes}</span>
              </p>
            )}
          </section>

          <section className="card">
            <CardHead icon="idCard" title="Je account" description={hasAccount ? undefined : "Klantnummer, op wiens naam en waarmee je aanmeldt"} />
            {hasAccount ? (
              <dl className="dl">
                {v.customer_number && (
                  <div>
                    <dt>Klantnummer</dt>
                    <dd>
                      <span className="mono">{v.customer_number}</span>
                      <CopyButton text={v.customer_number} label="Klantnummer" />
                    </dd>
                  </div>
                )}
                {owner && (
                  <div>
                    <dt>Op naam van</dt>
                    <dd>
                      <Avatar member={owner} size="sm" /> {owner.name}
                    </dd>
                  </div>
                )}
                {v.account_login && (
                  <div>
                    <dt>Aanmelden met</dt>
                    <dd>
                      <span className="mono">{v.account_login}</span>
                      <CopyButton text={v.account_login} label="Login" />
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <div className="card-body">
                <Link to={`/verkopers/${v.id}/bewerken`} className="btn btn-outline btn-sm">
                  <Icon name="plus" size={15} /> Account toevoegen
                </Link>
              </div>
            )}
          </section>

          {hasCompany && (
            <section className="card">
              <CardHead icon="bank" title="Bedrijf" />
              <dl className="dl">
                {v.company_number && (
                  <div>
                    <dt>Ondernemingsnummer</dt>
                    <dd>
                      <span className="mono">{formatCompanyNumber(v.company_number)}</span>
                      <CopyButton text={v.company_number} label="Ondernemingsnummer" />
                    </dd>
                  </div>
                )}
                {v.iban && (
                  <div>
                    <dt>IBAN</dt>
                    <dd>
                      <span className="mono">{formatIban(v.iban)}</span>
                      <CopyButton text={v.iban} label="Rekeningnummer" />
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          <section className="card">
            <CardHead
              icon="users"
              title="Contactpersonen"
              description={v.contacts.length === 0 ? "Je vaste verkoper, de technieker, de klantendienst" : undefined}
              action={
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing({ kind: "contact" })}>
                  <Icon name="plus" size={15} /> Contact
                </button>
              }
            />
            {v.contacts.length > 0 && (
              <ul className="rows">
                {v.contacts.map((c) => (
                  <li key={c.id}>
                    <div className="row" style={{ minHeight: 56 }}>
                      <button type="button" className="row-link cell-main" onClick={() => setEditing({ kind: "contact", contact: c })}>
                        <Avatar member={{ name: c.name, color: "sky" }} />
                        <span className="row-main">
                          <span className="row-title">{c.name}</span>
                          <span className="row-meta">
                            {[c.role, branchName(c.branch_id)].filter(Boolean).length > 0 && (
                              <span>{[c.role, branchName(c.branch_id)].filter(Boolean).join(" · ")}</span>
                            )}
                            {c.phone && <span>{c.phone}</span>}
                          </span>
                        </span>
                      </button>
                      <ContactButtons phone={c.phone} email={c.email} name={c.name} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>

        <div className="split-main">
          <section className="card">
            <CardHead
              icon="card"
              title="Klantenkaarten"
              description={v.cards.length === 0 ? "Je kaart van deze winkel, meteen bij de hand" : undefined}
              action={
                <div className="btn-row">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ kind: "cards" })}>
                    Koppelen
                  </button>
                  <Link to={`/kaarten/nieuw?verkoper=${v.id}`} className="btn btn-outline btn-sm">
                    <Icon name="plus" size={15} /> Kaart
                  </Link>
                </div>
              }
            />
            {v.cards.length > 0 && (
              <ul className="rows">
                {v.cards.map((card) => (
                  <li key={card.id}>
                    <div className="row" style={{ minHeight: 52 }}>
                      <Link to={`/kaarten/${card.id}`} className="row-link cell-main">
                        <span className="row-media card-chip" style={{ background: card.color ?? undefined }}>
                          <Icon name="card" size={16} />
                        </span>
                        <span className="row-main">
                          <span className="row-title">{card.name}</span>
                          <span className="row-meta">
                            <span className="mono">{card.card_number}</span>
                          </span>
                        </span>
                      </Link>
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => unlinkCard(card)} aria-label={`${card.name} loskoppelen`}>
                        <Icon name="close" size={15} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {v.totals.length > 0 && <YearTotals totals={v.totals} />}

          {v.warranties.length > 0 && (
            <section className="card">
              <CardHead icon="clock" title="Lopende garanties" description="Van hier gekocht, en nog onder garantie" />
              <PurchaseRows purchases={v.warranties} showWarranty />
            </section>
          )}

          <section className="card">
            <CardHead
              icon="receipt"
              title="Aankopen"
              description={
                v.purchase_count === 0
                  ? "Nog niets gekocht"
                  : v.purchase_count > v.purchases.length
                    ? `De recentste ${v.purchases.length} van ${v.purchase_count}`
                    : undefined
              }
              action={
                v.purchase_count > 0 && (
                  <Link to={`/aankopen?verkoper=${v.id}`} className="btn btn-ghost btn-sm">
                    Alle <Icon name="next" size={14} />
                  </Link>
                )
              }
            />
            {v.purchases.length > 0 && <PurchaseRows purchases={v.purchases.slice(0, 8)} />}
          </section>

          {(v.items.length > 0 || v.movements.length > 0) && (
            <section className="card">
              <CardHead icon="package" title="Voorraad" description="Wat je hier meestal koopt, en wat er laatst van hier binnenkwam" />
              <ul className="rows">
                {v.items.map((item) => (
                  <li key={item.id}>
                    <Link to={`/voorraad/${item.id}`} className="row" style={{ minHeight: 52 }}>
                      <span className="cell-main">
                        <span className={`row-media tone-${item.category_color ?? toneForCategory(item.category_name)}`}>
                          <Icon name="package" size={16} />
                        </span>
                        <span className="row-main">
                          <span className="row-title">{item.name}</span>
                          {item.category_name && (
                            <span className="row-meta">
                              <span>{item.category_name}</span>
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="row-end">{formatQuantity(item.quantity, item.unit, UNITS)}</span>
                    </Link>
                  </li>
                ))}
                {v.movements.length > 0 && (
                  <li className="group-row">
                    Recent binnengekomen <span className="group-count">{v.movements.length}</span>
                  </li>
                )}
                {v.movements.map((m) => (
                  <li key={m.id}>
                    <Link to={`/voorraad/${m.item_id}`} className="row" style={{ minHeight: 48 }}>
                      <span className="row-main">
                        <span className="row-title" style={{ fontWeight: 450 }}>
                          {m.item_name}
                        </span>
                        <span className="row-meta">
                          <span>{formatDate(m.created_at.slice(0, 10))}</span>
                          {m.location_name && <span>{m.location_name}</span>}
                        </span>
                      </span>
                      <span className="row-end">+{formatQuantity(m.delta, m.unit, UNITS)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <CardHead
              icon="pin"
              title="Vestigingen"
              description={v.branches.length === 0 ? "Winkels, afhaalpunten of kantoren, met adres en openingsuren" : undefined}
              action={
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing({ kind: "branch" })}>
                  <Icon name="plus" size={15} /> Vestiging
                </button>
              }
            />
            {v.branches.length > 0 && (
              <ul className="rows">
                {v.branches.map((b) => (
                  <li key={b.id}>
                    <div className="row" style={{ minHeight: 56 }}>
                      <button type="button" className="row-link cell-main" onClick={() => setEditing({ kind: "branch", branch: b })}>
                        <span className="row-media round">
                          <Icon name="pin" size={16} />
                        </span>
                        <span className="row-main">
                          <span className="row-title">{b.name}</span>
                          <span className="row-meta">
                            {addressLine(b) && <span>{addressLine(b)}</span>}
                            {b.opening_hours && <span>{b.opening_hours}</span>}
                          </span>
                        </span>
                      </button>
                      {addressLine(b) && (
                        <a
                          className="btn btn-ghost btn-icon btn-sm"
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${v.name} ${addressLine(b)}`)}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`${b.name} op de kaart`}
                        >
                          <Icon name="external" size={15} />
                        </a>
                      )}
                      <ContactButtons phone={b.phone} email={b.email} name={b.name} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <button type="button" className="btn btn-danger-ghost" onClick={remove} style={{ justifySelf: "start" }}>
            <Icon name="trash" size={16} /> Verwijderen
          </button>
        </div>
      </div>

      <Link to={`/aankopen/nieuw?verkoper=${v.id}`} className="fab" aria-label="Nieuwe aankoop">
        <Icon name="plus" size={24} />
      </Link>

      <Sheet open={Boolean(editing)} title={sheetTitle(editing)} onClose={() => setEditing(undefined)}>
        {editing?.kind === "contact" && <ContactForm vendor={v} contact={editing.contact} onDone={(message) => done(message)} />}
        {editing?.kind === "branch" && <BranchForm vendor={v} branch={editing.branch} onDone={(message) => done(message)} />}
        {editing?.kind === "cards" && <LinkCards vendor={v} taxonomy={taxonomy} onDone={(message) => done(message)} />}
      </Sheet>
    </article>
  );
}

function sheetTitle(e: Editing | undefined): string {
  if (!e) return "";
  if (e.kind === "contact") return e.contact ? "Contactpersoon" : "Nieuwe contactpersoon";
  if (e.kind === "branch") return e.branch ? "Vestiging" : "Nieuwe vestiging";
  return "Kaart koppelen";
}

function addressLine(b: VendorBranch): string {
  return [b.street, [b.postal_code, b.city].filter(Boolean).join(" "), b.country].filter(Boolean).join(", ");
}

/** Het logo en wat je er in totaal uitgaf. */
function VendorTotal({ vendor }: { vendor: Detail }) {
  const total = useCountUp(vendor.total_cents);
  return (
    <div className="vendor-summary">
      <VendorLogo vendor={vendor} size={22} className="lg" />
      <div className="purchase-summary">
        <span className="amount-big">{formatCents(total)}</span>
        <span className="muted">{vendor.purchase_count === 1 ? "1 aankoop" : `${vendor.purchase_count} aankopen`}</span>
      </div>
    </div>
  );
}

function YearTotals({ totals }: { totals: Detail["totals"] }) {
  const max = Math.max(...totals.map((t) => t.total_cents), 1);
  return (
    <section className="card">
      <CardHead icon="wallet" title="Per jaar" description="Wat je hier uitgaf" />
      <ul className="bars">
        {totals.map((t, i) => (
          <li key={t.year} className="tone-sky">
            <span className="bar-label">
              {t.year} <span className="muted">· {t.count === 1 ? "1 aankoop" : `${t.count} aankopen`}</span>
            </span>
            <span className="bar-amount">{formatCents(t.total_cents)}</span>
            <span className="bar-track">
              <span className="bar" style={{ display: "block", width: `${Math.max(3, (t.total_cents / max) * 100)}%`, ...stagger(i) }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PurchaseRows({ purchases, showWarranty }: { purchases: PurchaseListItem[]; showWarranty?: boolean }) {
  return (
    <ul className="rows">
      {purchases.map((p) => {
        const warranty = warrantyStatus(p.warranty_until);
        return (
          <li key={p.id}>
            <Link to={`/aankopen/${p.id}`} className="row" style={{ minHeight: 52 }}>
              <span className="cell-main">
                <span className={`row-media tone-${p.category_color ?? toneForCategory(p.category_name)}`}>
                  <Icon name={p.file_count > 0 ? "file" : "receipt"} size={16} />
                </span>
                <span className="row-main">
                  <span className="row-title">{p.description}</span>
                  <span className="row-meta">
                    <span>{formatDate(p.purchased_on)}</span>
                    {showWarranty ? (
                      <span className={`badge ${WARRANTY_BADGE[warranty.tone]}`}>{warranty.label}</span>
                    ) : (
                      p.category_name && <span>{p.category_name}</span>
                    )}
                  </span>
                </span>
              </span>
              <span className="row-end">{formatCents(p.amount_cents)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon btn-sm"
      aria-label={`${label} kopiëren`}
      onClick={() => navigator.clipboard?.writeText(text).then(() => toast(`${label} gekopieerd`, "copy"))}
    >
      <Icon name="copy" size={14} />
    </button>
  );
}

function ContactButtons({ phone, email, name }: { phone: string | null; email: string | null; name: string }) {
  return (
    <>
      {phone && (
        <a className="btn btn-ghost btn-icon btn-sm" href={`tel:${phone}`} aria-label={`${name} bellen`}>
          <Icon name="phone" size={15} />
        </a>
      )}
      {email && (
        <a className="btn btn-ghost btn-icon btn-sm" href={`mailto:${email}`} aria-label={`${name} mailen`}>
          <Icon name="mail" size={15} />
        </a>
      )}
    </>
  );
}

// ---------- formulieren in een onderblad ----------

function useSheetForm<T>(save: (input: T) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function run(input: T) {
    setBusy(true);
    setError(undefined);
    try {
      await save(input);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function DeleteButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={onClick}>
      <Icon name="trash" size={16} /> Verwijderen
    </button>
  );
}

function ContactForm({ vendor, contact, onDone }: { vendor: Detail; contact?: VendorContact; onDone: (message: string) => void }) {
  const confirm = useConfirm();
  const [form, setForm] = useState<VendorContactInput>({
    name: contact?.name ?? "",
    role: contact?.role ?? "",
    branch_id: contact?.branch_id ?? null,
    phone: contact?.phone ?? "",
    email: contact?.email ?? "",
    notes: contact?.notes ?? "",
  });
  const set = <K extends keyof VendorContactInput>(key: K, value: VendorContactInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const base = `/vendors/${vendor.id}/contacts`;
  const { busy, error, run } = useSheetForm(async (input: VendorContactInput) => {
    if (contact) await api.put(`${base}/${contact.id}`, input);
    else await api.post(base, input);
    onDone(contact ? "Contactpersoon bijgewerkt" : "Contactpersoon toegevoegd");
  });

  async function remove() {
    if (!contact) return;
    if (!(await confirm({ title: `${contact.name} verwijderen?`, confirmLabel: "Verwijderen", danger: true }))) return;
    await api.delete(`${base}/${contact.id}`);
    onDone("Contactpersoon verwijderd");
  }

  return (
    <form
      className="form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        run(form);
      }}
    >
      <div className="field-row">
        <label className="field">
          <span className="label">Naam</span>
          <input required maxLength={100} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="bv. Tom" />
        </label>
        <label className="field">
          <span className="label">Rol</span>
          <input maxLength={100} value={form.role ?? ""} onChange={(e) => set("role", e.target.value)} placeholder="bv. technieker" />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span className="label">Telefoon</span>
          <input type="tel" maxLength={40} value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
        </label>
        <label className="field">
          <span className="label">E-mail</span>
          <input type="email" maxLength={200} value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        </label>
      </div>
      {vendor.branches.length > 0 && (
        <label className="field">
          <span className="label">Vestiging</span>
          <select value={form.branch_id ?? ""} onChange={(e) => set("branch_id", e.target.value || null)}>
            <option value="">Geen bepaalde vestiging</option>
            {vendor.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span className="label">
          <Icon name="note" size={15} /> Notitie
        </span>
        <input maxLength={2000} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="bv. enkel bereikbaar in de voormiddag" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        {contact && <DeleteButton busy={busy} onClick={remove} />}
        <SubmitButton busy={busy}>Bewaren</SubmitButton>
      </div>
    </form>
  );
}

function BranchForm({ vendor, branch, onDone }: { vendor: Detail; branch?: VendorBranch; onDone: (message: string) => void }) {
  const confirm = useConfirm();
  const [form, setForm] = useState<VendorBranchInput>({
    name: branch?.name ?? "",
    street: branch?.street ?? "",
    postal_code: branch?.postal_code ?? "",
    city: branch?.city ?? "",
    country: branch?.country ?? "",
    phone: branch?.phone ?? "",
    email: branch?.email ?? "",
    opening_hours: branch?.opening_hours ?? "",
    notes: branch?.notes ?? "",
  });
  const set = <K extends keyof VendorBranchInput>(key: K, value: VendorBranchInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const base = `/vendors/${vendor.id}/branches`;
  const { busy, error, run } = useSheetForm(async (input: VendorBranchInput) => {
    if (branch) await api.put(`${base}/${branch.id}`, input);
    else await api.post(base, input);
    onDone(branch ? "Vestiging bijgewerkt" : "Vestiging toegevoegd");
  });

  async function remove() {
    if (!branch) return;
    if (!(await confirm({ title: `${branch.name} verwijderen?`, confirmLabel: "Verwijderen", danger: true }))) return;
    await api.delete(`${base}/${branch.id}`);
    onDone("Vestiging verwijderd");
  }

  return (
    <form
      className="form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        run(form);
      }}
    >
      <label className="field">
        <span className="label">Naam</span>
        <input required maxLength={100} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={`bv. ${vendor.name} Halle`} />
      </label>
      <label className="field">
        <span className="label">Straat en nummer</span>
        <input maxLength={200} value={form.street ?? ""} onChange={(e) => set("street", e.target.value)} autoComplete="street-address" />
      </label>
      <div className="field-row">
        <label className="field">
          <span className="label">Postcode</span>
          <input maxLength={20} value={form.postal_code ?? ""} onChange={(e) => set("postal_code", e.target.value)} autoComplete="postal-code" />
        </label>
        <label className="field">
          <span className="label">Gemeente</span>
          <input maxLength={100} value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span className="label">Telefoon</span>
          <input type="tel" maxLength={40} value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
        </label>
        <label className="field">
          <span className="label">E-mail</span>
          <input type="email" maxLength={200} value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span className="label">Openingsuren</span>
        <input maxLength={500} value={form.opening_hours ?? ""} onChange={(e) => set("opening_hours", e.target.value)} placeholder="bv. ma–za 8u30–20u" />
      </label>
      <label className="field">
        <span className="label">
          <Icon name="note" size={15} /> Notitie
        </span>
        <input maxLength={2000} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="bv. parking achteraan" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        {branch && <DeleteButton busy={busy} onClick={remove} />}
        <SubmitButton busy={busy}>Bewaren</SubmitButton>
      </div>
    </form>
  );
}

/** Een bestaande kaart aan deze verkoper hangen. */
function LinkCards({ vendor, taxonomy, onDone }: { vendor: Detail; taxonomy: Taxonomy; onDone: (message: string) => void }) {
  const { data: cards } = useCards();
  const toast = useToast();
  const free = (cards ?? []).filter((c) => c.vendor_id !== vendor.id);
  const vendorName = (id: string | null) => taxonomy.vendors.find((x) => x.id === id)?.name;

  async function link(card: LoyaltyCard) {
    try {
      await api.put(`/vendors/${vendor.id}/cards/${card.id}`, {});
      onDone(`${card.name} gekoppeld`);
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }

  if (!cards) return <p className="muted">Kaarten laden…</p>;
  if (free.length === 0) {
    return (
      <div className="form">
        <p className="muted">Alle kaarten hangen al hier. Voeg een nieuwe kaart toe.</p>
        <div className="sheet-actions">
          <Link to={`/kaarten/nieuw?verkoper=${vendor.id}`} className="btn btn-primary">
            <Icon name="plus" size={16} /> Nieuwe kaart
          </Link>
        </div>
      </div>
    );
  }
  return (
    <ul className="rows">
      {free.map((card) => (
        <li key={card.id}>
          <button type="button" className="row" onClick={() => link(card)} style={{ width: "100%" }}>
            <span className="cell-main">
              <span className="row-media card-chip" style={{ background: card.color ?? undefined }}>
                <Icon name="card" size={16} />
              </span>
              <span className="row-main">
                <span className="row-title">{card.name}</span>
                <span className="row-meta">
                  <span>{card.vendor_id ? `nu bij ${vendorName(card.vendor_id) ?? "een andere verkoper"}` : "nog bij geen verkoper"}</span>
                </span>
              </span>
            </span>
            <Icon name="plus" size={16} className="row-chevron" />
          </button>
        </li>
      ))}
    </ul>
  );
}
