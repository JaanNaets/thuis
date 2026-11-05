import assert from "node:assert/strict";
import { test } from "node:test";
import { appManifest, listManifest, quickPath, SHARE_PATH, SHORTCUT_LISTS } from "../shared/manifest.ts";
import type { AddTarget } from "../shared/quickadd.ts";

const t = (type_id: string, name: string): AddTarget => ({ project_id: "p", project_name: "Thuis", type_id, name, plural: name, icon: null, used: 1, last: null, counter: false, receipt: false });

test("het manifest van de app: je meestgebruikte lijsten als snelkoppeling, en delen met Thuis", () => {
  const m = appManifest([t("a", "Bijvulling"), t("b", "Uitgave"), t("c", "Eten"), t("d", "Wijn")]);
  assert.equal(m.id, "/");
  assert.deepEqual(
    m.shortcuts.map((s) => [s.name, s.url]),
    [
      ["Bijvulling", "/projecten/p/nieuw?lijst=a"],
      ["Uitgave", "/projecten/p/nieuw?lijst=b"],
      ["Eten", "/projecten/p/nieuw?lijst=c"],
      ["Toevoegen", "/?toevoegen=1"],
      ["Agenda", "/agenda"],
    ],
  );
  assert.equal(SHORTCUT_LISTS, 3);
  assert.equal(m.share_target.action, SHARE_PATH);
  assert.equal(m.share_target.params.files[0].name, "foto");
});

test("een lijst als eigen icoon: eigen id en start, zelfde app", () => {
  const m = listManifest({ project_id: "p", type_id: "a", name: "Bijvulling" });
  assert.equal(m.id, quickPath("p", "a"));
  assert.equal(m.start_url, "/snel/p/a");
  assert.equal(m.name, "Bijvulling");
  assert.equal(m.scope, "/");
  assert.ok(!("share_target" in m));
});
