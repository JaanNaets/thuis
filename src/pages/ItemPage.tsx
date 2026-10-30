import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import type { ChecklistEntry, CodeValue } from "../../shared/fields";
import type { ItemDetail, ItemFile, LogEntry, ProjectDetail } from "../../shared/types";
import { api, apiUrl, useApi } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { CardHead, SubmitButton } from "../components/Controls";
import { AttributeRows, ChecklistView, CodeView, ItemPhoto, namesFrom } from "../components/Fields";
import { FilePicker } from "../components/FilePicker";
import { FileViewer } from "../components/FileViewer";
import { Icon } from "../components/Icon";
import { stagger } from "../components/Motion";
import { PageHead } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { formatBytes, formatDate, today } from "../format";
import { prepareUpload } from "../image";
import { Link, useNavigate } from "../router";

export function ItemPage() {
  const { itemId } = useParams();
  const { data: item, error, reload, mutate } = useApi<ItemDetail>(`/items/${itemId}`);
  if (error) return <p className="error page">{error}</p>;
  if (!item) return null;
  return <ItemWithProject item={item} reload={reload} mutate={mutate} />;
}

/**
 * De fiche van een item: in de zijkolom de foto en de velden, rechts een barcode om te tonen, lange teksten,
 * het logboek, bestanden en wat naar dit item verwijst.
 */
