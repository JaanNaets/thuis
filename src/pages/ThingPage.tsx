import { useState } from "react";
import { useParams } from "react-router";
import { formatFieldValue, type FieldDef } from "../../shared/fields";
import { BASES, type List, type Role, type StockLevel, type Thing, type ThingRef } from "../../shared/model";
import { formatAmount } from "../../shared/units";
import type { Person } from "../../shared/types";
import { api, useApi } from "../api";
import { CardHead } from "../components/Controls";
import { AttributeRows, ItemPhoto, namesFrom } from "../components/Fields";
import { FileViewer, type Attachment } from "../components/FileViewer";
import { Icon, type IconName } from "../components/Icon";
import { LogButtons } from "../components/LogButtons";
import { BASE_TONES, dayLabel } from "../components/Log";
import { stagger } from "../components/Motion";
import { PageHead } from "../components/Page";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { formatCents } from "../format";
import { Link, useNavigate } from "../router";

type Entry = {
  event_id: string;
  kind: string;
  kind_name: string;
  base: keyof typeof BASES;
  status: string;
  at: string;
  list_id: string;
  list: string | null;
  partial: boolean;
  name: string;
  role: "in" | "uit" | "voor" | "bij";
  amount: number | null;
  unit: string | null;
  price: number | null;
  unit_price: number | null;
  expires: string | null;
  store: string | null;
  created_by: string;
};

type ThingDetail = {
  thing: Thing;
  list: Pick<List, "id" | "name" | "one" | "icon" | "color" | "fields" | "stock">;
  role: Role;
  can_edit: boolean;
  stock: StockLevel | null;
  timeline: Entry[];
  parts: { id: string; name: string; list_id: string }[];
  part_of: ThingRef | null;
  files: Attachment[];
  people: Person[];
  refs: ThingRef[];
  backlinks: (ThingRef & { field_label: string })[];
  /** Gekoppeld (zie shared/transfer.ts): uit welke lijst (als je die ziet) en het origineel. */
  mirror: { source: { id: string; name: string } | null; of: ThingRef | null; locked: string[] } | null;
};

const ROLE_WORD = { in: "erbij", uit: "eraf", voor: "voor", bij: "bij" } as const;

/**
 * Een ding: zijn foto, velden en voorraad opzij; rechts zijn tijdlijn (alles wat ermee gebeurde, met prijs per eenheid
 * en waar), zijn delen en wat ernaar verwijst. Zie STIJLBOEK.md → Fiche.
 */
