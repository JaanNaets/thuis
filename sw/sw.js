// Service worker: laat de app openen zonder internet.
// Bij `vite build` vult vite.config.ts hieronder de versie en de lijst met bestanden in.

const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;

const SHELL_CACHE = `shell-${VERSION}`;
const DATA_CACHE = "data-v1";

// API-routes die offline beschikbaar moeten blijven (jij en je projecten). Al de rest vraagt internet.
const OFFLINE_API = ["/api/me"];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Pagina's: eerst het netwerk (zo werkt de Access-login gewoon), offline de bewaarde app.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match("/", { cacheName: SHELL_CACHE })) ?? Response.error()),
    );
    return;
  }

  // Netwerk met korte time-out, anders de laatst bewaarde versie.
  if (OFFLINE_API.includes(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Gebouwde bestanden hebben een hash in hun naam en veranderen nooit: cache eerst.
  if (url.pathname.startsWith("/assets/") || PRECACHE.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

// Meldingen (web push): de Worker stuurt ze versleuteld; de browser ontsleutelt en geeft ons de tekst.
self.addEventListener("push", (event) => {
  let message = { title: "Thuis", body: "", url: "/" };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    // Geen leesbare inhoud: toon dan gewoon dat er iets is.
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: message.tag,
      data: { url: message.url },
    }),
  );
});

// Een tik op een melding: de app openen op die plaats (een open venster hergebruiken).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/", self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === url.origin);
      if (open) return open.focus().then((w) => w.navigate(url.href));
      return self.clients.openWindow(url.href);
    }),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    // Enkel echte antwoorden bewaren, geen doorverwijzing naar de loginpagina.
    if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
      cache.put(request, response.clone());
      return response;
    }
    return (await cache.match(request)) ?? response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("offline en niets bewaard");
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
