// Offline toevoegen: een nieuw item dat je zonder internet bewaart, wacht op dit toestel (IndexedDB) en gaat mee zodra
// er weer internet is. Enkel nieuwe items (met hun foto); wijzigen en verwijderen vragen internet. De server kijkt
// alles na zoals altijd: mag het niet (meer), dan valt het weg en zegt de app dat.

import { useEffect, useState } from "react";
import type { ItemDetail, ItemInput } from "../shared/types";
import { api, ApiError } from "./api";
import { useToast } from "./components/Toast";
import { REFRESH_EVENT } from "./device";

export type Waiting = { id: string; project_id: string; input: ItemInput; photo?: Blob; created_at: string };

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

export async function enqueue(projectId: string, input: ItemInput, photo?: Blob | null): Promise<void> {
  const entry: Waiting = { id: crypto.randomUUID(), project_id: projectId, input, ...(photo ? { photo } : {}), created_at: new Date().toISOString() };
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
        const saved = await api.post<ItemDetail>(`/projects/${entry.project_id}/items`, entry.input);
        if (entry.photo) {
          const body = new FormData();
          body.set("file", entry.photo);
          await api.put(`/items/${saved.id}/photo`, body).catch(() => {});
        }
        sent++;
      } catch (err) {
        if (!(err instanceof ApiError) || err.status === 0) break;
        // De server zegt nee (bv. je mag daar niets meer toevoegen): niet blijven proberen.
        refused.push(`${entry.input.name || "Een item"}: ${err.message}`);
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
