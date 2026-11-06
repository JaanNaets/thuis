// Een weergave op het overzicht (zie shared/blocks.ts): de server rekent ze uit met jouw rechten (GET /insights/view),
// hier wordt ze getoond als lijst, tabel, getal, voortgang, grafiek of kalender. In een lijst vink je iets gepland af
// en stop je een timer, zoals in Te doen en Loopt nu.

import { useEffect, useState, type CSSProperties } from "react";
import { columnsOf, SHOWS, viewName, type ViewBlock, type ViewResponse, type ViewRowOut } from "../../shared/blocks";
import { formatDuration, formatFieldValue, type FieldDef, type Names } from "../../shared/fields";
import { brusselsNow, minutesBetween } from "../../shared/model";
import { NAME } from "../../shared/views";
import { api, useApi } from "../api";
import { useSession } from "../session";
import { Link } from "../router";
import { ChartTable, ChartView, formatChartValue } from "./Chart";
import { CardHead } from "./Controls";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

/** Het adres om een weergave uit te rekenen (zonder breedte: die is enkel voor het bord). */
export function viewUrl(block: ViewBlock): string {
  const { name: _name, ...def } = block as ViewBlock & { wide?: boolean };
  delete (def as { wide?: boolean }).wide;
  return `/insights/view?def=${encodeURIComponent(JSON.stringify(def))}`;
}

/** Namen om waarden te tonen: personen (jij als "Jij") en dingen. */
export function viewNames(data: Pick<ViewResponse, "people" | "items">, me: string): Names {
  const people = new Map(data.people.map((p) => [p.id, p.name]));
  return { person: (id) => (id === me ? "Jij" : (people.get(id) ?? "Iemand")), item: (id) => data.items[id] ?? "Verborgen" };
}

/** Eén weergave als kaart op het bord. */
export function ViewCard({ block }: { block: ViewBlock }) {
  const { lists } = useSession();
  const { data, error, reload } = useApi<ViewResponse>(viewUrl(block));
  const [table, setTable] = useState(false);
  const title = viewName(block, (id) => lists.find((l) => l.id === id)?.name);
  if (error) return null;
  if (!data) return <section className="card dash-card view-card is-loading" aria-label={title} aria-busy="true" />;
  if (data.hidden) return null;
  const chart = data.chart && block.show !== "getal" && block.show !== "voortgang" && block.show !== "kalender";
  // De periode onder de titel, tenzij de naam ze al zegt ("Water vandaag").
  const span = data.chart?.window && block.show !== "lijst" && block.show !== "tabel" ? data.chart.window : undefined;
  return (
    <section className={`card dash-card view-card${data.tone ? ` tone-${data.tone}` : ""}`} aria-label={title}>
      <CardHead
        title={title}
        description={span && !title.toLowerCase().includes(span.toLowerCase()) ? span : undefined}
        action={
          chart ? (
            <button type="button" className="btn btn-ghost btn-icon btn-sm chart-toggle" aria-pressed={table} aria-label={table ? "Als grafiek" : "Als tabel"} title={table ? "Als grafiek" : "Als tabel"} onClick={() => setTable(!table)}>
              <Icon name="table" size={15} />
            </button>
          ) : undefined
        }
      />
      <ViewBody block={block} data={data} table={table} onChanged={reload} />
    </section>
  );
}

/** De inhoud van een weergave, in haar vorm (ook in het voorbeeld van de bouwer). */
export function ViewBody({ block, data, table = false, onChanged, preview = false }: { block: ViewBlock; data: ViewResponse; table?: boolean; onChanged?: () => void; preview?: boolean }) {
  const { person } = useSession();
  const names = viewNames(data, person.id);
  if (SHOWS[block.show].chart) {
    if (!data.chart) return <p className="view-empty">Dit kan niet met deze velden</p>;
    if (block.show === "kalender") return <CalendarView data={data} />;
    if (table) return <ChartTable data={data.chart} />;
    return (
      <div className="card-body">
        <ChartView data={data.chart} area={block.show === "gebied"} />
      </div>
    );
  }
  const columns = columnsOf(block, data.fields);
  if (!data.rows.length) return <p className="view-empty">Niets</p>;
  const more = data.total - data.rows.length;
  if (block.show === "tabel") return <ViewTable rows={data.rows} columns={columns} names={names} more={more} preview={preview} />;
  return (
    <>
      <ul className="rows view-rows">
        {data.rows.map((r) => (
          <ViewListRow key={r.id} row={r} columns={columns} names={names} onChanged={onChanged} preview={preview} />
        ))}
      </ul>
      {more > 0 && <p className="view-more">+{more}</p>}
    </>
  );
}

const cell = (row: ViewRowOut, def: FieldDef, names: Names) => (def.key === NAME ? row.name : formatFieldValue(def, row.data[def.key], names));

