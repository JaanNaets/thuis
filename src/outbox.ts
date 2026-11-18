// Offline loggen: een nieuwe gebeurtenis of een nieuw item dat je zonder internet bewaart, wacht op dit toestel
// (IndexedDB) en gaat mee zodra er weer internet is. Enkel iets nieuws (met de foto); wijzigen en verwijderen vragen
// internet. De server kijkt alles na zoals altijd: mag het niet (meer), dan valt het weg en zegt de app dat.

import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { useToast } from "./components/Toast";
import { REFRESH_EVENT } from "./device";

/**
 * Wat wacht: een gebeurtenis (`event`, met haar formulier in `form`) of een item (`item`, in de lijst `list_id`), met wat
 * het formulier zou sturen.
 */
export type Waiting = { id: string; what: "event" | "item"; list_id?: string; form?: string; label: string; input: unknown; photo?: Blob; created_at: string };

const DB_NAME = "thuis";
const STORE = "outbox";
const CHANGED = "thuis:outbox";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Is een fout "geen internet" (dan wachten), of zegt de server nee (dan niet)? */
export const isOffline = (err: unknown) => err instanceof ApiError && err.status === 0 && !navigator.onLine;

/** `to`: het formulier van een gebeurtenis, of de lijst van een item. */
export async function enqueue(what: Waiting["what"], to: string, label: string, input: unknown, photo?: Blob | null): Promise<void> {
  const entry: Waiting = { id: crypto.randomUUID(), what, ...(what === "event" ? { form: to } : { list_id: to }), label, input, ...(photo ? { photo } : {}), created_at: new Date().toISOString() };
  await run("readwrite", (s) => s.put(entry));
  window.dispatchEvent(new Event(CHANGED));
}

export async function waiting(): Promise<Waiting[]> {
  try {
    const all = await run<Waiting[]>("readonly", (s) => s.getAll());
    return all.sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    return [];
  }
}

let flushing: Promise<{ sent: number; refused: string[] }> | null = null;

/** Alles wat wacht, versturen (in volgorde). Zonder internet stopt het en blijft de rest wachten. */
export function flush(): Promise<{ sent: number; refused: string[] }> {
  flushing ??= (async () => {
    let sent = 0;
    const refused: string[] = [];
    for (const entry of await waiting()) {
      try {
        const path = entry.what === "event" ? "events" : "items";
        // Een gebeurtenis van vroeger wachtte met een lijst (toen een formulier bij een lijst hoorde): die kan niet meer.
        const to = entry.what === "event" ? (entry.form ? `/forms/${entry.form}` : null) : `/lists/${entry.list_id}`;
        if (!to) throw new ApiError(410, "Dit wachtte nog van voor de losse formulieren. Log het opnieuw.");
        const saved = await api.post<{ id: string }>(`${to}/${path}`, entry.input);
        if (entry.photo) {
          const body = new FormData();
          body.set("file", entry.photo);
          await api.put(`/${path}/${saved.id}/photo`, body).catch(() => {});
        }
        sent++;
      } catch (err) {
        if (!(err instanceof ApiError) || err.status === 0) break;
        // De server zegt nee (bv. je mag daar niets meer toevoegen): niet blijven proberen.
        refused.push(`${entry.label}: ${err.message}`);
      }
      await run("readwrite", (s) => s.delete(entry.id));
    }
    window.dispatchEvent(new Event(CHANGED));
    return { sent, refused };
  })().finally(() => (flushing = null));
  return flushing;
}

/** Hoeveel er wacht; verstuurt het zodra er internet is (en bij het openen van de app). */
export function useOutbox(online: boolean): number {
  const toast = useToast();
  const [count, setCount] = useState(0);
  useEffect(() => {
    const update = () => waiting().then((list) => setCount(list.length));
    update();
    window.addEventListener(CHANGED, update);
    return () => window.removeEventListener(CHANGED, update);
  }, []);
  useEffect(() => {
    if (!online || !count) return;
    flush().then(({ sent, refused }) => {
      if (sent) {
        toast(sent === 1 ? "1 item van offline verstuurd" : `${sent} items van offline verstuurd`);
        window.dispatchEvent(new Event(REFRESH_EVENT));
      }
      for (const message of refused) toast(message, "alert");
    });
  }, [online, count, toast]);
  return count;
}
