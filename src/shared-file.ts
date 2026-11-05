// Een foto die je vanuit een andere app deelt met Thuis (Android, share_target): de service worker bewaart ze even in
// een eigen cache (sw/sw.js), de app haalt ze daar op (/delen, Kasticket bijtellen, een foto lezen) en ruimt ze op.

const CACHE = "gedeeld";
const KEY = "/gedeeld/foto";

/** De gedeelde foto, of null als er geen (meer) is. */
export async function sharedFile(): Promise<File | null> {
  try {
    if (!("caches" in window)) return null;
    const res = await (await caches.open(CACHE)).match(KEY);
    if (!res) return null;
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get("x-name") ?? "gedeeld");
    return new File([blob], name, { type: blob.type || res.headers.get("content-type") || "image/jpeg" });
  } catch {
    return null;
  }
}

/** De gedeelde foto weggooien (na gebruik). */
export async function clearShared(): Promise<void> {
  try {
    if ("caches" in window) await (await caches.open(CACHE)).delete(KEY);
  } catch {
    // Niets te doen: dan blijft ze tot de volgende keer iets gedeeld wordt.
  }
}
