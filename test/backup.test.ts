import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  BACKUP_KIND,
  BACKUP_TABLES,
  BACKUP_VERSION,
  freshIds,
  parseBackup,
  projectTree,
  remap,
  topProjects,
  type Backup,
} from "../shared/backup.ts";

const P = "11111111-1111-4111-8111-111111111111";
const SUB = "22222222-2222-4222-8222-222222222222";
const V = "33333333-3333-4333-8333-333333333333";
const E = "44444444-4444-4444-8444-444444444444";
const PELLETS = "55555555-5555-4555-8555-555555555555";
const ETEN = "66666666-6666-4666-8666-666666666666";
const TAG = "77777777-7777-4777-8777-777777777777";
const ELDERS = "99999999-9999-4999-8999-999999999999"; // een lijst in een project dat niet in de back-up zit

const backup: Backup = {
  kind: BACKUP_KIND,
  version: BACKUP_VERSION,
  created_at: "2026-11-04T12:00:00Z",
  people: [{ id: "p1", name: "Jaan", email: "jaan@example.be", color: null }],
  projects: [
    {
      id: P,
      parent_id: null,
      name: "Huis",
      description: null,
      icon: null,
      color: null,
      sort_order: 0,
      archived: 0,
    },
    {
      id: SUB,
      parent_id: P,
      name: "Kachel",
      description: null,
      icon: null,
      color: null,
      sort_order: 0,
      archived: 0,
    },
  ],
  roles: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      project_id: P,
      name: "Kijker",
      rights: { items: "view", types: { [V]: { access: "none" } } },
      sort_order: 0,
    },
  ],
  memberships: [],
  types: [
    {
      id: V,
      project_id: P,
      name: "Product",
      plural: "Voorraad",
      name_label: null,
      icon: null,
      fields: [{ key: "aantal", label: "Aantal", type: "number" }],
      totals: [],
      sort_order: 0,
    },
    {
      id: E,
      project_id: SUB,
      name: "Eten",
      plural: "Eten",
      name_label: null,
      icon: null,
      fields: [
        {
          key: "wat",
          label: "Wat",
          type: "item",
          ref_type: V,
          ref_also: [ELDERS],
          adjust: { field: "aantal", sign: -1 },
        },
      ],
      totals: [{ id: "t", agg: "count", period: "all", sources: [ELDERS] }],
      sort_order: 0,
    },
  ],
  tags: [{ id: TAG, project_id: P, name: "Bio", color: null }],
  items: [
    {
      id: PELLETS,
      project_id: P,
      type_id: V,
      name: "Pellets",
      data: { aantal: 34 },
      archived: 0,
      created_by: "p1",
      created_at: "x",
      updated_at: "x",
      tags: [TAG],
      photo: false,
    },
    {
      id: ETEN,
      project_id: SUB,
      type_id: E,
      name: "Ontbijt",
      data: { wat: PELLETS },
      archived: 0,
      created_by: "p1",
      created_at: "x",
      updated_at: "x",
      tags: [],
      photo: false,
    },
  ],
  log: [],
  repeats: [],
  views: [
    {
      id: "88888888-8888-4888-8888-888888888888",
      project_id: P,
      type_id: V,
      person_id: null,
      name: "Bio",
      def: { conditions: [{ field: "tags", op: "any_of", value: [TAG] }] },
      sort_order: 0,
    },
  ],
  shown: [{ project_id: SUB, type_id: V }],
  files: [],
};

test("een back-up herkennen en weigeren wat niet klopt", () => {
  assert.equal(
    parseBackup(JSON.parse(JSON.stringify(backup))).projects.length,
    2,
  );
  assert.throws(() => parseBackup({ kind: "iets" }), /geen back-up/);
  assert.throws(() => parseBackup({ ...backup, version: 2 }), /andere versie/);
  assert.throws(
    () => parseBackup({ ...backup, items: undefined }),
    /onvolledig/,
  );
  assert.throws(
    () =>
      parseBackup({
        ...backup,
        items: [{ ...backup.items[0], project_id: ELDERS }],
      }),
    /beschadigd/,
  );
  assert.throws(
    () => parseBackup({ ...backup, projects: [] }),
    /geen projecten/,
  );
});

