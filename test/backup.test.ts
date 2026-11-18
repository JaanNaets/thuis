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
  kinds: [
    { id: GEGETEN, base: "gebruik", name: "Gegeten", icon: "food", fields: [], goal: null, planned: false, parts: { money: false, to: false, duration: false, groups: [{ role: "uit", label: "Wat", list: VOORRAAD }] }, does: [], notify: { to: "all" }, reads: true, archived: 0, tag_ids: [TAG] },
    { id: "33333333-3333-4333-8333-333333333333", base: "aankoop", name: "Boodschap", icon: "cart", fields: [], goal: null, planned: true, parts: null, does: [], notify: null, reads: null, archived: 0, tag_ids: [] },
  ],
  items: [
    { id: PASTA, list_id: VOORRAAD, name: "Pasta", data: { eenheid: "g", met: SAUS, van: "vreemde" }, part_of: null, archived: 0, photo: true },
    { id: SAUS, list_id: VOORRAAD, name: "Saus", data: { eenheid: "kg", met: WEG, van: "jaan" }, part_of: PASTA, archived: 0, photo: false },
  ],
  events: [
    {
      id: EVENT,
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
        { role: "uit", item_id: PASTA, text: null, amount: 300, unit: "g", price: null, expires: null, owner: null },
        { role: "bij", item_id: COLRUYT, text: null, amount: null, unit: null, price: null, expires: null, owner: null },
        { role: "bij", item_id: WEG, text: null, amount: null, unit: null, price: null, expires: null, owner: "vreemde" },
      ],
    },
  ],
  views: [{ id: "99999999-9999-4999-8999-999999999999", list_id: VOORRAAD, target: "items", name: "Kelder", def: { conditions: [] }, shared: 1 }],
  outside: [{ id: WEG, name: "Oude winkel" }],
};

test("een back-up nakijken", () => {
  assert.equal(parseBackup(JSON.parse(JSON.stringify(backup))).lists.length, 1);
  assert.throws(() => parseBackup({ kind: "iets" }), /geen back-up/);
  assert.throws(() => parseBackup({ ...backup, version: 1 }), /andere versie/);
  assert.throws(() => parseBackup({ ...backup, items: [{ ...backup.items[0], list_id: "elders" }] }), /beschadigd/);
});

test("ids diep vervangen", () => {
  assert.deepEqual(remap({ a: ["x", { b: "x" }], c: "y" }, new Map([["x", "z"]])), { a: ["z", { b: "z" }], c: "y" });
});

test("terugzetten: nieuwe ids, verwijzingen binnen de kopie, wat niet klopt valt weg", () => {
  let n = 0;
  const plan = planRestore(backup, { newId: () => `n${++n}`, me: "jaan", people: new Set(["jaan"]), seenItems: new Set([COLRUYT]) });
  const [list] = plan.lists;
  assert.notEqual(list.id, VOORRAAD);
  assert.deepEqual(list.tags, ["Huis"]);
  // De verwijzing in een veld wijst naar de nieuwe lijst.
  assert.equal(list.fields.find((f) => f.key === "met")?.ref_type, list.id);
  assert.deepEqual(list.stock, { unit: "eenheid", default_unit: "stuk" });
  // Een formulier dat gepland begint, blijft dat; zijn tags, melding en fotokeuze komen mee; zijn groep uit de lijst
  // wijst naar de nieuwe lijst.
  assert.deepEqual(plan.kinds.map((k) => [k.name, k.planned, k.tags, k.notify, k.reads]), [
    ["Gegeten", false, ["Huis"], { to: "all" }, true],
    ["Boodschap", true, [], null, null],
  ]);
  assert.equal(plan.kinds[0].parts?.groups[0].lists[0], list.id, "een groep van vroeger (één lijst) leest als lijsten");
  const pasta = plan.items.find((t) => t.old === PASTA)!;
  const saus = plan.items.find((t) => t.old === SAUS)!;
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
    event.lines.map((l) => [l.role, l.item_id, l.text, l.owner]),
    [
      ["uit", pasta.id, null, null],
      ["bij", COLRUYT, null, null],
      ["bij", null, "Oude winkel", null],
    ],
  );
  assert.equal(plan.views[0].list_id, list.id);
});