export function ThingPage() {
  const { thingId } = useParams();
  const { data, error, reload, mutate } = useApi<ThingDetail>(`/things/${thingId}`);
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [viewing, setViewing] = useState<Attachment | null>(null);
  if (error && !data) return <p className="error page">{error}</p>;
  if (!data) return <p className="page muted">Laden…</p>;
  const { thing, list } = data;
  const names = namesFrom(data.people, data.refs);
  const notes = list.fields.filter((f: FieldDef) => f.type === "longtext" && thing.data[f.key]);
  const other = list.fields.filter((f: FieldDef) => !(f.type === "longtext" && thing.data[f.key]));

  async function archive() {
    await api.put(`/things/${thing.id}/archived`, { archived: !thing.archived });
    toast(thing.archived ? `${thing.name} terug uit het archief` : `${thing.name} gearchiveerd`);
    reload();
  }
  async function remove() {
    if (!(await confirm({ title: `${thing.name} verwijderen?`, body: "Wat ermee gebeurde, blijft in het logboek staan, met de naam als tekst.", confirmLabel: "Verwijderen", danger: true }))) return;
    await api.delete(`/things/${thing.id}`);
    toast(`${thing.name} verwijderd`);
    navigate(`/lijsten/${list.id}`, { replace: true });
  }

  return (
    <div className="page">
      <PageHead
        title={thing.name}
        badge={thing.archived ? <span className="badge badge-muted">Gearchiveerd</span> : undefined}
        back={{ to: `/lijsten/${list.id}`, label: list.name }}
        actions={
          <>
            {/* Een knop per formulier ("Uit eten", "Aankoop"), met dit ding al ingevuld. */}
            {!thing.archived && <LogButtons listId={list.id} thing={thing.id} />}
            {data.can_edit && (
              <Link to={`/dingen/${thing.id}/bewerken`} className="btn btn-outline btn-sm">
                Bewerken
              </Link>
            )}
          </>
        }
      />
      <div className="split">
        <aside className="split-aside">
          <section className="card">
            <ItemPhoto item={thing} canEdit={data.can_edit} onChange={(v, message) => (mutate({ ...data, thing: { ...thing, photo_version: v } }), toast(message))} />
            <dl className="dl">
              {data.stock && (
                <div>
                  <dt>Voorraad</dt>
                  <dd className={data.stock.low ? "is-low" : undefined}>{formatAmount(data.stock.amount, data.stock.unit)}</dd>
                </div>
              )}
              {data.stock?.expires && (
                <div>
                  <dt>Vervalt eerst</dt>
                  <dd>{dayLabel(data.stock.expires)}</dd>
                </div>
              )}
              <AttributeRows defs={other} data={thing.data} names={names} refs={data.refs} />
              {data.mirror && (
                <div>
                  <dt>Uit</dt>
                  <dd>
                    {data.mirror.of ? (
                      <Link to={`/dingen/${data.mirror.of.id}`} className="link-quiet">
                        {data.mirror.source ? `${data.mirror.of.name} in ${data.mirror.source.name}` : data.mirror.of.name}
                      </Link>
                    ) : (
                      (data.mirror.source?.name ?? "Een andere lijst")
                    )}
                  </dd>
                </div>
              )}
              {data.part_of && (
                <div>
                  <dt>Deel van</dt>
                  <dd>
                    <Link to={`/dingen/${data.part_of.id}`} className="link-quiet">
                      {data.part_of.name}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </section>
          {notes.map((f) => (
            <section key={f.key} className="card">
              <CardHead title={f.label} />
              <p className="tips-block">{formatFieldValue(f, thing.data[f.key], names)}</p>
            </section>
          ))}
        </aside>
        <div className="split-main">
          <section className="card">
            <CardHead title="Tijdlijn" />
            {data.timeline.length === 0 ? (
              <p className="card-body muted">Nog niets mee gebeurd</p>
            ) : (
              <ul className="rows stagger">
                {data.timeline.map((e, i) => (
                  <li key={`${e.event_id}-${i}`} style={stagger(i)}>
                    <Link to={`/gebeurtenissen/${e.event_id}`} className="row">
                      <span className="cell-main">
                        <span className={`row-media tone-${BASE_TONES[e.base]}`}>
                          <Icon name={BASES[e.base].icon as IconName} size={17} />
                        </span>
                        <span className="row-main">
                          <span className="row-title">{e.name || e.kind_name}</span>
                          <span className="row-meta">
                            <span>
                              {[
                                dayLabel(e.at.slice(0, 10)),
                                e.store,
                                e.amount !== null ? `${ROLE_WORD[e.role]} ${formatAmount(e.amount, e.unit ?? data.stock?.unit ?? null)}` : null,
                                e.unit_price !== null && data.stock?.unit ? `${formatCents(e.unit_price)} per ${data.stock.unit}` : null,
                                e.status !== "gebeurd" ? (e.status === "gepland" ? "gepland" : "afgevinkt") : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                        </span>
                      </span>
                      <span className="row-end">{e.price !== null ? formatCents(e.price) : ""}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {data.parts.length > 0 && (
            <section className="card">
              <CardHead title="Delen" />
              <ul className="rows">
                {data.parts.map((p) => (
                  <li key={p.id}>
                    <Link to={`/dingen/${p.id}`} className="row">
                      <span className="cell-main">
                        <span className="row-title">{p.name}</span>
                      </span>
                      <Icon name="next" size={16} className="row-chevron" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.backlinks.length > 0 && (
            <section className="card">
              <CardHead title="Verwijst hiernaar" />
              <ul className="rows">
                {data.backlinks.map((b) => (
                  <li key={b.id}>
                    <Link to={`/dingen/${b.id}`} className="row">
                      <span className="cell-main">
                        <span className="row-main">
                          <span className="row-title">{b.name}</span>
                          <span className="row-meta">
                            <span>
                              {b.list} · {b.field_label}
                            </span>
                          </span>
                        </span>
                      </span>
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
          {data.can_edit && !data.mirror && (
            <div className="btn-row" style={{ justifySelf: "start" }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={archive}>
                <Icon name="archive" size={15} /> {thing.archived ? "Uit het archief" : "Archiveren"}
              </button>
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
