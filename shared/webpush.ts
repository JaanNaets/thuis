// Web push zonder bibliotheek: een melding naar een toestel sturen kan met gewone WebCrypto (in de Worker en in de
// tests). Twee stukken:
//
// - Versleutelen (RFC 8291, "aes128gcm"): enkel het toestel kan de melding lezen, niet de pushdienst ertussen
//   (Google, Apple, Mozilla). Met een sleutel voor één keer en de sleutels die het toestel gaf bij het inschrijven.
// - VAPID (RFC 8292): een ondertekend briefje dat zegt dat de melding van deze app komt.

type Bytes = Uint8Array<ArrayBuffer>;

export const b64url = {
  encode(bytes: Bytes): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(text: string): Bytes {
    const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

const enc = new TextEncoder();
const text = (s: string): Bytes => new Uint8Array(enc.encode(s));
const concat = (...parts: Bytes[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** Een publieke sleutel (65 bytes, 0x04 || x || y) als JWK, om met een private `d` samen te zetten. */
export function publicJwk(raw: Bytes): JsonWebKey {
  if (raw.length !== 65 || raw[0] !== 4) throw new Error("Geen geldige publieke sleutel");
  return { kty: "EC", crv: "P-256", x: b64url.encode(raw.slice(1, 33)), y: b64url.encode(raw.slice(33)), ext: true };
}

/** Een sleutelpaar voor ECDH (versleutelen) of ECDSA (VAPID), met de publieke sleutel als 65 bytes. */
export async function generateKeys(name: "ECDH" | "ECDSA") {
  const pair = (await crypto.subtle.generateKey(
    { name, namedCurve: "P-256" },
    true,
    name === "ECDH" ? ["deriveBits"] : ["sign", "verify"],
  )) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  return { pair, raw };
}

/**
 * Een melding versleutelen voor één toestel (`p256dh` en `auth` kreeg het bij het inschrijven). `fixed`: enkel voor
 * de test met de voorbeeldwaarden uit de RFC; gewoon is de sleutel en het zout elke keer nieuw.
 */
export async function encryptPush(
  plaintext: Bytes,
  p256dh: Bytes,
  auth: Bytes,
  fixed?: { keys: { pair: CryptoKeyPair; raw: Bytes }; salt: Bytes },
): Promise<Bytes> {
  const own = fixed?.keys ?? (await generateKeys("ECDH"));
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const device = await crypto.subtle.importKey("raw", p256dh, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // De types van Workers noemen dit `$public`; de runtime (en de standaard) `public`.
  const ecdh = { name: "ECDH", public: device } as unknown as Parameters<SubtleCrypto["deriveBits"]>[0];
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, own.pair.privateKey, 256));

  const ikm = await hkdf(auth, shared, concat(text("WebPush: info\0"), p256dh, own.raw), 32);
  const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);

  // Eén blok: de tekst, dan 0x02 (het laatste blok).
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(plaintext, Uint8Array.of(2))));
  const recordSize = Uint8Array.of(0, 0, 16, 0); // 4096
  return concat(salt, recordSize, Uint8Array.of(own.raw.length), own.raw, sealed);
}

/** Het VAPID-briefje voor een pushdienst (`audience`: bv. https://fcm.googleapis.com), 12 uur geldig. */
export async function vapidAuthorization(audience: string, subject: string, privateKey: CryptoKey, publicRaw: Bytes, now = Date.now()): Promise<string> {
  const part = (o: object) => b64url.encode(text(JSON.stringify(o)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, text(unsigned)));
  return `vapid t=${unsigned}.${b64url.encode(signature)}, k=${b64url.encode(publicRaw)}`;
}

/** Pushdiensten van de browsers; naar een ander adres stuurt de app niets (geen willekeurige URL's vanuit de Worker). */
const PUSH_HOSTS = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Wat het toestel bij het inschrijven gaf: een publieke sleutel van 65 bytes en een geheim van 16. */
export function pushKeys(p256dh: unknown, auth: unknown): { p256dh: string; auth: string } | null {
  if (typeof p256dh !== "string" || typeof auth !== "string" || p256dh.length > 200 || auth.length > 100) return null;
  try {
    const key = b64url.decode(p256dh);
    const secret = b64url.decode(auth);
    return key.length === 65 && key[0] === 4 && secret.length === 16 ? { p256dh, auth } : null;
  } catch {
    return null;
  }
}
