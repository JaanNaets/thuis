// Het logboek: gebeurtenissen als rijen, per dag, met het formulier als tegel, de titel (de naam, of het formulier met
// het eerste item), wat erbij hoort (de lijsten die het raakte, waar, wie) en rechts het bedrag. Geplande gebeurtenissen
// krijgen een vinkje. Een gebeurtenis die je enkel via een item ziet (`partial`), toont geen naam of bedrag. Zie
// STIJLBOEK.md → Logboek.

import { useMemo, useState, type CSSProperties } from "react";
import { stockOp } from "../../shared/cells";
import { baseKind, BASES, dayOf, eventTitle, minutesBetween, timeOf, type EventView, type KindInfo, type ItemRef } from "../../shared/model";
import { formatDuration, formatFieldValue } from "../../shared/fields";
import { formatAmount } from "../../shared/units";
import type { Person, Tone } from "../../shared/types";
import { api, useApi } from "../api";
import { formatCents, formatDate, today } from "../format";
import { Link } from "../router";
import { Icon, type IconName } from "./Icon";
import { SkeletonRows, stagger } from "./Motion";
import { EmptyState } from "./Page";
import { useToast } from "./Toast";

/** Wat het logboek terugkrijgt van de API (een bladzijde gebeurtenissen met de namen erbij). */
export type EventPage = { events: EventView[]; items: ItemRef[]; people: Person[]; kinds: KindInfo[]; lists: { id: string; name: string }[]; more?: boolean };

/** De tint van een basissoort (enkel voor de tegel, zoals een lijst haar toon heeft). */
export const BASE_TONES: Record<keyof typeof BASES, Tone> = {
  aankoop: "peach",
  gebruik: "sage",
  dienst: "sky",
  activiteit: "lilac",
  meting: "butter",
  overdracht: "mint",
};

/** Namen bij ids uit een bladzijde. */
export function usePageNames(page: EventPage | undefined) {
  return useMemo(() => {
    const items = new Map((page?.items ?? []).map((t) => [t.id, t]));
    const kinds = new Map((page?.kinds ?? []).map((k) => [k.id, k]));
    const people = new Map((page?.people ?? []).map((p) => [p.id, p]));
    const lists = new Map((page?.lists ?? []).map((l) => [l.id, l.name]));
    return {
      item: (id: string) => items.get(id),
      kind: (e: Pick<EventView, "kind" | "base">): KindInfo => kinds.get(e.kind) ?? baseKind(e.base),
      person: (id: string | null) => (id ? (people.get(id)?.name ?? "Onbekend") : ""),
      list: (id: string) => lists.get(id) ?? "",
      title: (e: EventView) => eventTitle(e, kinds.get(e.kind) ?? { name: BASES[e.base].label }, (id) => items.get(id)?.name),
    };
  }, [page]);
}

/** "Vandaag", "Gisteren", "4 nov 2026". */
export function dayLabel(day: string): string {
  const t = today();
  if (day === t) return "Vandaag";
  const y = new Date(`${t}T00:00:00`);
  y.setDate(y.getDate() - 1);
  const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  if (day === yesterday) return "Gisteren";
  return formatDate(day);
}

/** Wat onder de titel staat: het uur, de duur, de lijsten die het raakte (behalve die je bekijkt), waar, wie. */
function metaOf(e: EventView, names: ReturnType<typeof usePageNames>, home: string | null): string {
  const parts: string[] = [];
  const time = timeOf(e.at);
  if (time) parts.push(e.end_at ? `${time}–${timeOf(e.end_at) ?? ""}` : time);
  if (names.kind(e).parts.duration && e.end_at) {
    const m = minutesBetween(e.at, e.end_at);
    if (m !== null && m > 0) parts.push(formatDuration(m));
  }
  const lists = e.lists.filter((l) => l !== home).map(names.list).filter(Boolean);
  if (lists.length) parts.push(lists.join(", "));
  const store = e.lines.find((l) => l.role === "bij");
  if (store) parts.push(store.item_id ? (names.item(store.item_id)?.name ?? "") : (store.text ?? ""));
  if (e.paid_by) parts.push(names.person(e.paid_by));
  return parts.filter(Boolean).join(" · ");
}

/** Wat rechts staat: het bedrag, anders bij één lijn de hoeveelheid. */
function endOf(e: EventView, names: ReturnType<typeof usePageNames>): string {
  if (e.amount !== null) return formatCents(e.amount);
  // Een meting of iets met een eigen getal (Gewicht 82,4 kg, Broodje 450 kcal): dat getal.
  const own = names.kind(e).fields.find((f) => (f.type === "number" || f.type === "money") && typeof e.data[f.key] === "number");
  if (own) {
    const v = formatFieldValue(own, e.data[own.key]);
    return own.unit && !v.endsWith(own.unit) ? `${v} ${own.unit}` : v;
  }
  const main = e.lines.filter((l) => l.role !== "bij");
  if (main.length === 1 && main[0].amount !== null) {
    const unit = main[0].unit ?? (main[0].item_id ? names.item(main[0].item_id)?.unit : null) ?? null;
    const op = stockOp(names.kind(e).does, main[0].role);
    return `${op === "af" ? "−" : op === "bij" ? "+" : ""}${formatAmount(main[0].amount, unit)}`;
  }
  return main.length > 1 ? `${main.length} lijnen` : "";
}