/** Hoe lang iets al loopt (een timer), elke halve minuut bij. */
function Running({ at }: { at: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const minutes = Math.max(0, minutesBetween(at, brusselsNow()) ?? 0);
  return <span className="view-running num">{formatDuration(minutes)}</span>;
}

/** Een rij in een lijst: de naam, de kolommen in grijs, de laatste kolom rechts; gepland: afvinken; een timer: stoppen. In het
 * voorbeeld van de bouwer doet een rij niets. */
function ViewListRow({ row, columns, names, onChanged, preview }: { row: ViewRowOut; columns: FieldDef[]; names: Names; onChanged?: () => void; preview: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [right, ...rest] = [...columns].reverse();
  const meta = rest
    .reverse()
    .map((c) => cell(row, c, names))
    .filter(Boolean);
  const end = right ? cell(row, right, names) : "";
  async function act(path: string, done: string) {
    setBusy(true);
    try {
      await api.post(path, {});
      toast(done);
      onChanged?.();
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }
  const planned = row.event && row.event.status !== "gebeurd";
  const body = (
    <span className="cell-main">
      <span className="row-main">
        <span className={`row-title${row.tone ? ` tone-text-${row.tone}` : ""}`}>{row.name}</span>
        {meta.length > 0 && (
          <span className="row-meta">
            <span>{meta.join(" · ")}</span>
          </span>
        )}
      </span>
    </span>
  );
  return (
    <li className={row.tone ? `view-row tone-row-${row.tone}` : "view-row"}>
      <div className="row">
        {planned && (
          <input
            type="checkbox"
            className="view-check"
            checked={row.event!.status === "afgevinkt"}
            disabled={busy || preview}
            aria-label={`${row.name} afvinken`}
            onChange={() => act(`/events/${row.id}/tick`, `${row.name} afgevinkt`)}
          />
        )}
        {row.link && !preview ? (
          <Link to={row.link} className="row-link">
            {body}
          </Link>
        ) : (
          body
        )}
        {row.event?.running ? (
          <>
            <Running at={row.event.at} />
            <button type="button" className="btn btn-outline btn-sm" disabled={busy || preview} onClick={() => act(`/events/${row.id}/stop`, `${row.name} gestopt`)}>
              Stop
            </button>
          </>
        ) : (
          end && <span className={`row-end${row.tone ? ` tone-text-${row.tone}` : ""}`}>{end}</span>
        )}
      </div>
    </li>
  );
}

function ViewTable({ rows, columns, names, more, preview }: { rows: ViewRowOut[]; columns: FieldDef[]; names: Names; more: number; preview: boolean }) {
  const all = [{ key: NAME, label: "Naam", type: "text" } as FieldDef, ...columns.filter((c) => c.key !== NAME)];
  const numeric = (c: FieldDef) => ["money", "number", "duration", "score", "year"].includes(c.type);
  return (
    <div className="view-table-wrap">
      <table className="view-table">
        <thead>
          <tr>
            {all.map((c) => (
              <th key={c.key} scope="col" className={numeric(c) ? "is-num" : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.tone ? `tone-row-${r.tone}` : undefined}>
              {all.map((c, k) => (
                <td key={c.key} className={numeric(c) ? "is-num" : undefined}>
                  {k === 0 && r.link && !preview ? <Link to={r.link}>{cell(r, c, names)}</Link> : cell(r, c, names)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 && <p className="view-more">+{more}</p>}
    </div>
  );
}

const WEEKDAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];

/** Een kalender: per dag een vakje, hoe donkerder hoe meer (één kleur, van licht naar donker). */
function CalendarView({ data }: { data: ViewResponse }) {
  const chart = data.chart!;
  const values = chart.series[0]?.values ?? [];
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  // Vooraan aanvullen tot maandag, zodat de kolommen de weekdagen zijn.
  const first = chart.buckets[0]?.key;
  const pad = first ? (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const level = (v: number | null) => (!v || !max ? 0 : Math.max(1, Math.ceil((v / max) * 4)));
  return (
    <div className="card-body view-calendar">
      <div className="view-calendar-grid" role="img" aria-label={`Per dag, ${chart.window}`}>
        {WEEKDAYS.map((d) => (
          <span key={d} className="view-calendar-day" aria-hidden="true">
            {d}
          </span>
        ))}
        {Array.from({ length: pad }, (_, i) => (
          <span key={`p${i}`} />
        ))}
        {chart.buckets.map((b, i) => (
          <span key={b.key} className="view-calendar-cell" data-level={level(values[i])} title={`${b.long}: ${formatChartValue(chart.unit, values[i] ?? 0)}`} style={{ "--i": i } as CSSProperties} />
        ))}
      </div>
      <p className="view-calendar-scale" aria-hidden="true">
        minder
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className="view-calendar-cell" data-level={l} />
        ))}
        meer
      </p>
    </div>
  );
}
