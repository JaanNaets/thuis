// Meldingen op dit toestel (web push): aan of uit, en een testmelding. Wat je krijgt, staat bij de velden zelf
// (Herinneren bij een datum, de app stuurt ze 's morgens, zie worker/cron.ts) en bij een lijst (Melden bij een nieuw
// item). Stil: projecten waarvan je geen melding bij een nieuw item wil (ook niet in hun subprojecten).

import { useEffect, useState } from "react";
import type { AppSettings } from "../../shared/apps";
import { b64url } from "../../shared/webpush";
import { api, useApi } from "../api";
import { projectTree } from "../projects";
import { useSession } from "../session";
import { Icon } from "./Icon";
import { Alert, CardHead, Switch } from "./Controls";
import { useToast } from "./Toast";

type State = "loading" | "unsupported" | "install" | "denied" | "off" | "on";

const isApple = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  )
    return undefined;
  return navigator.serviceWorker.getRegistration();
}

async function currentState(): Promise<State> {
  const reg = await registration();
  // Op een iPhone kan het enkel vanuit de app op je beginscherm.
  if (!reg) return isApple() ? "install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  return (await reg.pushManager.getSubscription()) ? "on" : "off";
}

/** Dit toestel inschrijven (of opnieuw doorgeven, als de server het vergat). */
async function save(sub: PushSubscription) {
  const { endpoint, keys } = sub.toJSON();
  await api.post("/push", { endpoint, keys });
}

export function NotificationsCard() {
  const toast = useToast();
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    currentState().then(async (s) => {
      setState(s);
      // Aan op dit toestel: de server weet het zeker (bv. na een nieuwe aanmelding).
      const sub =
        s === "on"
          ? await (await registration())?.pushManager.getSubscription()
          : null;
      if (sub) save(sub).catch(() => {});
    });
  }, []);

  async function turn(on: boolean) {
    const reg = await registration();
    if (!reg) return;
    setBusy(true);
    try {
      if (on) {
        const permission = await Notification.requestPermission();
        if (permission !== "granted")
          return setState(permission === "denied" ? "denied" : "off");
        const { key } = await api.get<{ key: string }>("/push/key");
        // Een oude inschrijving met een andere sleutel eerst weg.
        await (await reg.pushManager.getSubscription())?.unsubscribe();
        await save(
          await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: b64url.decode(key),
          }),
        );
        setState("on");
      } else {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await api.post("/push/remove", { endpoint: sub.endpoint });
          await sub.unsubscribe();
        }
        setState("off");
      }
    } catch (err) {
      toast(
        (err as Error).message || "Meldingen aanzetten lukte niet",
        "alert",
      );
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const { sent } = await api.post<{ sent: number }>("/push/test", {});
      toast(
        sent
          ? "Testmelding verstuurd"
          : "Geen toestel bereikt; zet meldingen uit en weer aan",
        sent ? undefined : "alert",
      );
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <CardHead title="Meldingen" />
      <div className="card-body form">
        {state === "install" && (
          <Alert tone="none">
            Op een iPhone of iPad: zet Thuis eerst op je beginscherm (Deel → Zet
            op beginscherm) en open het van daar.
          </Alert>
        )}
        {state === "unsupported" && (
          <Alert tone="none">
            Deze browser kan geen meldingen krijgen. Open Thuis in Chrome, Edge,
            Firefox of Safari.
          </Alert>
        )}
        {state === "denied" && (
          <Alert tone="none">
            Meldingen staan uit voor Thuis in de instellingen van je browser.
            Zet ze daar aan en kom terug.
          </Alert>
        )}
        {(state === "on" || state === "off") && (
          <>
            <Switch
              checked={state === "on"}
              onChange={(on) => !busy && turn(on)}
              label="Meldingen op dit toestel"
            />
            {state === "on" && (
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={busy}
                  onClick={test}
                >
                  Testmelding sturen
                </button>
              </div>
            )}
          </>
        )}
        <MutedProjects />
      </div>
    </section>
  );
}

/** Stil: per project geen melding bij een nieuw item (ook niet in de subprojecten). */
function MutedProjects() {
  const { projects } = useSession();
  const toast = useToast();
  const { data: settings, mutate } = useApi<AppSettings>("/me/app");
  if (!settings) return null;
  const muted = settings.muted ?? [];
  const nodes = projectTree(projects).filter((p) => !p.archived);
  async function set(project: string, on: boolean) {
    try {
      const res = await api.put<{ muted: string[] }>("/me/muted", { project, muted: on });
      mutate({ ...settings!, muted: res.muted });
      const name = projects.find((p) => p.id === project)?.name ?? "Project";
      toast(on ? `${name} staat stil` : `${name} meldt weer`);
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  return (
    <div className="field">
      <span className="label">Stil</span>
      {muted.length > 0 && (
        <ul className="rows muted-rows">
          {muted.map((id) => (
            <li key={id} className="row">
              <span className="cell-main">
                <span className="row-title">{projects.find((p) => p.id === id)?.name ?? "Verborgen"}</span>
              </span>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${projects.find((p) => p.id === id)?.name ?? "Project"} weer laten melden`} onClick={() => set(id, false)}>
                <Icon name="close" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <select aria-label="Project stilzetten" value="" onChange={(e) => e.target.value && set(e.target.value, true)}>
        <option value="">Project stilzetten…</option>
        {nodes
          .filter((p) => !muted.includes(p.id))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {"\u00a0\u00a0\u00a0\u00a0".repeat(p.depth) + p.name}
            </option>
          ))}
      </select>
    </div>
  );
}
