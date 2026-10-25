import { useState } from "react";
import { useParams } from "react-router";
import { Link, useNavigate } from "../router";
import { SPLIT_LABELS } from "../../shared/split";
import type { PurchaseDetail as Detail, PurchaseFile } from "../../shared/types";
import { api, apiUrl, useApi } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { Avatar, CardHead } from "../components/Controls";
import { FilePicker } from "../components/FilePicker";
import { FileViewer } from "../components/FileViewer";
import { Icon } from "../components/Icon";
import { itemPath, LinkItemForm, roleText } from "../components/ItemLinks";
import { Spinner, stagger } from "../components/Motion";
import { PageHead } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { formatBytes, formatCents, formatDate, warrantyStatus } from "../format";
import { prepareUpload } from "../image";
import { useSession } from "../session";
import { memberById, nameForEmail, useTaxonomy } from "../taxonomy";
import { WARRANTY_BADGE } from "./PurchaseList";

// HEIC kan enkel Safari tonen; die tonen we als bestand in plaats van als afbeelding.
const PREVIEWABLE = ["image/jpeg", "image/png", "image/webp"];

export function PurchaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const { data: p, error, reload } = useApi<Detail>(`/purchases/${id}`);
  const { data: taxonomy } = useTaxonomy();
  const { full } = useSession();
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [viewing, setViewing] = useState<PurchaseFile>();
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  if (error) return <p className="error page">{error}</p>;
  if (!p) return null;

  const warranty = warrantyStatus(p.warranty_until);
  const tags = taxonomy?.tags.filter((t) => p.tag_ids.includes(t.id)) ?? [];
  const vendor = taxonomy?.vendors.find((v) => v.id === p.vendor_id);
  const potName = (id: string | null) => taxonomy?.pots.find((pot) => pot.id === id)?.name ?? "Pot";
  // Wie wat draagt: tonen zodra er meer dan één persoon in zit, of iemand anders betaalde dan wie het draagt.
  const onlyPayerPays = p.shares.length === 1 && p.payments.length === 1 && p.payments[0].member_id === p.shares[0].member_id;
  const shares = onlyPayerPays ? [] : p.shares;
  const back = p.project_id ? { to: `/projecten/${p.project_id}`, label: p.project_name ?? "Project" } : { to: "/aankopen", label: "Aankopen" };

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

  const uploadFiles = () =>
    run(async () => {
      const body = new FormData();
      for (const file of newFiles) body.append("file", await prepareUpload(file));
      await api.post(`/purchases/${p.id}/files`, body);
      toast(newFiles.length === 1 ? "Bewijsstuk toegevoegd" : `${newFiles.length} bewijsstukken toegevoegd`);
      setNewFiles([]);
      reload();
    });

  async function deleteFile(file: PurchaseFile) {
    const ok = await confirm({ title: "Bewijsstuk verwijderen?", body: file.filename, confirmLabel: "Verwijderen", danger: true });
    if (!ok) return;
    run(async () => {
      await api.delete(`/files/${file.id}`);
      toast("Bewijsstuk verwijderd", "trash");
      reload();
    });
  }

  async function deletePurchase() {
    const ok = await confirm({
      title: "Aankoop verwijderen?",
      body: `"${p!.description}" en alle bewijsstukken worden definitief verwijderd.`,
      confirmLabel: "Verwijderen",
      danger: true,
    });
    if (!ok) return;
    run(async () => {
      await api.delete(`/purchases/${p!.id}`);
      toast("Aankoop verwijderd", "trash");
      navigate(back.to, { replace: true });
    });
  }

  return (
    <article className="page">
      <PageHead
        title={p.description}
        back={back}
        actions={
          <Link to={`/aankopen/${p.id}/bewerken`} className="btn btn-outline btn-sm">
            <Icon name="edit" size={15} /> Bewerken
          </Link>
        }
      />

      <div className="split">
        <aside className="split-aside">
          <section className="card">
            <div className="purchase-summary">
              <span className="amount-big">{formatCents(p.amount_cents) || "—"}</span>
              <span className="muted">{formatDate(p.purchased_on)}</span>
            </div>
            <dl className="dl">
              {p.vendor_name && (
                <div>
                  <dt>Verkoper</dt>
                  <dd>
                    {full && p.vendor_id ? (
                      <Link to={`/verkopers/${p.vendor_id}`} className="link-quiet">
                        {p.vendor_name}
                      </Link>
                    ) : (
                      p.vendor_name
                    )}
                    {vendor?.website && (
                      <a className="btn btn-ghost btn-icon btn-sm" href={vendor.website} target="_blank" rel="noreferrer" aria-label="Website">
                        <Icon name="external" size={15} />
                      </a>
                    )}
                    {vendor?.phone && (
                      <a className="btn btn-ghost btn-icon btn-sm" href={`tel:${vendor.phone}`} aria-label="Bellen">
                        <Icon name="phone" size={15} />
                      </a>
                    )}
                  </dd>
                </div>
              )}
              {p.category_name && (
                <div>
                  <dt>Categorie</dt>
                  <dd>
                    <span className={`dot tone-${p.category_color ?? "butter"}`} /> {p.category_name}
                  </dd>
                </div>
              )}
              {p.project_id && (
                <div>
                  <dt>Project</dt>
                  <dd>
                    <Link to={`/projecten/${p.project_id}`} className="link-quiet">
                      {p.project_name}
                    </Link>
                  </dd>
                </div>
              )}
              {p.payments.length > 0 && (
                <div>
                  <dt>Betaald door</dt>
                  <dd>
                    {p.payments.length > 1 ? (
                      `${p.payments.length} betalers`
                    ) : p.payments[0].member_id ? (
                      <>
                        <Avatar member={memberById(taxonomy, p.payments[0].member_id)} size="sm" /> {memberById(taxonomy, p.payments[0].member_id)?.name}
                      </>
                    ) : (
                      <>
                        <Icon name="piggy" size={15} /> {potName(p.payments[0].pot_id)}
                      </>
                    )}
                    {p.split_mode && <span className="muted">· {SPLIT_LABELS[p.split_mode].toLowerCase()}</span>}
                  </dd>
                </div>
              )}
              {p.payments.length > 1 &&
                p.payments.map((pay) => (
                  <div key={pay.member_id ?? pay.pot_id} className="sub">
                    <dt>{pay.member_id ? memberById(taxonomy, pay.member_id)?.name : potName(pay.pot_id)} betaalde</dt>
                    <dd>{formatCents(pay.amount_cents)}</dd>
                  </div>
                ))}
              {shares.map((s) => (
                <div key={s.member_id} className="sub">
                  <dt>
                    Deel {memberById(taxonomy, s.member_id)?.name ?? "?"}
                    {p.split_mode === "percent" && s.split_value !== null && ` · ${String(s.split_value).replace(".", ",")}%`}
                    {p.split_mode === "shares" && s.split_value !== null && ` · ${String(s.split_value).replace(".", ",")}×`}
                  </dt>
                  <dd>{formatCents(s.share_cents)}</dd>
                </div>
              ))}
              <div>
                <dt>Garantie</dt>
                <dd>
                  <span className={`badge ${WARRANTY_BADGE[warranty.tone]}`}>{warranty.label}</span>
                </dd>
              </div>
            </dl>
            {tags.length > 0 && (
              <p className="tag-line">
                {tags.map((t) => (
                  <span key={t.id} className={`tag static tone-${t.color ?? "butter"}`}>
                    {t.name}
                  </span>
                ))}
              </p>
            )}
            {p.notes && (
              <p className="note-block">
                <Icon name="note" size={16} />
                <span>{p.notes}</span>
              </p>
            )}
            <p className="footnote">Bewaard door {nameForEmail(taxonomy, p.created_by)}</p>
          </section>
        </aside>

        <div className="split-main">
          <section className="card">
            <CardHead
              icon="file"
              title="Bewijsstukken"
              description={p.files.length === 0 ? "Nog geen foto of PDF" : `${p.files.length} bestand${p.files.length === 1 ? "" : "en"}`}
            />
            <ul className="gallery stagger">
              {p.files.map((f, i) => (
                <li key={f.id} style={stagger(i)}>
                  <button type="button" className="gallery-open" onClick={() => setViewing(f)}>
                    {PREVIEWABLE.includes(f.content_type) ? (
                      <img src={apiUrl(`/files/${f.id}`)} alt={f.filename} loading="lazy" />
                    ) : (
                      <span className="file-tile">
                        <Icon name="file" size={24} />
                        <span>{f.filename}</span>
                      </span>
                    )}
                  </button>
                  <div className="gallery-meta">
                    <span className="muted">{formatBytes(f.size_bytes)}</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      disabled={busy}
                      onClick={() => deleteFile(f)}
                      aria-label={`${f.filename} verwijderen`}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="card-body" style={{ display: "grid", gap: 10, paddingTop: p.files.length ? 16 : 0 }}>
              <FilePicker files={newFiles} onChange={setNewFiles} />
              {newFiles.length > 0 && (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={uploadFiles}>
                  {busy && <Spinner />}
                  {newFiles.length === 1 ? "Bestand uploaden" : `${newFiles.length} bestanden uploaden`}
                </button>
              )}
              {actionError && <p className="error">{actionError}</p>}
            </div>
          </section>

          {p.lines.length > 0 && (
            <section className="card">
              <CardHead icon="listLines" title="Per lijn" description="Wie wat had op het ticket" />
              <ul className="rows">
                {p.lines.map((line, i) => (
                  <li key={i}>
                    <div className="row" style={{ minHeight: 48 }}>
                      <span className="row-main">
                        <span className="row-title" style={{ fontWeight: 450 }}>
                          {line.description}
                        </span>
                      </span>
                      <span className="avatar-stack">
                        {line.member_ids.length === 0 ? (
                          <span className="muted small">iedereen</span>
                        ) : (
                          line.member_ids.map((id) => <Avatar key={id} member={memberById(taxonomy, id)} size="sm" />)
                        )}
                      </span>
                      <span className="row-end">{formatCents(line.amount_cents)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {full && (
            <section className="card">
              <CardHead
                icon="armchair"
                title="Waarvoor"
                description={p.links.length === 0 ? "Hang deze uitgave aan iets dat je hebt: de kachel, de pellets, de wasmachine" : undefined}
                action={
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setLinking(true)}>
                    <Icon name="plus" size={15} /> Koppelen
                  </button>
                }
              />
              {p.links.length > 0 && (
                <ul className="rows">
                  {p.links.map((link) => (
                    <li key={link.id}>
                      <Link to={itemPath({ id: link.item_id, type: link.item_type })} className="row" style={{ minHeight: 52 }}>
                        <span className="cell-main">
                          <span className="row-media">
                            <Icon name={link.item_type === "asset" ? "armchair" : "package"} size={16} />
                          </span>
                          <span className="row-main">
                            <span className="row-title">{link.item_name}</span>
                            <span className="row-meta">
                              <span>{roleText(link.role, link.quantity, link.unit)}</span>
                            </span>
                          </span>
                        </span>
                        {link.amount_cents !== null && <span className="row-end">{formatCents(link.amount_cents)}</span>}
                        <Icon name="next" size={16} className="row-chevron" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div className="card-body btn-row" style={{ paddingTop: p.links.length ? 14 : 0 }}>
                <Link to={`/bezit/nieuw?aankoop=${p.id}`} className="btn btn-outline">
                  <Icon name="armchair" size={16} /> Nieuw bezit
                </Link>
                <Link to={`/voorraad/nieuw?aankoop=${p.id}`} className="btn btn-outline">
                  <Icon name="package" size={16} /> In voorraad
                </Link>
              </div>
            </section>
          )}

          <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={deletePurchase} style={{ justifySelf: "start" }}>
            <Icon name="trash" size={16} /> Verwijderen
          </button>
        </div>
      </div>

      {viewing && <FileViewer file={viewing} onClose={() => setViewing(undefined)} />}

      <Sheet open={linking} title="Waarvoor is deze uitgave?" onClose={() => setLinking(false)}>
        {linking && (
          <LinkItemForm
            purchase={p}
            onDone={(message) => {
              setLinking(false);
              toast(message);
              reload();
            }}
          />
        )}
      </Sheet>
    </article>
  );
}
