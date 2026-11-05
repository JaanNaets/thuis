// De timer (veldsoort "timer", zie shared/fields.ts): starten en stoppen met één tik, live meetellen (tot op de
// seconde op het scherm), een doel (16 u) met wat er nog rest, en bij het stoppen de duur in een Duur-veld
// (`timer_into`). In het formulier (`TimerInput`), op de fiche (`TimerCard`) en als blok op je overzicht (`TimerBlock`).

import { useEffect, useState, type CSSProperties } from "react";
import { formatDuration, timerMinutes, type FieldDef, type TimerValue } from "../../shared/fields";
import type { ItemDetail } from "../../shared/types";
import { api, useApi } from "../api";
import { Link } from "../router";
import { CardHead } from "./Controls";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

/** Nu, elke seconde opnieuw (enkel terwijl er iets loopt). */
export function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  return now;
}

/** Een tijdstip zoals de server het bewaart (UTC, tot op de seconde). */
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** Hoe lang het al loopt: 1:23:45 (en dagen ervoor als het zo lang loopt). */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d ? `${d} d ` : ""}${h}:${pad(m)}:${pad(sec)}`;
}

/** Een tijdstip (UTC) voor een `datetime-local` (in de tijd van dit toestel), en terug. */
const toLocal = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocal = (s: string) => (s ? new Date(s).toISOString().replace(/\.\d{3}Z$/, "Z") : "");

/** Het doel: nog zoveel, of bereikt. */
function GoalLine({ value, goal, now }: { value: TimerValue; goal: number; now: number }) {
  const minutes = timerMinutes(value, now);
  const done = minutes >= goal;
  return (
    <div className="timer-goal">
      <div className="chart-meter" role="meter" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={minutes} aria-label={`Doel ${formatDuration(goal)}`}>
        <span style={{ "--w": `${Math.min(100, (minutes / goal) * 100)}%` } as CSSProperties} />
      </div>
      <span>{done ? `Doel ${formatDuration(goal)} bereikt` : `Nog ${formatDuration(goal - minutes)} · doel ${formatDuration(goal)}`}</span>
    </div>
  );
}

/** Een timer live: hoe lang hij loopt (of liep), het doel, en Start of Stop als je mag. */
export function TimerLive({ value, def, onStart, onStop, busy }: { value: TimerValue | null; def: FieldDef; onStart?: () => void; onStop?: () => void; busy?: boolean }) {
  const running = Boolean(value && !value.end);
  const now = useNow(running);
  return (
    <div className="timer">
      <div className="timer-row">
        <span className={`timer-time${running ? " is-running" : ""}`} aria-live="off">
          {value ? (running ? formatElapsed(now - Date.parse(value.start)) : formatDuration(timerMinutes(value))) : "0:00:00"}
        </span>
        {running && onStop && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onStop}>
            <Icon name="minus" size={16} /> Stop
          </button>
        )}
        {!running && onStart && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onStart}>
            <Icon name="clock" size={16} /> Start
          </button>
        )}
      </div>
      {value && def.timer_goal ? <GoalLine value={value} goal={def.timer_goal} now={now} /> : null}
    </div>
  );
}

/** In het formulier: Start en Stop, en het begin en einde om zelf aan te passen. */
export function TimerInput({ def, value, onChange, disabled }: { def: FieldDef; value: TimerValue | null; onChange: (v: TimerValue | null) => void; disabled: boolean }) {
  return (
    <div className="timer-input">
      <TimerLive
        value={value}
        def={def}
        onStart={disabled ? undefined : () => onChange({ start: nowIso() })}
        onStop={disabled || !value ? undefined : () => onChange({ start: value.start, end: nowIso() })}
      />
      {value && (
        <div className="field-row">
          <label className="field">
            <span className="label">Begin</span>
            <input type="datetime-local" disabled={disabled} value={toLocal(value.start)} onChange={(e) => e.target.value && onChange({ ...value, start: fromLocal(e.target.value) })} />
          </label>
          <label className="field">
            <span className="label">Einde</span>
            <input
              type="datetime-local"
              disabled={disabled}
              value={value.end ? toLocal(value.end) : ""}
              onChange={(e) => onChange(e.target.value ? { ...value, end: fromLocal(e.target.value) } : { start: value.start })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

/** Op de fiche: een kaart per timer, met Start en Stop als je dat veld mag wijzigen. */
export function TimerCard({ item, def, canEdit, onChange }: { item: ItemDetail; def: FieldDef; canEdit: boolean; onChange: (item: ItemDetail) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const value = (item.data[def.key] as TimerValue | undefined) ?? null;
  async function act(action: "start" | "stop") {
    setBusy(true);
    try {
      const next = await api.post<ItemDetail>(`/items/${item.id}/timer`, { field: def.key, action });
      onChange(next);
      toast(action === "start" ? `${def.label} loopt` : `${def.label} gestopt`);
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <CardHead title={def.label} />
      <div className="card-body">
        <TimerLive value={value} def={def} busy={busy} onStart={canEdit && !value ? () => act("start") : undefined} onStop={canEdit && value && !value.end ? () => act("stop") : undefined} />
      </div>
    </section>
  );
}

type TimerState = { running: { id: string; name: string; value: TimerValue } | null; last: { id: string; name: string; value: TimerValue } | null; can_create: boolean; can_edit: boolean; def: FieldDef; list: { name: string; plural: string }; many?: boolean };

/**
 * Een timerblok op je overzicht: loopt er een (het nieuwste item met een lopende timer), dan live en Stop; anders
 * Start, wat een nieuw item maakt met de timer al lopend ("Vasten 5/11"). Eronder de vorige keer.
 */
export function TimerBlock({ project, list, field }: { project: string; list: string; field: string }) {
  const toast = useToast();
  const { data, reload, mutate } = useApi<TimerState>(`/projects/${project}/timer?list=${list}&field=${field}`);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const { running, last, def } = data;
  async function start() {
    setBusy(true);
    try {
      const d = new Date();
      const created = await api.post<ItemDetail>(`/projects/${project}/items`, { type_id: list, name: `${data!.list.name} ${d.getDate()}/${d.getMonth() + 1}`, data: { [field]: { start: nowIso() } }, tag_ids: [] });
      mutate({ ...data!, running: { id: created.id, name: created.name, value: created.data[field] as TimerValue } });
      toast(`${def.label} loopt`);
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!running) return;
    setBusy(true);
    try {
      await api.post(`/items/${running.id}/timer`, { field, action: "stop" });
      toast(`${def.label} gestopt`);
      reload();
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card dash-card">
      <CardHead title={running?.name ?? data.list.plural} description={data.many ? def.label : undefined} />
      <div className="card-body">
        <TimerLive value={running?.value ?? null} def={def} busy={busy} onStart={!running && data.can_create ? start : undefined} onStop={running && data.can_edit ? stop : undefined} />
        {!running && last?.value.end && (
          <Link to={`/items/${last.id}`} className="timer-last">
            Vorige keer: {formatDuration(timerMinutes(last.value))} · {last.name}
          </Link>
        )}
      </div>
    </section>
  );
}
