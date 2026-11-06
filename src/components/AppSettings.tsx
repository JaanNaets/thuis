// De app instellen (Jouw gegevens → App, zie shared/apps.ts): waar ze opent op dit toestel, je eigen apps (elk een
// icoon op je beginscherm met een eigen naam en bestemming), de snelkoppelingen op het icoon en wat er met een gedeelde
// foto gebeurt (Android). Een bestemming is een overzicht, de agenda, een weergave (Geld, Voorraad, …), een lijst, of
// een formulier: loggen (eventueel met een soort en tekst) of een ding toevoegen. Zie STIJLBOEK.md → Jouw gegevens.

import { useMemo, useState } from "react";
import { appPath, DESTINATION_KINDS, destinationLabel, MAX_SHORTCUTS, VIEWS, type AppDef, type AppSettings, type Destination, type DestinationKind, type Reach, type Shortcut, type ViewKey } from "../../shared/apps";
import type { Targets } from "../../shared/targets";
import { api, useApi } from "../api";
import { useSession } from "../session";
import type { Overview } from "./Board";
import { setStartDestination, startDestination } from "../start";
import { useConfirm } from "./ConfirmDialog";
import { CardHead, Segmented } from "./Controls";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

/** Wat je kan kiezen: je overzichten en de lijsten waarin je iets mag toevoegen, met hun soorten. */
type Choices = { boards: { id: string; name: string }[]; lists: { id: string; name: string; one: string | null; stock: boolean; kinds: { id: string; name: string }[] }[]; reach: Reach };

function useChoices(): Choices | null {
  const { data: targets } = useApi<Targets>("/me/targets");
  const { data: overview } = useApi<Overview>("/me/overview");
  return useMemo(() => {
    if (!targets || !overview) return null;
    const lists = targets.lists.map((l) => ({
      ...l,
      kinds: targets.kinds.filter((k) => k.list_id === l.id || k.list_id === null).map((k) => ({ id: k.id, name: k.name })),
    }));
    const reach: Reach = {
      boards: overview.boards,
      lists: new Map(lists.map((l) => [l.id, { name: l.name, one: l.one, edit: true, kinds: new Map(l.kinds.map((k) => [k.id, k.name])) }])),
    };
    return { boards: overview.boards, lists, reach };
  }, [targets, overview]);
}

/** Een korte naam voor een snelkoppeling ("Bijvulling", "Keuken", "Agenda"). */
function shortName(d: Destination, reach: Reach): string {
  if (d.kind === "form") {
    const l = reach.lists.get(d.list);
    return (d.thing ? l?.one : d.type ? l?.kinds.get(d.type) : l?.name) ?? "Toevoegen";
  }
  return destinationLabel(d, reach);
}

