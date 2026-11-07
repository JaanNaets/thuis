import { useState } from "react";
import { useParams } from "react-router";
import { formatDuration } from "../../shared/fields";
import { everyText } from "../../shared/remind";
import { BASES, LINE_ROLES, minutesBetween, STATUSES, timeOf, type EventView } from "../../shared/model";
import { formatAmount } from "../../shared/units";
import { api, useApi } from "../api";
import { CardHead } from "../components/Controls";
import { AttributeRows, ItemPhoto, namesFrom } from "../components/Fields";
import { FileViewer, type Attachment } from "../components/FileViewer";
import { Icon } from "../components/Icon";
import { BASE_TONES, dayLabel, usePageNames, type EventPage as Page } from "../components/Log";
import { PageHead } from "../components/Page";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { formatCents } from "../format";
import { Link, useNavigate } from "../router";

type Detail = Page & { event: EventView; can_edit: boolean; files: Attachment[]; ticked: { id: string; name: string }[] };

/**
 * Een gebeurtenis: wat, wanneer, wie betaalde en deelt, en haar lijnen naar de dingen. Zie je ze enkel via een ding
 * (een lijn in een lijst die je ziet), dan enkel die lijnen. Zie STIJLBOEK.md → Fiche.
 */
export function EventPage() {
  const { eventId } = useParams();
  const { data, error, reload, mutate } = useApi<Detail>(`/events/${eventId}`);
  const names = usePageNames(data);
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [viewing, setViewing] = useState<Attachment | null>(null);
  if (error && !data) return <p className="error page">{error}</p>;
  if (!data) return <p className="page muted">Laden…</p>;
  const e = data.event;
  const kind = names.kind(e);
  const title = e.partial ? kind.name : names.title(e);
  const minutes = e.end_at ? minutesBetween(e.at, e.end_at) : null;
  const running = e.base === "activiteit" && !e.end_at && e.at.length > 10 && e.status === "gebeurd";
  const fieldNames = namesFrom(data.people, data.things);

  async function tick(undo = false) {
    try {
      await api.post(`/events/${e.id}/tick`, undo ? { undo: true } : {});
      toast(undo ? "Weer open" : e.base === "aankoop" ? "Afgevinkt" : "Gedaan");
      reload();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  async function stop() {
    await api.post(`/events/${e.id}/stop`, {});
    toast("Gestopt");
    reload();
  }
  async function remove() {
    const body = data!.ticked.length ? "Wat deze aankoop afvinkte, staat dan weer open." : undefined;
    if (!(await confirm({ title: `${title} verwijderen?`, body, confirmLabel: "Verwijderen", danger: true }))) return;
    await api.delete(`/events/${e.id}`);
    toast(`${title} verwijderd`);
    navigate(-1);
  }

  const facts: [string, string][] = [
    ["Formulier", kind.name],
    ["Wanneer", `${dayLabel(e.at.slice(0, 10))}${timeOf(e.at) ? ` om ${timeOf(e.at)}` : ""}${e.end_at ? ` tot ${timeOf(e.end_at)}` : ""}`],
    ...(minutes !== null && minutes > 0 ? ([["Duur", formatDuration(minutes)]] as [string, string][]) : []),
    ...(e.amount !== null ? ([["Bedrag", formatCents(e.amount)]] as [string, string][]) : []),
    ...(e.paid_by ? ([[e.base === "overdracht" ? "Van" : "Betaald door", names.person(e.paid_by)]] as [string, string][]) : []),
    ...(e.to_person ? ([["Naar", names.person(e.to_person)]] as [string, string][]) : []),
    ...(e.split?.length
      ? ([[e.base === "gebruik" ? "Wie" : "Gedeeld met", e.split.map((s) => `${names.person(s.person_id)}${e.split!.length > 1 && Math.abs(s.share - 100 / e.split!.length) > 0.5 ? ` ${Math.round(s.share)}%` : ""}`).join(", ")]] as [string, string][])
      : []),
    ...(e.repeat ? ([["Herhaalt", everyText(e.repeat.every)]] as [string, string][]) : []),
    ["Gelogd door", names.person(e.created_by)],
  ];

  return (
    <div className="page">
      <PageHead
        title={title}
        badge={e.status !== "gebeurd" ? <span className="badge badge-secondary">{STATUSES[e.status].label}</span> : running ? <span className="badge badge-accent">Loopt</span> : undefined}
        description={e.partial ? "Gelogd in een lijst die je niet ziet" : undefined}
        back={{ to: -1, label: e.partial ? "Terug" : names.list(e.list_id) || "Terug" }}
        actions={
          data.can_edit && (
            <>
              {e.status === "gepland" && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => tick()}>
                  <Icon name="check" size={15} /> {e.base === "aankoop" ? "Afvinken" : "Gedaan"}
                </button>
              )}
              {e.status === "afgevinkt" && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => tick(true)}>
                  Weer open
                </button>
              )}
              {running && (
                <button type="button" className="btn btn-outline btn-sm" onClick={stop}>
                  Stoppen
                </button>
              )}
              <Link to={`/gebeurtenissen/${e.id}/bewerken`} className="btn btn-outline btn-sm">
                Bewerken
              </Link>
            </>
          )
        }
      />
      <div className="split">
        <aside className="split-aside">
          <section className="card">
            {!e.partial && <ItemPhoto item={{ id: e.id, name: title, photo_version: e.photo_version }} base="events" canEdit={data.can_edit} onChange={(v, m) => (mutate({ ...data, event: { ...e, photo_version: v } }), toast(m))} />}
            <dl className="dl">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
              {!e.partial && (
                <div>
                  <dt>Lijst</dt>
                  <dd>
                    <Link to={`/lijsten/${e.list_id}?tab=logboek`} className="link-quiet">
                      {names.list(e.list_id)}
                    </Link>
                  </dd>
                </div>
              )}
              {!e.partial && <AttributeRows defs={kind.fields} data={e.data} names={fieldNames} refs={data.things} />}
            </dl>
          </section>
        </aside>
        <div className="split-main">
          {e.lines.length > 0 && (
            <section className="card">
              <CardHead title="Lijnen" />
              <ul className="rows">
                {e.lines.map((l) => {
                  const t = l.thing_id ? names.thing(l.thing_id) : undefined;
                  const label = t?.name ?? l.text ?? "Verborgen";
                  const meta = [
                    LINE_ROLES[l.role].label,
                    l.amount !== null ? formatAmount(l.amount, l.unit ?? t?.unit ?? null) : null,
                    t?.list || null,
                    l.owner ? `van ${names.person(l.owner)}` : null,
                    l.expires ? `houdbaar tot ${dayLabel(l.expires)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  const body = (
                    <>
                      <span className="cell-main">
                        <span className={`row-media tone-${BASE_TONES[e.base]}`}>
                          <Icon name={l.role === "bij" ? "store" : l.role === "uit" ? "minus" : l.role === "in" ? "plus" : "next"} size={16} />
                        </span>
                        <span className="row-main">
                          <span className="row-title">{label}</span>
                          <span className="row-meta">
                            <span>{meta}</span>
                          </span>
                        </span>
                      </span>
                      <span className="row-end">{l.price !== null ? formatCents(l.price) : ""}</span>
                    </>
                  );
                  return (
                    <li key={l.id}>
                      {t?.list ? (
                        <Link to={`/dingen/${t.id}`} className="row">
                          {body}
                        </Link>
                      ) : (
                        <div className="row">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {data.ticked.length > 0 && (
            <section className="card">
              <CardHead title="Afgevinkt" />
              <ul className="rows">
                {data.ticked.map((t) => (
                  <li key={t.id}>
                    <Link to={`/gebeurtenissen/${t.id}`} className="row">
                      <span className="cell-main">
                        <span className="row-title">{t.name || "Boodschap"}</span>
                      </span>
                      <Icon name="next" size={16} className="row-chevron" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.files.length > 0 && (
            <section className="card">
              <CardHead title="Bestanden" />
              <ul className="rows">
                {data.files.map((f) => (
                  <li key={f.id}>
                    <button type="button" className="row" onClick={() => setViewing(f)}>
                      <span className="cell-main">
                        <span className="row-media">
                          <Icon name="file" size={16} />
                        </span>
                        <span className="row-title">{f.filename}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.can_edit && (
            <div className="btn-row" style={{ justifySelf: "start" }}>
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={remove}>
                <Icon name="trash" size={15} /> Verwijderen
              </button>
            </div>
          )}
        </div>
      </div>
      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

export { BASES };
