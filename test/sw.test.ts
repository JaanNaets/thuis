// De service worker (sw/sw.js) bewaart enkel de API-routes in OFFLINE_API voor offline gebruik. Elk patroon moet nog
// een echte GET-route van de Worker zijn: na de herbouw stonden er nog projecten en items in, waardoor offline niets
// meer opende. Deze test leest de routes uit worker/index.ts en worker/routes/*.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function getRoutes(): string[] {
  const index = readFileSync("worker/index.ts", "utf8");
  const fileOf = new Map<string, string>();
  for (const m of index.matchAll(/import \{([^}]+)\} from "\.\/routes\/([\w-]+)"/g)) {
    for (const name of m[1].split(",").map((s) => s.trim()).filter(Boolean)) fileOf.set(name, m[2]);
  }
  const routes: string[] = [];
  for (const m of index.matchAll(/app\.route\("([^"]+)", (\w+)\)/g)) {
    const [, prefix, name] = m;
    const file = fileOf.get(name);
    assert.ok(file, `route ${name} zonder import`);
    const source = readFileSync(`worker/routes/${file}.ts`, "utf8");
    for (const g of source.matchAll(new RegExp(`^${name}\\.get\\("([^"]*)"`, "gm"))) {
      const path = `/api${prefix}${g[1] === "/" ? "" : g[1]}`.replace(/:\w+/g, "a1b2-c3");
      routes.push(path);
    }
  }
  return routes;
}

function offlinePatterns(): RegExp[] {
  const sw = readFileSync("sw/sw.js", "utf8");
  const block = sw.match(/const OFFLINE_API = (\[[\s\S]*?\]);/);
  assert.ok(block, "OFFLINE_API niet gevonden in sw/sw.js");
  return new Function(`return ${block[1]};`)() as RegExp[];
}

test("service worker: elk offline patroon is een echte GET-route", () => {
  const routes = getRoutes();
  assert.ok(routes.length > 20, "routes van de Worker niet gevonden");
  for (const pattern of offlinePatterns()) {
    assert.ok(
      routes.some((r) => pattern.test(r)),
      `${pattern} past op geen enkele GET-route`,
    );
  }
});

test("service worker: de schermen die je offline wil openen, staan erin", () => {
  const patterns = offlinePatterns();
  const offline = (path: string) => patterns.some((p) => p.test(path));
  for (const path of ["/api/me", "/api/me/overview", "/api/lists/a1b2-c3", "/api/lists/a1b2-c3/things", "/api/lists/a1b2-c3/events", "/api/things/a1b2-c3", "/api/events/a1b2-c3"]) {
    assert.ok(offline(path), `${path} niet offline`);
  }
  // Foto's en de back-up niet: die zijn groot of gevoelig.
  for (const path of ["/api/things/a1b2-c3/photo", "/api/me/backup"]) assert.ok(!offline(path), `${path} zou niet offline mogen`);
});