function ItemWithProject({ item, reload, mutate }: { item: ItemDetail; reload: () => void; mutate: (i: ItemDetail) => void }) {
  const { data: p } = useApi<ProjectDetail>(`/projects/${item.project_id}`);
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [viewing, setViewing] = useState<ItemFile>();
  const [logging, setLogging] = useState<LogEntry | "new">();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  if (!p) return null;

  const type = p.types.find((t) => t.id === item.type_id);
  if (!type) return null;
  const names = namesFrom(item.people, item.refs);
  const canEdit = item.access === "edit";
  const canEditSome = canEdit || Object.values(item.field_access).includes("edit");
  const tags = p.tags.filter((t) => item.tag_ids.includes(t.id));
  const codes = type.fields.filter((f) => f.type === "code" && item.data[f.key]);
  const texts = type.fields.filter((f) => f.type === "longtext" && item.data[f.key]);
  const checklists = type.fields.filter((f) => f.type === "checklist" && item.data[f.key]);
  const back = `/projecten/${p.project.id}?lijst=${type.id}`;

  // Een taak afvinken bewaart meteen (het item met dat ene veld anders). Lukt het niet, dan gaat het vinkje terug.
  async function saveChecklist(key: string, next: ChecklistEntry[]) {
    try {
      mutate(
        await api.put<ItemDetail>(`/items/${item.id}`, { type_id: item.type_id, name: item.name, data: { ...item.data, [key]: next }, tag_ids: item.tag_ids }),
      );
    } catch (err) {
      toast((err as Error).message, "alert");
      throw err;
    }
  }

  async function upload() {
    setUploading(true);
    try {
      const body = new FormData();
      for (const f of files) body.append("file", await prepareUpload(f));
      await api.post(`/items/${item.id}/files`, body);
      setFiles([]);
      toast("Bestand bewaard");
      reload();
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setUploading(false);
    }
  }

  async function removeFile(file: ItemFile) {
    if (!(await confirm({ title: `${file.filename} verwijderen?`, confirmLabel: "Verwijderen", danger: true }))) return;
    await api.delete(`/files/${file.id}`);
    toast("Bestand verwijderd", "trash");
    reload();
  }

  async function toggleArchived() {
    mutate(await api.put<ItemDetail>(`/items/${item.id}/archived`, { archived: item.archived === 0 }));
    toast(item.archived ? "Terug uit het archief" : "Gearchiveerd", "archive");
  }

  async function remove() {
    const ok = await confirm({
      title: `${item.name} verwijderen?`,
      body: "Het logboek en de bestanden verdwijnen mee. Wil je het bijhouden? Archiveer het dan.",
      confirmLabel: "Verwijderen",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/items/${item.id}`);
    toast("Verwijderd", "trash");
    navigate(back, { replace: true });
  }

  return (
    <article className="page">
      <PageHead
        title={item.name}
        badge={item.archived ? <span className="badge">Gearchiveerd</span> : undefined}
        description={`${type.name} · ${p.project.name}`}
        back={{ to: back, label: p.project.name }}
        actions={
          <>
            {type.can_create && !p.project.archived && (
              <Link to={`/projecten/${item.project_id}/nieuw?lijst=${type.id}&van=${item.id}`} className="btn btn-outline btn-sm">
                <Icon name="repeat" size={15} /> Opnieuw
              </Link>
            )}
            {canEditSome && (
              <Link to={`/items/${item.id}/bewerken`} className="btn btn-outline btn-sm">
                <Icon name="edit" size={15} /> Bewerken
              </Link>
            )}
          </>
        }
      />

      <div className="split">
        <aside className="split-aside">
          <section className="card">
            <ItemPhoto
              item={item}
              canEdit={canEdit}
              onChange={(version, message) => {
                mutate({ ...item, photo_version: version });
                toast(message);
              }}
            />
            <dl className="dl">
              <AttributeRows defs={type.fields} data={item.data} names={names} refs={item.refs} lists={p.types} />
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

          {texts.map((f) => (
            <section key={f.key} className="card">
              <CardHead title={f.label} />
              <p className="tips-block">{item.data[f.key] as string}</p>
            </section>
          ))}
        </aside>

        <div className="split-main">
          {checklists.map((f) => {
            const list = item.data[f.key] as ChecklistEntry[];
            return (
              <section key={f.key} className="card">
                <CardHead title={f.label} description={`${list.filter((e) => e.done).length} van ${list.length} klaar`} />
                <div className="card-body">
                  <ChecklistView value={list} onToggle={item.field_access[f.key] === "edit" ? (next) => saveChecklist(f.key, next) : undefined} />
                </div>
              </section>
            );
          })}

          {codes.map((f) => (
            <section key={f.key} className="card">
              <CardHead title={f.label} description="Laat scannen aan de kassa of de balie" />
              <div className="card-body">
                <CodeView value={item.data[f.key] as CodeValue} />
              </div>
            </section>
          ))}

          {item.backlinks.length > 0 && (
            <section className="card">
              <CardHead title="Verwijst hiernaar" />
              <ul className="rows">
                {item.backlinks.map((b) => (
                  <li key={b.id}>
                    <Link to={`/items/${b.id}`} className="row" style={{ minHeight: 52 }}>
                      <span className="row-main">
                        <span className="row-title">{b.name}</span>
                        <span className="row-meta">
                          <span>{b.field_label}</span>
                        </span>
                      </span>
                      <Icon name="next" size={16} className="row-chevron" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <CardHead
              title="Logboek"
              description={item.log.length === 0 ? "Wat er gebeurde, op datum" : undefined}
              action={
                canEdit && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setLogging("new")}>
                    <Icon name="plus" size={15} /> Notitie
                  </button>
                )
              }
            />
            {item.log.length > 0 && (
              <ul className="rows timeline stagger">
                {item.log.map((entry, i) => (
                  <li key={entry.id} style={stagger(i)}>
                    <button type="button" className="row" disabled={!canEdit} onClick={() => setLogging(entry)}>
                      <span className="timeline-date">{formatDate(entry.happened_on)}</span>
                      <span className="row-main">
                        <span className="timeline-text">{entry.text}</span>
                        <span className="row-meta">
                          <span>{entry.created_by_name ?? ""}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <CardHead title="Bestanden" description={item.files.length === 0 ? "Factuur, handleiding, garantiebewijs" : undefined} />
            {item.files.length > 0 && (
              <ul className="rows">
                {item.files.map((f) => (
                  <li key={f.id}>
                    <div className="row">
                      <button type="button" className="row-link" onClick={() => setViewing(f)}>
                        <span className="row-media">
                          {f.content_type.startsWith("image/") ? <img src={apiUrl(`/files/${f.id}`)} alt="" loading="lazy" /> : <Icon name="file" size={16} />}
                        </span>
                        <span className="row-main">
                          <span className="row-title">{f.filename}</span>
                          <span className="row-meta">
                            <span>{formatBytes(f.size_bytes)}</span>
                          </span>
                        </span>
                      </button>
                      {canEdit && (
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => removeFile(f)} aria-label={`${f.filename} verwijderen`}>
                          <Icon name="trash" size={15} />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <div className="card-body form">
                <FilePicker files={files} onChange={setFiles} />
                {files.length > 0 && (
                  <button type="button" className="btn btn-primary" disabled={uploading} onClick={upload}>
                    {uploading ? "Bewaren…" : `${files.length === 1 ? "Bestand" : `${files.length} bestanden`} bewaren`}
                  </button>
                )}
              </div>
            )}
          </section>

          {(canEdit || item.can_delete) && (
            <div className="btn-row" style={{ justifySelf: "start" }}>
              {canEdit && (
                <button type="button" className="btn btn-ghost" onClick={toggleArchived}>
                  <Icon name="archive" size={16} /> {item.archived ? "Terug uit het archief" : "Archiveren"}
                </button>
              )}
              {item.can_delete && (
                <button type="button" className="btn btn-danger-ghost" onClick={remove}>
                  <Icon name="trash" size={16} /> Verwijderen
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {viewing && <FileViewer file={viewing} onClose={() => setViewing(undefined)} />}

      <Sheet open={Boolean(logging)} title={logging === "new" ? "Nieuwe notitie" : "Notitie"} onClose={() => setLogging(undefined)}>
        {logging && (
          <LogForm
            itemId={item.id}
            entry={logging === "new" ? undefined : logging}
            onDone={(message) => {
              setLogging(undefined);
              toast(message);
              reload();
            }}
          />
        )}
      </Sheet>
    </article>
  );
}

function LogForm({ itemId, entry, onDone }: { itemId: string; entry?: LogEntry; onDone: (message: string) => void }) {
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
      if (entry) await api.put(`/items/${itemId}/log/${entry.id}`, body);
      else await api.post(`/items/${itemId}/log`, body);
      onDone(entry ? "Notitie bijgewerkt" : "Notitie bewaard");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!entry || !(await confirm({ title: "Notitie verwijderen?", confirmLabel: "Verwijderen", danger: true }))) return;
    await api.delete(`/items/${itemId}/log/${entry.id}`);
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
          maxLength={4000}
          autoFocus={!entry}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="bv. Gekuist, blazer op 2"
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
