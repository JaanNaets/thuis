// Een maandkalender (de agenda, of een lijst als agenda). Per dag de items, met een kleur per project; op een gsm
// enkel stipjes, en wat op de gekozen dag valt eronder als rijen. Een periode (een reis) staat op elke dag ervan.

import { useMemo, useState } from "react";
import { monthGrid, shiftMonth } from "../../shared/agenda";
import { today as todayIso } from "../format";
import { Link } from "../router";
import { Icon, type IconName } from "./Icon";

export type CalendarEntry = {
  key: string;
  title: string;
  start: string;
  end?: string;
  href: string;
  /** Toon (kleur van het project), zoals bij `tone-…`. */
  tone?: string;
  icon?: IconName;
  /** Kleine tekst onder de titel in de daglijst, bv. "Taken · Tegen". */
  meta?: string;
};

const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const DAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const WEEKDAYS = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
/** Hoeveel items een dag op een groot scherm toont; de rest is "+2". */
const PER_DAY = 3;

export const monthTitle = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const dayTitle = (d: string) => `${WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/** De dagen die een maandkalender toont (om de juiste periode op te halen). */
export const gridRange = (month: string): [string, string] => {
  const days = monthGrid(month);
  return [days[0], days[days.length - 1]];
};

export function CalendarMonth({
  month,
  onMonth,
  entries,
  onAdd,
  addLabel = "Toevoegen",
  empty,
}: {
  month: string;
  onMonth: (month: string) => void;
  entries: CalendarEntry[];
  /** Iets toevoegen op de gekozen dag (bv. een maaltijd op dinsdag). */
  onAdd?: (day: string) => void;
  addLabel?: string;
  /** Uitleg als er de hele maand niets is. */
  empty?: string;
}) {
  const today = todayIso();
  const [picked, setPicked] = useState(() => (today.startsWith(month) ? today : `${month}-01`));
  const days = monthGrid(month);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of entries)
      for (const d of days) if (d >= e.start && d <= (e.end ?? e.start)) map.set(d, [...(map.get(d) ?? []), e]);
    return map;
  }, [entries, days]);
  const go = (by: number) => {
    const next = shiftMonth(month, by);
    onMonth(next);
    setPicked(today.startsWith(next) ? today : `${next}-01`);
  };
  const list = byDay.get(picked) ?? [];

  return (
    <section className="calendar">
      <header className="calendar-head">
        <h2 className="calendar-title">{monthTitle(month)}</h2>
        <div className="btn-row">
          {!today.startsWith(month) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                onMonth(today.slice(0, 7));
                setPicked(today);
              }}
            >
              Vandaag
            </button>
          )}
          <button type="button" className="btn btn-outline btn-icon btn-sm" aria-label="Vorige maand" onClick={() => go(-1)}>
            <Icon name="prev" size={16} />
          </button>
          <button type="button" className="btn btn-outline btn-icon btn-sm" aria-label="Volgende maand" onClick={() => go(1)}>
            <Icon name="next" size={16} />
          </button>
        </div>
      </header>

      <div className="calendar-grid" role="grid" aria-label={monthTitle(month)}>
        {DAYS.map((d) => (
          <span key={d} className="calendar-weekday" aria-hidden="true">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const here = byDay.get(d) ?? [];
          return (
            <div
              key={d}
              role="gridcell"
              className="calendar-day"
              data-out={!d.startsWith(month)}
              data-today={d === today}
              aria-selected={d === picked}
              onClick={() => setPicked(d)}
            >
              <button type="button" className="calendar-date" aria-label={`${dayTitle(d)}${here.length ? `, ${here.length} items` : ""}`} onClick={() => setPicked(d)}>
                {Number(d.slice(8, 10))}
              </button>
              {here.length > 0 && (
                <>
                  <ul className="calendar-entries">
                    {here.slice(0, PER_DAY).map((e) => (
                      <li key={e.key}>
                        <Link to={e.href} className={`calendar-entry tone-${e.tone ?? "sky"}`} onClick={(ev) => ev.stopPropagation()}>
                          {e.title}
                        </Link>
                      </li>
                    ))}
                    {here.length > PER_DAY && <li className="calendar-more">+{here.length - PER_DAY}</li>}
                  </ul>
                  <span className="calendar-dots" aria-hidden="true">
                    {here.slice(0, 4).map((e) => (
                      <i key={e.key} className={`tone-${e.tone ?? "sky"}`} />
                    ))}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="calendar-daylist">
        <div className="calendar-daylist-head">
          <h3>{dayTitle(picked)}</h3>
          {onAdd && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onAdd(picked)}>
              <Icon name="plus" size={15} /> {addLabel}
            </button>
          )}
        </div>
        {list.length ? (
          <ul className="rows">
            {list.map((e) => (
              <li key={e.key}>
                <Link to={e.href} className="row">
                  <span className="cell-main">
                    <span className={`row-media tone-${e.tone ?? "sky"}`}>
                      <Icon name={e.icon ?? "calendar"} size={16} />
                    </span>
                    <span className="row-main">
                      <span className="row-title">{e.title}</span>
                      {e.meta && (
                        <span className="row-meta">
                          <span>{e.meta}</span>
                        </span>
                      )}
                    </span>
                  </span>
                  <Icon name="next" size={16} className="row-chevron" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted calendar-none">{entries.length || !empty ? "Niets op deze dag." : empty}</p>
        )}
      </div>
    </section>
  );
}
