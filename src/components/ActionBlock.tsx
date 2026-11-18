// Een actie op het overzicht (zie shared/blocks.ts): een knop die logt. Acties na elkaar staan naast elkaar (twee per
// rij op gsm). Een tik opent het formulier met wat vooraf ingevuld is, bewaart meteen (met Ongedaan maken), telt er
// een bij (met hoeveel vandaag) of start en stopt een activiteit (met hoe lang ze al loopt). Een geplande actie
// (`planned`) opent het formulier met Gepland aan of bewaart meteen gepland: een boodschap, iets te doen.

import { useEffect, useState } from "react";
import { actionForm, actionPlans, type ActionBlock, type ViewBlock, type ViewResponse } from "../../shared/blocks";
import { blockKey } from "../../shared/board";
import { formatDuration, type Attributes } from "../../shared/fields";
import { brusselsNow, minutesBetween, STATUSES, type KindInfo } from "../../shared/model";
import { logPath, type Targets } from "../../shared/targets";
import { api, useApi } from "../api";
import { Link } from "../router";
import { BASE_TONES } from "./Log";
import { Icon, type IconName } from "./Icon";
import { stagger } from "./Motion";
import { useToast } from "./Toast";
import { viewUrl } from "./ViewBlock";

/** Acties na elkaar: een rij knoppen; vanaf drie een breed blok. */
export function ActionGroup({ blocks, index }: { blocks: ActionBlock[]; index: number }) {
  return (
    <div className={`dash-block quick-group${blocks.length > 2 ? " is-wide" : ""}`} style={stagger(index)}>
      <div className="quick-grid">
        {blocks.map((b) => (
          <ActionTile key={blockKey(b)} block={b} />
        ))}
      </div>
    </div>
  );
}

/** Wat een actie bewaart: het formulier, nu, en wat vooraf ingevuld is (de omschrijving apart). */
function eventOf(kind: KindInfo, values: Attributes, running = false, planned = false) {
  const { name, ...data } = values as Attributes & { name?: string };
  const now = brusselsNow();
  const at = running || (kind.parts.duration && !planned) ? now : now.slice(0, 10);
  return { kind: kind.id, name: typeof name === "string" ? name : "", status: planned ? "gepland" : "gebeurd", at, data, lines: [] };
}

/** Vandaag met dit formulier: hoeveel keer (teller), of wat nu loopt (timer). */
function todayView(kind: KindInfo, running: boolean): ViewBlock {
  return {
    kind: "view",
    name: "",
    source: "logboek",
    lists: [],
    where: {
      match: "all",
      conditions: running
        ? [
            { field: "kind", op: "any_of", value: [kind.name] },
            { field: "running", op: "is_true" },
          ]
        : [
            { field: "kind", op: "any_of", value: [kind.name] },
            { field: "status", op: "any_of", value: [STATUSES.gebeurd.label] },
            { field: "at", op: "in", value: { p: "today" } },
          ],
    },
    show: running ? "lijst" : "getal",
    ...(running ? { limit: 1 } : { tally: { agg: "count", step: "day", n: 1 } }),
  };
}

export function ActionTile({ block, preview = false }: { block: ActionBlock; preview?: boolean }) {
  const { data: targets } = useApi<Targets>("/me/targets");
  if (!targets) return <span className="quick-tile is-loading" aria-hidden="true" />;
  const kind = actionForm(block, targets.kinds);
  if (!kind) return null;
  const label = block.name || kind.name;
  const media = (
    <span className={`row-media tone-${BASE_TONES[kind.base]}`}>
      <Icon name={kind.icon as IconName} size={16} />
    </span>
  );
  if (block.does === "form" || (block.does === "timer" && !kind.parts.duration)) {
    const values = Object.keys(block.values).length ? `&vooraf=${encodeURIComponent(JSON.stringify(block.values))}` : "";
    const planned = actionPlans(block, kind);
    const to = `${logPath(kind)}${planned ? "&gepland=1" : ""}${values}`;
    const inner = (
      <>
        {media}
        <span className="quick-tile-name">{label}</span>
        <Icon name="plus" size={16} className="quick-tile-plus" />
      </>
    );
    return preview ? (
      <span className="quick-tile">{inner}</span>
    ) : (
      <Link to={to} className="quick-tile" aria-label={`${label} ${planned ? "plannen" : "loggen"}`}>
        {inner}
      </Link>
    );
  }
  return <LiveTile block={block} kind={kind} label={label} media={media} preview={preview} />;
}

/** Bewaren, tellen of starten en stoppen: meteen, met wat vandaag al is (een teller) of loopt (een timer). */
function LiveTile({ block, kind, label, media, preview }: { block: ActionBlock; kind: KindInfo; label: string; media: React.ReactNode; preview: boolean }) {
  const toast = useToast();
  const timer = block.does === "timer";
  const watch = block.does === "count" || timer;
  const { data: today, reload } = useApi<ViewResponse>(watch ? viewUrl(todayView(kind, timer)) : null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const running = timer ? today?.rows[0] : undefined;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [running]);

  async function run() {
    if (preview || busy) return;
    setBusy(true);
    try {
      if (running) {
        await api.post(`/events/${running.id}/stop`, {});
        toast(`${label} gestopt`);
      } else {
        const planned = actionPlans(block, kind);
        const { id } = await api.post<{ id: string }>(`/forms/${kind.id}/events`, eventOf(kind, block.values, timer, planned));
        toast(timer ? `${label} gestart` : planned ? `${label} gepland` : `${label} bewaard`, "check", {
          label: "Ongedaan maken",
          run: async () => {
            await api.delete(`/events/${id}`);
            reload();
          },
        });
      }
      reload();
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }

  const count = block.does === "count" ? (today?.chart?.total ?? null) : null;
  const end = running ? (
    <span className="quick-tile-time num">{formatDuration(Math.max(0, minutesBetween(running.event!.at, brusselsNow()) ?? 0))}</span>
  ) : count !== null && count > 0 ? (
    <span className="quick-tile-count num">{count}</span>
  ) : (
    <Icon name={timer ? "clock" : block.does === "count" ? "plus" : "check"} size={16} className="quick-tile-plus" />
  );
  return (
    <button
      type="button"
      className={`quick-tile${running ? " is-running" : ""}`}
      aria-label={running ? `${label} stoppen` : timer ? `${label} starten` : actionPlans(block, kind) ? `${label} plannen` : `${label} bewaren`}
      aria-busy={busy}
      onClick={run}
    >
      {media}
      <span className="quick-tile-name">{label}</span>
      {end}
    </button>
  );
}
