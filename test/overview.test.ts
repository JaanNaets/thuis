import assert from "node:assert/strict";
import { test } from "node:test";
import { blockKey, blockProjects, cleanBlocks, cleanBoards, DEFAULT_ALL, defaultBlocks, MAIN_BOARD, MAX_BLOCKS, renameBoards } from "../shared/overview.ts";

test("blokken op het overzicht: enkel geldige, zonder dubbels", () => {
  const out = cleanBlocks([
    { kind: "project", project: "p1", hide: ["l1", "l1", "bad id!"], views: { l2: "v1", "bad id!": "v2", l3: 5 } },
    { kind: "project", project: "p1" },
    { kind: "list", project: "p1", list: "l2" },
    { kind: "list", project: "p1", list: "l2", view: "v1", show: "items", wide: true },
    { kind: "list", project: "p1", list: "l2", view: "fout id!", show: "alles", wide: "ja" },
    { kind: "add", project: "p1", list: "l2" },
    { kind: "total", project: "p1", list: "l2", total: "t1" },
    { kind: "value", item: "i1", field: "aantal" },
    { kind: "value", item: "i1", field: "Niet Goed" },
    { kind: "iets", project: "p1" },
    "rommel",
    null,
  ]);
  assert.deepEqual(out, [
    { kind: "project", project: "p1", hide: ["l1"], views: { l2: "v1" } },
    { kind: "list", project: "p1", list: "l2" },
    // Dezelfde lijst met een weergave als tabel is een ander blok; een kapotte weergave valt weg (dan een dubbel).
    { kind: "list", project: "p1", list: "l2", view: "v1", show: "items", wide: true },
    { kind: "add", project: "p1", list: "l2" },
    { kind: "total", project: "p1", list: "l2", total: "t1" },
    { kind: "value", item: "i1", field: "aantal" },
  ]);
});

test("leeg is vanzelf; te veel valt weg", () => {
  assert.equal(cleanBlocks(null), null);
  assert.equal(cleanBlocks("geen lijst"), null);
  assert.deepEqual(cleanBlocks([]), []);
  const many = Array.from({ length: MAX_BLOCKS + 5 }, (_, i) => ({ kind: "project", project: `p${i}` }));
  assert.equal(cleanBlocks(many)!.length, MAX_BLOCKS);
  assert.deepEqual(
    defaultBlocks([
      { id: "a", parent_id: null },
      { id: "b", parent_id: "a" },
    ]),
    [
      { kind: "project", project: "a" },
      { kind: "project", project: "b" },
    ],
  );
  // Veel projecten: enkel die bovenaan (ook een subproject waarvan je de ouder niet ziet).
  const big = [{ id: "r", parent_id: null }, { id: "los", parent_id: "onzichtbaar" }, ...Array.from({ length: DEFAULT_ALL }, (_, i) => ({ id: `s${i}`, parent_id: "r" }))];
  assert.deepEqual(
    defaultBlocks(big).map((b) => (b.kind === "project" ? b.project : "")),
    ["r", "los"],
  );
  assert.deepEqual(
    blockProjects([
      { kind: "project", project: "a" },
      { kind: "list", project: "b", list: "l" },
      { kind: "project", project: "a", hide: ["x"] },
      { kind: "value", item: "i", field: "f" },
    ]),
    ["a", "b"],
  );
  assert.equal(blockKey({ kind: "value", item: "i", field: "f" }), "value/i/f");
});

test("meerdere overzichten: het oude formaat wordt het eerste, en altijd minstens één", () => {
  const block = { kind: "project", project: "p1" };
  assert.deepEqual(cleanBoards(null), [{ id: MAIN_BOARD, name: "Overzicht", blocks: null }]);
  assert.deepEqual(cleanBoards([block]), [{ id: MAIN_BOARD, name: "Overzicht", blocks: [block] }]);
  assert.deepEqual(
    cleanBoards({ boards: [{ id: "main", name: " Thuis ", blocks: null }, { id: "k1", name: "Keuken", blocks: [block, block] }, { id: "k1", name: "Dubbel" }, { id: "x", name: "" }] }),
    [
      { id: "main", name: "Thuis", blocks: null },
      { id: "k1", name: "Keuken", blocks: [block] },
    ],
  );
  assert.equal(cleanBoards({ boards: [] }).length, 1);
});

test("overzichten hernoemen, schikken, toevoegen en weghalen", () => {
  const boards = cleanBoards({ boards: [{ id: "main", name: "Thuis", blocks: null }, { id: "k1", name: "Keuken", blocks: [] }] });
  let n = 0;
  const next = renameBoards(boards, [{ id: "k1", name: "Keuken" }, { id: "main", name: "Alles" }, { name: "Kelder" }], () => `n${++n}`);
  assert.deepEqual(next.map((b) => [b.id, b.name, b.blocks]), [["k1", "Keuken", []], ["main", "Alles", null], ["n1", "Kelder", []]]);
  // Alles weg: het eerste blijft.
  assert.deepEqual(renameBoards(boards, [], () => "x").map((b) => b.id), ["main"]);
  // Een onbekende id maakt niets nieuw.
  assert.deepEqual(renameBoards(boards, [{ id: "zzz", name: "Raar" }], () => "x").map((b) => b.id), ["main"]);
});

test("Blok Wie moet wie: één per project", () => {
  const blocks = cleanBlocks([
    { kind: "balance", project: "huis" },
    { kind: "balance", project: "huis" },
    { kind: "balance" },
  ]);
  assert.deepEqual(blocks, [{ kind: "balance", project: "huis" }]);
});
