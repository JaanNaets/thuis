import assert from "node:assert/strict";
import { test } from "node:test";
import { blockKey, blockProjects, cleanBlocks, DEFAULT_ALL, defaultBlocks, MAX_BLOCKS } from "../shared/overview.ts";

test("blokken op het overzicht: enkel geldige, zonder dubbels", () => {
  const out = cleanBlocks([
    { kind: "project", project: "p1", hide: ["l1", "l1", "bad id!"] },
    { kind: "project", project: "p1" },
    { kind: "list", project: "p1", list: "l2" },
    { kind: "add", project: "p1", list: "l2" },
    { kind: "total", project: "p1", list: "l2", total: "t1" },
    { kind: "value", item: "i1", field: "aantal" },
    { kind: "value", item: "i1", field: "Niet Goed" },
    { kind: "iets", project: "p1" },
    "rommel",
    null,
  ]);
  assert.deepEqual(out, [
    { kind: "project", project: "p1", hide: ["l1"] },
    { kind: "list", project: "p1", list: "l2" },
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
    ]),
    ["a"],
  );
  assert.equal(blockKey({ kind: "value", item: "i", field: "f" }), "value/i/f");
});
