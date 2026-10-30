// Meldingen naar de toestellen van iemand (web push, zie shared/webpush.ts). De sleutels van de app (VAPID) maakt de
// Worker de eerste keer zelf en bewaart ze in `settings`: geen geheim dat iemand moet instellen of doorgeven.

import { b64url, encryptPush, generateKeys, isPushEndpoint, vapidAuthorization } from "../shared/webpush";

type Vapid = { privateKey: CryptoKey; raw: Uint8Array<ArrayBuffer>; subject: string };
type Stored = { private: JsonWebKey; public: string; subject: string };

/** Een melding: de titel, één regel tekst, en waar een tik naartoe gaat. */
export type PushMessage = { title: string; body: string; url: string; tag?: string };

/**
 * De VAPID-sleutels van de app. Bestaan ze nog niet, dan maakt `origin` (het adres van de app, nodig in het briefje
 * aan de pushdienst) ze aan; zonder `origin` is er dan niets (en dus ook nog niemand ingeschreven).
 */
export async function vapid(db: D1Database, origin?: string): Promise<Vapid | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'vapid'").first<{ value: string }>();
  if (!row) {
    if (!origin) return null;
    const keys = await generateKeys("ECDSA");
    const stored: Stored = {
      private: (await crypto.subtle.exportKey("jwk", keys.pair.privateKey)) as JsonWebKey,
      public: b64url.encode(keys.raw),
      subject: origin,
    };
    // Twee tegelijk: de eerste wint, daarna lezen we wat er staat.
    await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid', ?)").bind(JSON.stringify(stored)).run();
    return vapid(db);
  }
  const stored = JSON.parse(row.value) as Stored;
  const privateKey = await crypto.subtle.importKey("jwk", stored.private, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return { privateKey, raw: b64url.decode(stored.public), subject: stored.subject };
}

type Subscription = { id: string; endpoint: string; p256dh: string; auth: string };

async function send(keys: Vapid, sub: Subscription, message: PushMessage): Promise<number> {
  if (!isPushEndpoint(sub.endpoint)) return 410;
  const text = JSON.stringify({ ...message, title: message.title.slice(0, 120), body: message.body.slice(0, 300) });
  const body = await encryptPush(new Uint8Array(new TextEncoder().encode(text)), b64url.decode(sub.p256dh), b64url.decode(sub.auth));
  const response = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(new URL(sub.endpoint).origin, keys.subject, keys.privateKey, keys.raw),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(24 * 3600),
    },
    body,
  });
  return response.status;
}

/** Een melding naar al de toestellen van iemand. Een toestel dat niet meer bestaat (404, 410), valt weg. */
export async function notify(db: D1Database, personId: string, message: PushMessage): Promise<number> {
  const { results } = await db
    .prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE person_id = ?")
    .bind(personId)
    .all<Subscription>();
  if (!results.length) return 0;
  const keys = await vapid(db);
  if (!keys) return 0;
  let sent = 0;
  for (const sub of results) {
    const status = await send(keys, sub, message).catch((err) => {
      console.warn("Melding niet verstuurd", err);
      return 0;
    });
    if (status === 404 || status === 410) await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
    else if (status >= 200 && status < 300) sent++;
    else if (status) console.warn("Pushdienst weigerde de melding", status, new URL(sub.endpoint).hostname);
  }
  return sent;
}
