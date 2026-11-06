import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { BACKUP_KIND, BACKUP_TABLES, BACKUP_VERSION, parseBackup, planRestore, remap, type Backup } from "../shared/backup.ts";

const VOORRAAD = "11111111-1111-4111-8111-111111111111";
const GEGETEN = "22222222-2222-4222-8222-222222222222";
const PASTA = "33333333-3333-4333-8333-333333333333";
const SAUS = "44444444-4444-4444-8444-444444444444";
const EVENT = "55555555-5555-4555-8555-555555555555";
const COLRUYT = "66666666-6666-4666-8666-666666666666"; // in een lijst die niet in de back-up zit
const WEG = "77777777-7777-4777-8777-777777777777"; // bestaat niet meer
const TAG = "88888888-8888-4888-8888-888888888888";

const backup: Backup = {
  kind: BACKUP_KIND,
  version: BACKUP_VERSION,
  created_at: "2026-11-06T12:00:00Z",
  people: [{ id: "jaan", name: "Jaan", email: "jaan@example.be", color: null }],
  tags: [{ id: TAG, name: "Huis", color: null }],
  lists: [
    {
      id: VOORRAAD,
      name: "Voorraad",
      one: "Product",
      icon: "food",
      color: null,
      fields: [
        { key: "eenheid", label: "Eenheid", type: "select", options: ["g", "kg"] },
        { key: "met", label: "Gaat met", type: "item", ref_type: VOORRAAD },
        { key: "van", label: "Van", type: "person" },
      ],
      stock: { unit: "eenheid", default_unit: "stuk" },
      notify: null,
      archived: 0,
      tag_ids: [TAG],
    },
  ],
  kinds: [{ id: GEGETEN, list_id: VOORRAAD, base: "gebruik", name: "Gegeten", icon: "food", fields: [], goal: null, sort_order: 0 }],
  things: [
    { id: PASTA, list_id: VOORRAAD, name: "Pasta", data: { eenheid: "g", met: SAUS, van: "vreemde" }, part_of: null, archived: 0, photo: true },
    { id: SAUS, list_id: VOORRAAD, name: "Saus", data: { eenheid: "kg", met: WEG, van: "jaan" }, part_of: PASTA, archived: 0, photo: false },
  ],
  events: [
    {
      id: EVENT,
      list_id: VOORRAAD,
      kind: GEGETEN,
      base: "gebruik",
      name: "",
      status: "gebeurd",
      at: "2026-11-05T19:00",
      end_at: null,
      amount: null,
      paid_by: "jaan",
      split: [
        { person_id: "jaan", share: 50 },
        { person_id: "vreemde", share: 50 },
      ],
      to_person: null,
      data: {},
      repeat: null,
      done_by: null,
      photo: false,
      lines: [
        { role: "uit", thing_id: PASTA, text: null, amount: 300, unit: "g", price: null, expires: null, owner: null },
        { role: "bij", thing_id: COLRUYT, text: null, amount: null, unit: null, price: null, expires: null, owner: null },
        { role: "bij", thing_id: WEG, text: null, amount: null, unit: null, price: null, expires: null, owner: "vreemde" },
      ],
    },
  ],
  views: [{ id: "99999999-9999-4999-8999-999999999999", list_id: VOORRAAD, target: "dingen", name: "Kelder", def: { conditions: [] }, shared: 1 }],
  outside: [{ id: WEG, name: "Oude winkel" }],
};

test("een back-up nakijken", () => {
  assert.equal(parseBackup(JSON.parse(JSON.stringify(backup))).lists.length, 1);
  assert.throws(() => parseBackup({ kind: "iets" }), /geen back-up/);
  assert.throws(() => parseBackup({ ...backup, version: 1 }), /andere versie/);
  assert.throws(() => parseBackup({ ...backup, things: [{ ...backup.things[0], list_id: "elders" }] }), /beschadigd/);
});

test("ids diep vervangen", () => {
  assert.deepEqual(remap({ a: ["x", { b: "x" }], c: "y" }, new Map([["x", "z"]])), { a: ["z", { b: "z" }], c: "y" });
});

test("terugzetten: nieuwe ids, verwijzingen binnen de kopie, wat niet klopt valt weg", () => {
  let n = 0;
  const plan = planRestore(backup, { newId: () => `n${++n}`, me: "jaan", people: new Set(["jaan"]), seenThings: new Set([COLRUYT]) });
  const [list] = plan.lists;
  assert.notEqual(list.id, VOORRAAD);
  assert.deepEqual(list.tags, ["Huis"]);
  // De verwijzing in een veld wijst naar de nieuwe lijst.
  assert.equal(list.fields.find((f) => f.key === "met")?.ref_type, list.id);
  assert.deepEqual(list.stock, { unit: "eenheid", default_unit: "stuk" });
  const pasta = plan.things.find((t) => t.old === PASTA)!;
  const saus = plan.things.find((t) => t.old === SAUS)!;
  // Pasta: met = de nieuwe saus; een persoon die je niet kent valt weg.
  assert.deepEqual(pasta.data, { eenheid: "g", met: saus.id });
  // Saus: wat weg is, valt weg; deel van de nieuwe pasta.
  assert.deepEqual(saus.data, { eenheid: "kg", van: "jaan" });
  assert.equal(saus.part_of, pasta.id);
  assert.equal(pasta.photo, true);
  const [event] = plan.events;
  assert.equal(event.kind, plan.kinds[0].id);
  assert.deepEqual(event.split, [{ person_id: "jaan", share: 50 }]);
  assert.deepEqual(
    event.lines.map((l) => [l.role, l.thing_id, l.text, l.owner]),
    [
      ["uit", pasta.id, null, null],
      ["bij", COLRUYT, null, null],
      ["bij", null, "Oude winkel", null],
    ],
  );
  assert.equal(plan.views[0].list_id, list.id);
});

test("een lijn naar iets dat je niet ziet wordt tekst; zonder naam valt ze weg", () => {
  const plan = planRestore({ ...backup, outside: [] }, { newId: () => crypto.randomUUID(), me: "jaan", people: new Set(["jaan"]), seenThings: new Set() });
  assert.deepEqual(
    plan.events[0].lines.map((l) => [l.role, l.text]),
    [["uit", null]],
  );
});

test("elke tabel uit de migraties staat in BACKUP_TABLES (mee in de back-up of bewust niet)", () => {
  const tables = new Set<string>();
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(new URL(file, dir), "utf8").replace(/--.*$/gm, "");
    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)|DROP TABLE (?:IF EXISTS )?(\w+)|ALTER TABLE (\w+) RENAME TO (\w+)/gi)) {
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
