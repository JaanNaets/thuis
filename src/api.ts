import { useCallback, useEffect, useState } from "react";
import { REFRESH_EVENT } from "./device";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    if (!navigator.onLine) {
      throw new ApiError(0, "Je bent offline. Dit lukt pas weer met internet.");
    }
    // Als je Access-sessie verlopen is, stuurt Cloudflare een redirect naar de loginpagina
    // en faalt fetch. Herladen toont dan het aanmeldscherm.
    throw new ApiError(0, "Kon de server niet bereiken. Misschien is je sessie verlopen: herlaad de pagina.");
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Fout ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: (path: string) => request<void>("DELETE", path),
};

/**
 * Haalt data op bij het laden van een component, en opnieuw wanneer `path` verandert, je reload() oproept,
 * de app terug zichtbaar wordt of de kiosk ververst.
 */
export function useApi<T>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get<T>(path).then(
      (result) => {
        if (cancelled) return;
        setData(result);
        setError(undefined);
        setLoading(false);
      },
      (err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  /** Lokaal aanpassen zonder opnieuw op te halen (bv. +1 in de voorraadlijst, of het antwoord van een POST). */
  const mutate = setData;

  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(REFRESH_EVENT, reload);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(REFRESH_EVENT, reload);
    };
  }, [reload]);

  return { data, error, loading, reload, mutate };
}