/**
 * Gebeurtenissen per dag. `home`: de lijst die je bekijkt (dan staan enkel de andere lijsten erbij).
 * `onTick`: een vinkje bij wat gepland staat. `only`: enkel de lijnen over dit item tonen (de tijdlijn van een item).
 */
export function LogList({
  page,
  home = null,
  onTick,
  grouped = true,
}: {
  page: EventPage;
  home?: string | null;
  onTick?: (e: EventView) => void;
  grouped?: boolean;
}) {
  const names = usePageNames(page);
  const days: { day: string; events: EventView[] }[] = [];
  for (const e of page.events) {
    const day = dayOf(e.at);
    const last = days[days.length - 1];
    if (grouped && last?.day === day) last.events.push(e);
    else days.push({ day, events: [e] });
  }
  let index = 0;
  return (
    <div className="card">
      <ul className="rows stagger">
        {days.flatMap((d) => [
          ...(grouped
            ? [
                <li key={`dag-${d.day}`} className="group-row">
                  {dayLabel(d.day)}
                </li>,
              ]
            : []),
          ...d.events.map((e) => (
            <li key={e.id} style={stagger(index++)}>
              <EventRow e={e} names={names} home={home} onTick={onTick} withDay={!grouped} />
            </li>
          )),
        ])}
      </ul>
    </div>
  );
}

export function EventRow({
  e,
  names,
  home,
  onTick,
  withDay,
}: {
  e: EventView;
  names: ReturnType<typeof usePageNames>;
  home: string | null;
  onTick?: (e: EventView) => void;
  withDay?: boolean;
}) {
  const kind = names.kind(e);
  const meta = [withDay ? dayLabel(dayOf(e.at)) : "", metaOf(e, names, home)].filter(Boolean).join(" · ");
  const planned = e.status === "gepland";
  const done = e.status === "afgevinkt";
  return (
    <div className={`row log-row${done ? " is-done" : ""}`}>
      {onTick && (planned || done) && !e.partial && (
        <label className="row-check">
          <input type="checkbox" checked={done} aria-label={`${names.title(e)}: ${done ? "terug open" : "afvinken"}`} onChange={() => onTick(e)} />
        </label>
      )}
      <Link to={`/gebeurtenissen/${e.id}`} className="row-link">
        <span className="cell-main">
          <span className={`row-media tone-${BASE_TONES[e.base]}`}>
            <Icon name={(kind.icon ?? BASES[e.base].icon) as IconName} size={17} />
          </span>
          <span className="row-main">
            <span className="row-title">{e.partial ? kind.name : names.title(e)}</span>
            {meta && (
              <span className="row-meta">
                <span>{meta}</span>
              </span>
            )}
          </span>
        </span>
        <span className="row-end">{e.partial ? "" : endOf(e, names)}</span>
      </Link>
    </div>
  );
}

/**
 * Een logboek (of wat gepland staat) van een lijst of een formulier (`path`: zijn GET …/events), met Meer laden en
 * afvinken. `home`: de lijst die je bekijkt.
 */
export function EventLog({ path, home = null, planned, edit, onChanged, empty }: { path: string; home?: string | null; planned: boolean; edit: boolean; onChanged?: () => void; empty: string }) {
  const toast = useToast();
  const [before, setBefore] = useState<string | null>(null);
  const [older, setOlder] = useState<EventPage[]>([]);
  const base = `${path}?status=${planned ? "gepland" : "klaar"}&limit=40`;
  const { data, error, reload } = useApi<EventPage>(base);
  const { data: next } = useApi<EventPage>(before ? `${base}&before=${encodeURIComponent(before)}` : null);
  if (next && !older.includes(next)) setOlder((o) => [...o, next]);
  const pages = data ? [data, ...older] : [];
  const page: EventPage | undefined = data && {
    events: pages.flatMap((p) => p.events),
    items: pages.flatMap((p) => p.items),
    people: pages.flatMap((p) => p.people),
    kinds: pages.flatMap((p) => p.kinds),
    lists: pages.flatMap((p) => p.lists),
    more: pages[pages.length - 1].more,
  };
  async function tick(e: EventView) {
    try {
      await api.post(`/events/${e.id}/tick`, e.status === "gepland" ? {} : { undo: true });
      setOlder([]);
      setBefore(null);
      reload();
      onChanged?.();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  if (error) return <p className="error">{error}</p>;
  if (!page) return <SkeletonRows rows={5} />;
  if (!page.events.length) return <EmptyState icon={planned ? "check" : "note"} title={empty} />;
  const last = page.events[page.events.length - 1];
  return (
    <>
      <LogList page={page} home={home} onTick={edit ? tick : undefined} grouped={!planned} />
      {page.more && (
        <button type="button" className="btn btn-ghost" style={{ justifySelf: "center" } as CSSProperties} onClick={() => setBefore(`${last.at}|${last.id}`)}>
          Meer laden
        </button>
      )}
    </>
  );
}