test("een lijn naar iets dat je niet ziet wordt tekst; zonder naam valt ze weg", () => {
  const plan = planRestore({ ...backup, outside: [] }, { newId: () => crypto.randomUUID(), me: "jaan", people: new Set(["jaan"]), seenItems: new Set() });
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

test("terugzetten met een koppeling: enkel tussen lijsten die terugkomen, met de nieuwe ids", () => {
  const KEUKEN = "99999999-9999-4999-8999-999999999999";
  const MIRROR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const ELDERS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const KOPIE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const withMirror: Backup = {
    ...backup,
    lists: [...backup.lists, { ...backup.lists[0], id: KEUKEN, name: "Keuken", fields: [], tag_ids: [] }],
    items: [...backup.items, { id: KOPIE, list_id: KEUKEN, name: "Pasta", data: {}, part_of: null, archived: 0, photo: false, mirror_id: MIRROR, mirror_of: PASTA }],
    mirrors: [
      { id: MIRROR, list_id: KEUKEN, source_id: VOORRAAD, plan: { source: VOORRAAD, where: { match: "all", conditions: [] }, name: "_name", fields: {}, translate: {}, mode: "link" } },
      { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", list_id: KEUKEN, source_id: ELDERS, plan: {} },
    ],
  };
  const plan = planRestore(withMirror, { newId: () => crypto.randomUUID(), me: "jaan", people: new Set(["jaan"]), seenItems: new Set() });
  const keuken = plan.lists.find((l) => l.name === "Keuken")!;
  const voorraad = plan.lists.find((l) => l.name === "Voorraad")!;
  assert.equal(plan.mirrors.length, 1, "een koppeling met een lijst buiten de back-up valt weg");
  const [m] = plan.mirrors;
  assert.deepEqual([m.list_id, m.source_id, (m.plan as { source: string }).source], [keuken.id, voorraad.id, voorraad.id]);
  const kopie = plan.items.find((t) => t.old === KOPIE)!;
  const pasta = plan.items.find((t) => t.old === PASTA)!;
  assert.deepEqual([kopie.mirror_id, kopie.mirror_of], [m.id, pasta.id]);
  assert.deepEqual([pasta.mirror_id, pasta.mirror_of], [null, null]);
});

test("een back-up van versie 2 (dingen) leest als versie 3 (items)", () => {
  const list = { id: "L", name: "Wijnen", one: "Wijn", icon: null, color: null, fields: [], stock: null, notify: null, archived: 0, tag_ids: [] };
  const old = {
    kind: BACKUP_KIND,
    version: 2,
    people: [],
    tags: [],
    lists: [list],
    kinds: [],
    things: [{ id: "T", list_id: "L", name: "Chablis", data: {}, part_of: null, archived: 0, photo: false }],
    events: [{ id: "E", list_id: "L", kind: "aankoop", base: "aankoop", name: "", status: "gebeurd", at: "2026-11-01", end_at: null, amount: null, paid_by: null, split: null, to_person: null, data: {}, repeat: null, done_by: null, photo: false, lines: [{ role: "in", thing_id: "T", text: null, amount: 6, unit: null, price: null, expires: null, owner: null }] }],
    views: [{ id: "V", list_id: "L", target: "dingen", name: "Alles", def: {}, shared: 0 }],
    outside: [],
  };
  const b = parseBackup(old);
  assert.equal(b.version, BACKUP_VERSION);
  assert.equal(b.items[0].name, "Chablis");
  assert.equal(b.events[0].lines[0].item_id, "T");
  assert.equal(b.views[0].target, "items");
});

test("een back-up van versie 3 (formulieren bij een lijst) leest als versie 4 (losse formulieren)", () => {
  const ledger = { id: "U", name: "Uitgaven", one: "Persoon", icon: null, color: null, fields: [{ key: "p", label: "Persoon", type: "person" }, { key: "s", label: "Saldo", type: "money" }], stock: null, ledger: { person: "p", field: "s" }, notify: { to: "people" }, read_photo: { on: [], off: ["aankoop"] }, archived: 0, tag_ids: ["T"] };
  const wines = { id: "W", name: "Wijnen", one: "Wijn", icon: null, color: null, fields: [], stock: { default_unit: "fles" }, notify: null, archived: 0, tag_ids: [] };
  const event = (id: string, list_id: string, kind: string, extra: object = {}) => ({ id, list_id, kind, base: kind === "K" ? "gebruik" : kind, name: "", status: "gebeurd", at: "2026-11-01", end_at: null, amount: null, paid_by: null, split: null, to_person: null, data: {}, repeat: null, done_by: null, photo: false, lines: [], ...extra });
  const old = {
    kind: BACKUP_KIND,
    version: 3,
    people: [],
    tags: [{ id: "T", name: "Huis", color: null }],
    lists: [ledger, wines],
    kinds: [
      { id: "A", list_id: "U", base: "aankoop", name: "Aankoop", icon: "cart", fields: [], goal: null, sort_order: 0 },
      { id: "K", list_id: "W", base: "gebruik", name: "Proeverij", icon: null, fields: [], goal: null, parts: { money: false, to: false, duration: false, groups: [] }, sort_order: 0 },
    ],
    items: [{ id: "C", list_id: "W", name: "Chablis", data: {}, part_of: null, archived: 0, photo: false }],
    events: [
      event("E1", "U", "aankoop"),
      event("E2", "W", "aankoop"),
      event("E3", "W", "meting", { lines: [{ role: "voor", item_id: "C", text: null, amount: 6, unit: null, price: null, expires: null, owner: null }] }),
      event("E4", "W", "K"),
    ],
    views: [],
    outside: [],
  };
  const b = parseBackup(old);
  assert.equal(b.version, BACKUP_VERSION);
  // Een gebeurtenis met een vertrekpunt: naar het eigen formulier met dat vertrekpunt, anders een nieuw per lijst; een
  // telling wordt een Aanpassing.
  assert.deepEqual(b.events.map((e) => e.kind), ["A", "W-aankoop", "aanpassing", "K"]);
  assert.ok(b.events.every((e) => !("list_id" in e)));
  const aankoop = b.kinds.find((k) => k.id === "A")!;
  // De tags, melding en fotokeuze van de lijst; het saldo uitdrukkelijk in de lijst met een saldo per persoon.
  assert.deepEqual([aankoop.tag_ids, aankoop.notify, aankoop.reads], [["T"], { to: "people" }, null]);
  assert.ok((aankoop.does as { list: string | null; field: string }[]).some((h) => h.list === "U" && h.field === "$saldo"));
  assert.deepEqual(b.kinds.map((k) => k.id), ["A", "K", "W-aankoop"]);
  const plan = planRestore(b, { newId: () => crypto.randomUUID(), me: "jaan", people: new Set(["jaan"]), seenItems: new Set() });
  assert.equal(plan.kinds.length, 3);
  assert.equal(plan.events.length, 4);
  const saldo = plan.kinds.find((k) => k.name === "Aankoop" && k.does.some((h) => h.field === "$saldo"))!;
  const uitgaven = plan.lists.find((l) => l.name === "Uitgaven")!;
  assert.ok(saldo.does.every((h) => h.field !== "$saldo" || h.list === uitgaven.id), "het saldo in de nieuwe Uitgaven");
});