test("terugzetten: overal nieuwe ids, ook diep in velden, waarden, rechten en weergaven", () => {
  let n = 0;
  const map = freshIds(backup, () => `nieuw-${++n}`);
  const types = remap(backup.types, map);
  const items = remap(backup.items, map);
  const views = remap(backup.views, map);
  const shown = remap(backup.shown, map);
  const roles = remap(backup.roles, map);
  const eten = types[1] as {
    fields: { ref_type: string; ref_also: string[] }[];
    totals: { sources: string[] }[];
    project_id: string;
  };
  // De verwijzing naar de voorraad wijst naar de nieuwe; die naar een lijst elders blijft.
  assert.equal(eten.fields[0].ref_type, map.get(V));
  assert.deepEqual(eten.fields[0].ref_also, [ELDERS]);
  assert.deepEqual(eten.totals[0].sources, [ELDERS]);
  assert.equal(eten.project_id, map.get(SUB));
  // Het item verwijst naar de nieuwe Pellets; de rechten per lijst (op sleutel) gelden voor de nieuwe voorraad.
  assert.deepEqual(items[1].data, { wat: map.get(PELLETS) });
  assert.deepEqual(roles[0].rights, {
    items: "view",
    types: { [map.get(V)!]: { access: "none" } },
  });
  assert.deepEqual(items[0].tags, [map.get(TAG)]);
  assert.deepEqual(
    (views[0].def as { conditions: { value: string[] }[] }).conditions[0].value,
    [map.get(TAG)],
  );
  assert.deepEqual(shown, [{ project_id: map.get(SUB), type_id: map.get(V) }]);
  // Sleutels van velden en gewone tekst blijven.
  assert.deepEqual(items[0].data, { aantal: 34 });
  assert.equal(items[0].name, "Pellets");
});

test("de projecten bovenaan, van boven naar onder, zonder kringen", () => {
  assert.deepEqual(
    topProjects(backup).map((p) => p.id),
    [P],
  );
  assert.deepEqual(
    topProjects({ ...backup, projects: [backup.projects[1]] }).map((p) => p.id),
    [SUB],
  );
  const { order, chain } = projectTree(backup);
  assert.deepEqual(
    order.map((p) => p.id),
    [P, SUB],
  );
  assert.deepEqual(chain.get(SUB), [SUB, P]);
  // Twee projecten die elkaars ouder zijn, hangen nergens aan.
  const loop = {
    ...backup,
    projects: [
      ...backup.projects,
      { ...backup.projects[1], id: "x1", parent_id: "x2" },
      { ...backup.projects[1], id: "x2", parent_id: "x1" },
    ],
  };
  assert.deepEqual(
    projectTree(loop).order.map((p) => p.id),
    [P, SUB],
  );
});

test("elke tabel uit de migraties staat in BACKUP_TABLES (mee in de back-up of bewust niet)", () => {
  const tables = new Set<string>();
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(new URL(file, dir), "utf8").replace(/--.*$/gm, "");
    for (const m of sql.matchAll(
      /CREATE TABLE (?:IF NOT EXISTS )?(\w+)|DROP TABLE (?:IF EXISTS )?(\w+)|ALTER TABLE (\w+) RENAME TO (\w+)/gi,
    )) {
      if (m[1]) tables.add(m[1].toLowerCase());
      if (m[2]) tables.delete(m[2].toLowerCase());
      if (m[3]) {
        tables.delete(m[3].toLowerCase());
        tables.add(m[4].toLowerCase());
      }
    }
  }
  assert.deepEqual([...tables].sort(), Object.keys(BACKUP_TABLES).sort());
});