/** Een bestemming kiezen: wat (overzicht, agenda, project, lijst, formulier), welk, en bij een formulier eventueel tekst. */
export function DestinationPicker({
  value,
  onChange,
  choices,
  none,
  label = "Naar",
}: {
  value: Destination | null;
  onChange: (d: Destination | null) => void;
  choices: Choices;
  /** Het label van de eerste keuze ("Naar", of "Openen op"). */
  label?: string;
  /** Een keuze "niets" bovenaan (bv. "Het overzicht" bij Openen op). */
  none?: string;
}) {
  const kind = value?.kind ?? "";
  const pick = (k: string) => {
    if (!k) return onChange(null);
    const first = choices.lists[0];
    const next: Destination | null =
      k === "board"
        ? choices.boards[0] && { kind: "board", board: choices.boards[0].id }
        : k === "agenda"
          ? { kind: "agenda" }
          : k === "view"
            ? { kind: "view", view: "geld" }
            : first && { kind: k as "list" | "form", list: first.id };
    onChange(next ?? null);
  };
  const list = value && "list" in value ? choices.lists.find((l) => l.id === value.list) : undefined;
  // Wat het formulier doet: loggen (met een soort) of een ding toevoegen.
  const action = value?.kind === "form" ? (value.thing ? "ding" : (value.type ?? "")) : "";
  return (
    <div className="field-row">
      <label className="field">
        <span className="label">{label}</span>
        <select value={kind} onChange={(e) => pick(e.target.value)}>
          {none !== undefined && <option value="">{none}</option>}
          {(Object.entries(DESTINATION_KINDS) as [DestinationKind, string][]).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {value?.kind === "board" && (
        <label className="field">
          <span className="label">Overzicht</span>
          <select value={value.board} onChange={(e) => onChange({ kind: "board", board: e.target.value })}>
            {choices.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {value?.kind === "view" && (
        <label className="field">
          <span className="label">Weergave</span>
          <select value={value.view} onChange={(e) => onChange({ kind: "view", view: e.target.value as ViewKey })}>
            {(Object.entries(VIEWS) as [ViewKey, { label: string }][]).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {(value?.kind === "list" || value?.kind === "form") && (
        <label className="field">
          <span className="label">Lijst</span>
          <select value={value.list} onChange={(e) => onChange(value.kind === "form" ? { kind: "form", list: e.target.value, ...(value.text ? { text: value.text } : {}) } : { kind: "list", list: e.target.value })}>
            {choices.lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {value?.kind === "form" && list && (
        <label className="field">
          <span className="label">Wat</span>
          <select
            value={action}
            onChange={(e) => {
              const v = e.target.value;
              const { thing: _t, type: _k, ...rest } = value;
              onChange(v === "ding" ? { ...rest, thing: true } : v ? { ...rest, type: v } : rest);
            }}
          >
            <option value="">Loggen</option>
            {list.kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
            {list.one && <option value="ding">{list.one} toevoegen</option>}
          </select>
        </label>
      )}
      {value?.kind === "form" && (
        <label className="field">
          <span className="label">Met tekst</span>
          <input value={value.text ?? ""} maxLength={120} placeholder="bv. pellets" onChange={(e) => onChange({ ...value, text: e.target.value || undefined })} />
        </label>
      )}
    </div>
  );
}

export function AppCard() {
  const { ai } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const choices = useChoices();
  const { data: settings, mutate } = useApi<AppSettings>("/me/app");
  const [start, setStart] = useState(startDestination);
  const [editing, setEditing] = useState<{ id?: string; name: string; to: Destination | null } | null>(null);
  const [shortcuts, setShortcuts] = useState<Shortcut[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: AppSettings, message: string) {
    setBusy(true);
    try {
      const saved = await api.put<AppSettings>("/me/app", { settings: next });
      mutate(saved);
      toast(message);
      return saved;
    } catch (err) {
      toast((err as Error).message, "alert");
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!choices || !settings) return null;
  const reach = choices.reach;
  const ownShortcuts = shortcuts ?? settings.shortcuts;

  async function saveApp() {
    if (!editing?.to || !editing.name.trim() || !settings) return;
    const app = { ...(editing.id ? { id: editing.id } : {}), name: editing.name.trim(), to: editing.to } as AppDef;
    const apps = editing.id ? settings.apps.map((a) => (a.id === editing.id ? app : a)) : [...settings.apps, app];
    if (await save({ ...settings, apps }, editing.id ? "App bewaard" : `${app.name} gemaakt`)) setEditing(null);
  }

  async function removeApp(app: AppDef) {
    if (!settings || !(await confirm({ title: `${app.name} verwijderen?`, confirmLabel: "Verwijderen", danger: true }))) return;
    if (await save({ ...settings, apps: settings.apps.filter((a) => a.id !== app.id) }, `${app.name} verwijderd`)) setEditing(null);
  }

  // Een kasticket: een aankoop in een lijst die voorraad telt.
  const stocks = choices.lists.filter((l) => l.stock);
  const shareKey = settings.share.kind === "receipt" ? settings.share.list : "";

  return (
    <section className="card">
      <CardHead title="App" />
      <div className="card-body form">
        <DestinationPicker
          value={start}
          label="Openen op"
          none="Het overzicht"
          choices={choices}
          onChange={(d) => {
            setStart(d);
            setStartDestination(d);
            toast("Bewaard op dit toestel");
          }}
        />

        <div className="field">
          <span className="label">Apps</span>
          {settings.apps.length > 0 && (
            <ul className="rows app-rows">
              {settings.apps.map((a) => (
                <li key={a.id} className="row">
                  <button type="button" className="cell-main row-button" onClick={() => setEditing({ id: a.id, name: a.name, to: a.to })}>
                    <span className="row-media">
                      <Icon name="home" size={16} />
                    </span>
                    <span className="row-main">
                      <span className="row-title">{a.name}</span>
                      <span className="row-meta">
                        <span>{destinationLabel(a.to, reach)}</span>
                      </span>
                    </span>
                  </button>
                  <a href={`${window.location.origin}${appPath(a.id)}`} target="_blank" rel="noopener" className="btn btn-ghost btn-sm">
                    Op je beginscherm
                  </a>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn btn-outline btn-sm" style={{ justifySelf: "start" }} onClick={() => setEditing({ name: "", to: { kind: "agenda" } })}>
            <Icon name="plus" size={15} /> Nieuwe app
          </button>
        </div>

        <div className="field">
          <span className="label">Snelkoppelingen (Android)</span>
          <Segmented
            label="Snelkoppelingen"
            value={ownShortcuts ? "own" : "auto"}
            options={[
              { value: "auto", label: "Vanzelf" },
              { value: "own", label: "Zelf kiezen" },
            ]}
            onChange={(v) => {
              if (v === "auto") {
                setShortcuts(null);
                save({ ...settings, shortcuts: null }, "Snelkoppelingen: vanzelf");
              } else setShortcuts(settings.shortcuts ?? [{ name: "Agenda", to: { kind: "agenda" } }]);
            }}
          />
          {ownShortcuts && (
            <>
              {ownShortcuts.map((s, i) => (
                <div key={i} className="shortcut-row">
                  <DestinationPicker
                    value={s.to}
                    choices={choices}
                    onChange={(to) => to && setShortcuts(ownShortcuts.map((x, k) => (k === i ? { name: shortName(to, reach), to } : x)))}
                  />
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${s.name} weghalen`} onClick={() => setShortcuts(ownShortcuts.filter((_, k) => k !== i))}>
                    <Icon name="close" size={15} />
                  </button>
                </div>
              ))}
              <div className="btn-row">
                {ownShortcuts.length < MAX_SHORTCUTS && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setShortcuts([...ownShortcuts, { name: "Agenda", to: { kind: "agenda" } }])}>
                    <Icon name="plus" size={15} /> Snelkoppeling
                  </button>
                )}
                {shortcuts && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    onClick={async () => {
                      if (await save({ ...settings, shortcuts }, "Snelkoppelingen bewaard")) setShortcuts(null);
                    }}
                  >
                    Bewaren
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Een kasticket leest de AI: deze keuze enkel als ze voor jou aan staat. */}
        {ai && stocks.length > 0 && (
          <label className="field">
            <span className="label">Gedeelde foto (Android)</span>
            <select
              value={shareKey}
              onChange={(e) => save({ ...settings, share: e.target.value ? { kind: "receipt", list: e.target.value } : { kind: "ask" } }, "Bewaard")}
            >
              <option value="">Telkens vragen</option>
              {stocks.map((l) => (
                <option key={l.id} value={l.id}>
                  Kasticket lezen · {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <Sheet open={editing !== null} title={editing?.id ? "App" : "Nieuwe app"} onClose={() => setEditing(null)}>
        {editing && (
          <div
            className="form"
            onKeyDown={(e) => {
              // Geen formulier in het formulier van Jouw gegevens: Enter bewaart de app.
              if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
                e.preventDefault();
                saveApp();
              }
            }}
          >
            <label className="field">
              <span className="label">Naam</span>
              <input autoFocus maxLength={30} value={editing.name} placeholder="bv. Pellets" onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </label>
            <DestinationPicker value={editing.to} choices={choices} onChange={(to) => setEditing({ ...editing, to })} />
            <button type="button" className="btn btn-primary" disabled={busy || !editing.name.trim() || !editing.to} onClick={saveApp}>
              {editing.id ? "Bewaren" : "Maken"}
            </button>
            {editing.id && (
              <button
                type="button"
                className="btn btn-danger-ghost"
                onClick={() => {
                  const app = settings.apps.find((a) => a.id === editing.id);
                  if (app) removeApp(app);
                }}
              >
                Verwijderen
              </button>
            )}
          </div>
        )}
      </Sheet>
    </section>
  );
}

