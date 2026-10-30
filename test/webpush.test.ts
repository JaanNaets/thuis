import assert from "node:assert/strict";
import { test } from "node:test";
import { b64url, encryptPush, generateKeys, isPushEndpoint, publicJwk, pushKeys, vapidAuthorization } from "../shared/webpush.ts";

// Het voorbeeld uit RFC 8291 (bijlage A).
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const ecdhPair = async (privateD: string, publicRaw: string): Promise<CryptoKeyPair> => {
  const pub = publicJwk(b64url.decode(publicRaw));
  return {
    privateKey: await crypto.subtle.importKey("jwk", { ...pub, d: privateD }, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]),
    publicKey: await crypto.subtle.importKey("jwk", pub, { name: "ECDH", namedCurve: "P-256" }, true, []),
  };
};

/** Ontsleutelen zoals een toestel het doet (enkel voor de test). */
async function decrypt(body: Uint8Array, device: CryptoKeyPair, deviceRaw: Uint8Array, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const senderRaw = body.slice(21, 21 + idlen);
  const sender = await crypto.subtle.importKey("raw", senderRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: sender }, device.privateKey, 256));
  const derive = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: s, info },
        await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]),
        n * 8,
      ),
    );
  const te = new TextEncoder();
  const ikm = await derive(auth, shared, new Uint8Array([...te.encode("WebPush: info\0"), ...deviceRaw, ...senderRaw]), 32);
  const cek = await derive(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await derive(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, body.slice(21 + idlen)));
  assert.equal(plain[plain.length - 1], 2, "laatste blok");
  return new TextDecoder().decode(plain.slice(0, -1));
}

test("web push: versleutelen zoals het voorbeeld in RFC 8291", async () => {
  const keys = { pair: await ecdhPair(RFC.asPrivate, RFC.asPublic), raw: b64url.decode(RFC.asPublic) };
  const body = await encryptPush(new TextEncoder().encode(RFC.plaintext), b64url.decode(RFC.uaPublic), b64url.decode(RFC.auth), {
    keys,
    salt: b64url.decode(RFC.salt),
  });
  assert.equal(b64url.encode(body), RFC.body);
  // En het toestel kan het lezen.
  const device = await ecdhPair(RFC.uaPrivate, RFC.uaPublic);
  assert.equal(await decrypt(body, device, b64url.decode(RFC.uaPublic), b64url.decode(RFC.auth)), RFC.plaintext);
});

test("web push: elke keer een nieuwe sleutel, en het toestel leest het", async () => {
  const device = await generateKeys("ECDH");
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const text = JSON.stringify({ title: "Verwarming", body: "Volgende keer: over 7 dagen" });
  const a = await encryptPush(new TextEncoder().encode(text), device.raw, auth);
  const b = await encryptPush(new TextEncoder().encode(text), device.raw, auth);
  assert.notEqual(b64url.encode(a), b64url.encode(b));
  assert.equal(await decrypt(a, device.pair, device.raw, auth), text);
});

test("web push: VAPID is ondertekend met de sleutel van de app", async () => {
  const vapid = await generateKeys("ECDSA");
  const header = await vapidAuthorization("https://fcm.googleapis.com", "https://thuis.example", vapid.pair.privateKey, vapid.raw, 1_800_000_000_000);
  const m = header.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  assert.ok(m);
  const claims = JSON.parse(new TextDecoder().decode(b64url.decode(m[2])));
  assert.deepEqual(claims, { aud: "https://fcm.googleapis.com", exp: 1_800_000_000 + 12 * 3600, sub: "https://thuis.example" });
  assert.equal(m[4], b64url.encode(vapid.raw));
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    vapid.pair.publicKey,
    b64url.decode(m[3]),
    new TextEncoder().encode(`${m[1]}.${m[2]}`),
  );
  assert.ok(ok);
});

test("web push: enkel naar pushdiensten, met geldige sleutels", () => {
  assert.ok(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"));
  assert.ok(isPushEndpoint("https://web.push.apple.com/QK1"));
  assert.ok(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x"));
  assert.ok(isPushEndpoint("https://wns2-am3p.notify.windows.com/w/?token=x"));
  assert.ok(!isPushEndpoint("http://fcm.googleapis.com/fcm/send/abc"));
  assert.ok(!isPushEndpoint("https://evil.example/fcm.googleapis.com"));
  assert.ok(!isPushEndpoint("https://fcm.googleapis.com.evil.example/x"));
  assert.ok(!isPushEndpoint("https://fcm.googleapis.com:8443/x"));
  assert.ok(!isPushEndpoint("https://localhost/x"));
  assert.deepEqual(pushKeys(RFC.uaPublic, RFC.auth), { p256dh: RFC.uaPublic, auth: RFC.auth });
  assert.equal(pushKeys(RFC.auth, RFC.auth), null);
  assert.equal(pushKeys(RFC.uaPublic, "kort"), null);
  assert.equal(pushKeys(42, RFC.auth), null);
});
