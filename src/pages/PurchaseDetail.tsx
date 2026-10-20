import { useState } from "react";
import { useParams } from "react-router";
import { Link, useNavigate } from "../router";
import { SPLIT_MODES, type PurchaseDetail as Detail, type PurchaseFile } from "../../shared/types";
import { api, useApi } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { Avatar, CardHead } from "../components/Controls";
import { FilePicker } from "../components/FilePicker";
import { FileViewer } from "../components/FileViewer";
import { Icon } from "../components/Icon";
import { Spinner, stagger } from "../components/Motion";
import { PageHead } from "../components/Page";
import { useToast } from "../components/Toast";
import { formatBytes, formatCents, formatDate, warrantyStatus } from "../format";
import { prepareUpload } from "../image";
import { memberById, nameForEmail, useTaxonomy } from "../taxonomy";
import { WARRANTY_BADGE } from "./PurchaseList";

// HEIC kan enkel Safari tonen; die tonen we als bestand in plaats van als afbeelding.
const PREVIEWABLE = ["image/jpeg", "image/png", "image/webp"];

const SPLIT_LABELS: Record<(typeof SPLIT_MODES)[number], string> = {
  equal: "gelijk verdeeld",
  personal: "persoonlijk",
  custom: "aangepast verdeeld",
};

export function PurchaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const { data: p, error, reload } = useApi<Detail>(`/purchases/${id}`);
  const { data: taxonomy } = useTaxonomy();
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [viewing, setViewing] = useState<PurchaseFile>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  if (error) return <p className="error page">{error}</p>;
  if (!p) return null;

  const warranty = warrantyStatus(p.warranty_until);
  const payer = memberById(taxonomy, p.paid_by);
  const tags = taxonomy?.tags.filter((t) => p.tag_ids.includes(t.id)) ?? [];
  const vendor = taxonomy?.vendors.find((v) => v.id === p.vendor_id);
  // Bij een verdeling over meerdere mensen tonen we wie hoeveel draagt.
  const shares = p.shares.length > 1 ? p.shares : [];

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
      navigate("/aankopen", { replace: true });
    });
  }

  return (
    <article className="page">
      <PageHead
        title={p.description}
        back={{ to: "/aankopen", label: "Aankopen" }}
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
                    {p.vendor_name}
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
              <div>
                <dt>Betaald door</dt>
                <dd>
                  {payer ? (
                    <>
                      <Avatar member={payer} size="sm" /> {payer.name}
                      {p.split_mode && <span className="muted">· {SPLIT_LABELS[p.split_mode]}</span>}
                    </>
                  ) : (
                    "Gezamenlijke rekening"
                  )}
                </dd>
              </div>
              {shares.map((s) => (
                <div key={s.member_id} className="sub">
                  <dt>Deel {memberById(taxonomy, s.member_id)?.name ?? "?"}</dt>
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
                      <img src={`/api/files/${f.id}`} alt={f.filename} loading="lazy" />
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

          <section className="card">
            <CardHead icon="package" title="In voorraad" description="Een toestel of iets dat je bijhoudt, met dit bewijsstuk en de garantie erbij." />
            {p.items.length > 0 && (
              <ul className="rows">
                {p.items.map((item) => (
                  <li key={item.id}>
                    <Link to={`/voorraad/${item.id}`} className="row" style={{ minHeight: 52 }}>
                      <span className="row-media">
                        <Icon name="package" size={16} />
                      </span>
                      <span className="row-main">
                        <span className="row-title">{item.name}</span>
                      </span>
                      <Icon name="next" size={16} className="row-chevron" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="card-body" style={{ paddingTop: p.items.length ? 14 : 0 }}>
              <Link to={`/voorraad/nieuw?aankoop=${p.id}`} className="btn btn-outline btn-block">
                <Icon name="package" size={16} /> {p.items.length > 0 ? "Nog iets in voorraad zetten" : "In voorraad zetten"}
              </Link>
            </div>
          </section>

          <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={deletePurchase} style={{ justifySelf: "start" }}>
            <Icon name="trash" size={16} /> Aankoop verwijderen
          </button>
        </div>
      </div>

      {viewing && <FileViewer file={viewing} onClose={() => setViewing(undefined)} />}
    </article>
  );
}
