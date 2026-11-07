import assert from "node:assert/strict";
import { test } from "node:test";
import { appManifest, ownAppManifest, SHARE_PATH, SHORTCUT_LISTS } from "../shared/manifest.ts";

test("het manifest van de app: je meestgebruikte plekken als snelkoppeling, en delen met Heystack", () => {
  const often = [
    { name: "Gegeten", url: "/lijsten/v/loggen?soort=g" },
    { name: "Bijvulling", url: "/lijsten/p/loggen?soort=b" },
    { name: "Tankbeurt", url: "/lijsten/w/loggen?soort=t" },
    { name: "Gewicht", url: "/lijsten/j/loggen?soort=x" },
  ];
  const m = appManifest(often);
  assert.equal(m.start_url, "/");
  assert.deepEqual(
    m.shortcuts.map((s) => s.name),
    [...often.slice(0, SHORTCUT_LISTS).map((o) => o.name), "Toevoegen"],
  );
  assert.equal(m.share_target.action, SHARE_PATH);
  // Eigen snelkoppelingen winnen.
  assert.deepEqual(appManifest(often, [{ name: "Keuken", url: "/?bord=k1" }]).shortcuts.map((s) => s.url), ["/?bord=k1"]);
});

test("een eigen app: eigen id en start, haar naam", () => {
  const m = ownAppManifest({ id: "a1", name: "Pelletkachel bijvullen" });
  assert.equal(m.id, "/app/a1");
  assert.equal(m.start_url, "/app/a1");
  assert.equal(m.short_name, "Pelletkachel");
});
