import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { PurchaseFile, PurchaseWithFiles } from "../../shared/types";
import { api, useApi } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { FilePicker } from "../components/FilePicker";
import { FileViewer } from "../components/FileViewer";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/Page";
import { formatBytes, formatCents, formatDate, warrantyStatus } from "../format";
import { prepareUpload } from "../image";

// HEIC kan enkel Safari tonen; die tonen we als bestand in plaats van als afbeelding.
const PREVIEWABLE = ["image/jpeg", "image/png", "image/webp"];

export function PurchaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: p, error, reload } = useApi<PurchaseWithFiles>(`/purchases/${id}`);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [viewing, setViewing] = useState<PurchaseFile>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  if (error) return <p className="error page">{error}</p>;
  if (!p) return null;

  const warranty = warrantyStatus(p.warranty_until);

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
      setNewFiles([]);
      reload();
    });

  async function deleteFile(file: PurchaseFile) {
    const ok = await confirm({ title: "Bewijsstuk verwijderen?", body: file.filename, confirmLabel: "Verwijderen", danger: true });
    if (!ok) return;
    run(async () => {
      await api.delete(`/files/${file.id}`);
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
      navigate("/aankopen", { replace: true });
    });
  }

  return (
    <article className="page">
      <PageHeader
        title={p.description}
        back="/aankopen"
        actions={
          <Link to={`/aankopen/${p.id}/bewerken`} className="icon-button" aria-label="Bewerken">
            <Icon name="edit" />
          </Link>
        }
      />

      <div className="detail-grid">
        {/* De gegevens als een kasticket, met gekartelde onderrand. */}
        <div className="receipt-wrap">
          <section className="receipt" aria-label="Gegevens">
            <p className="receipt-store">{p.store ?? "Aankoop"}</p>
            <p className="receipt-date">{formatDate(p.purchased_on)}</p>
            <dl className="receipt-lines">
              {p.category && (
                <div>
                  <dt>Categorie</dt>
                  <dd>{p.category}</dd>
                </div>
              )}
              <div>
                <dt>Garantie</dt>
                <dd>
                  <span className={`badge ${warranty.tone}`}>{warranty.label}</span>
                </dd>
              </div>
              {p.warranty_until && warranty.tone !== "ok" && (
                <div>
                  <dt>Garantie tot</dt>
                  <dd>{formatDate(p.warranty_until)}</dd>
                </div>
              )}
            </dl>
            <div className="receipt-total">
              <span>Totaal</span>
              <strong>{formatCents(p.amount_cents) || "—"}</strong>
            </div>
            {p.notes && <p className="receipt-notes">{p.notes}</p>}
            <p className="receipt-footer">Bewaard door {p.created_by}</p>
          </section>
        </div>

        <section className="files-panel">
          <h2>Bewijsstukken</h2>
          {p.files.length === 0 && <p className="muted">Nog geen bewijsstuk toegevoegd.</p>}
          <ul className="gallery">
            {p.files.map((f) => (
              <li key={f.id}>
                <button type="button" className="gallery-open" onClick={() => setViewing(f)}>
                  {PREVIEWABLE.includes(f.content_type) ? (
                    <img src={`/api/files/${f.id}`} alt={f.filename} loading="lazy" />
                  ) : (
                    <span className="file-tile">
                      <Icon name="file" size={28} />
                      <span>{f.filename}</span>
                    </span>
                  )}
                </button>
                <div className="gallery-meta">
                  <span className="muted">{formatBytes(f.size_bytes)}</span>
                  <button
                    type="button"
                    className="icon-button small"
                    disabled={busy}
                    onClick={() => deleteFile(f)}
                    aria-label={`${f.filename} verwijderen`}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <FilePicker files={newFiles} onChange={setNewFiles} />
          {newFiles.length > 0 && (
            <button type="button" className="button primary" disabled={busy} onClick={uploadFiles}>
              {busy ? "Uploaden…" : newFiles.length === 1 ? "Bestand uploaden" : `${newFiles.length} bestanden uploaden`}
            </button>
          )}
          {actionError && <p className="error">{actionError}</p>}
        </section>
      </div>

      <button type="button" className="button danger" disabled={busy} onClick={deletePurchase}>
        <Icon name="trash" /> Aankoop verwijderen
      </button>

      {viewing && <FileViewer file={viewing} onClose={() => setViewing(undefined)} />}
    </article>
  );
}
