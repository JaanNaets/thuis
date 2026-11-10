// Het logboek: gebeurtenissen als rijen, per dag, met de soort als tegel, de titel (de naam, of de soort met het
// eerste ding), wat erbij hoort (lijst, waar, wie) en rechts het bedrag. Geplande gebeurtenissen krijgen een vinkje.
// Een gebeurtenis die je enkel via een ding ziet (`partial`), toont geen naam of bedrag. Zie STIJLBOEK.md → Logboek.

import { useMemo } from "react";
import { BASES, dayOf, eventTitle, minutesBetween, timeOf, type EventView, type KindInfo, type ThingRef } from "../../shared/model";
import { formatDuration, formatFieldValue } from "../../shared/fields";
import { formatAmount } from "../../shared/units";
import type { Person, Tone } from "../../shared/types";
import { formatCents, formatDate, today } from "../format";
import { Link } from "../router";
import { Icon, type IconName } from "./Icon";
import { stagger } from "./Motion";

/** Wat het logboek terugkrijgt van de API (een bladzijde gebeurtenissen met de namen erbij). */
export type EventPage = { events: EventView[]; things: ThingRef[]; people: Person[]; kinds: KindInfo[]; lists: { id: string; name: string }[]; more?: boolean };

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
    const things = new Map((page?.things ?? []).map((t) => [t.id, t]));
    const kinds = new Map((page?.kinds ?? []).map((k) => [k.id, k]));
    const people = new Map((page?.people ?? []).map((p) => [p.id, p]));
    const lists = new Map((page?.lists ?? []).map((l) => [l.id, l.name]));
    return {
      thing: (id: string) => things.get(id),
      kind: (e: Pick<EventView, "kind" | "base">) => kinds.get(e.kind) ?? { id: e.base, base: e.base, name: BASES[e.base].label, icon: BASES[e.base].icon, fields: [], list_id: null, goal: null, planned: false },
      person: (id: string | null) => (id ? (people.get(id)?.name ?? "Onbekend") : ""),
      list: (id: string) => lists.get(id) ?? "",
      title: (e: EventView) => eventTitle(e, kinds.get(e.kind) ?? { name: BASES[e.base].label }, (id) => things.get(id)?.name),
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

/** Wat onder de titel staat: het uur, de lijst (als het elders gelogd werd), waar, wie, de duur. */
function metaOf(e: EventView, names: ReturnType<typeof usePageNames>, home: string | null): string {
  const parts: string[] = [];
  const time = timeOf(e.at);
  if (time) parts.push(e.end_at ? `${time}–${timeOf(e.end_at) ?? ""}` : time);
  if (e.base === "activiteit" && e.end_at) {
    const m = minutesBetween(e.at, e.end_at);
    if (m !== null && m > 0) parts.push(formatDuration(m));
  }
  if (e.list_id !== home) parts.push(e.partial ? `${names.kind(e).name} in een andere lijst` : names.list(e.list_id));
  const store = e.lines.find((l) => l.role === "bij");
  if (store) parts.push(store.thing_id ? (names.thing(store.thing_id)?.name ?? "") : (store.text ?? ""));
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
    const unit = main[0].unit ?? (main[0].thing_id ? names.thing(main[0].thing_id)?.unit : null) ?? null;
    return `${main[0].role === "uit" ? "−" : main[0].role === "in" ? "+" : ""}${formatAmount(main[0].amount, unit)}`;
  }
  return main.length > 1 ? `${main.length} lijnen` : "";
}

/**
 * Gebeurtenissen per dag. `home`: de lijst die je bekijkt (dan staat de lijstnaam enkel bij wat elders gelogd werd).
 * `onTick`: een vinkje bij wat gepland staat. `only`: enkel de lijnen over dit ding tonen (de tijdlijn van een ding).
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
