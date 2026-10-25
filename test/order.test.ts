import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanOrder, moveItem } from "../shared/order.ts";

test("verplaatsen in een lijst", () => {
  assert.deepEqual(moveItem(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveItem(["a", "b", "c", "d"], 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 1, 1), ["a", "b", "c"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 9), ["b", "c", "a"]);
  assert.deepEqual(moveItem(["a", "b"], 5, 0), ["a", "b"]);
});

test("een volgorde van buiten nakijken", () => {
  assert.deepEqual(cleanOrder(["a-1", "b-2"]), ["a-1", "b-2"]);
  assert.equal(cleanOrder([]), null);
  assert.equal(cleanOrder("a"), null);
  assert.equal(cleanOrder(["a", "a"]), null);
  assert.equal(cleanOrder(["a", 3]), null);
  assert.equal(cleanOrder(["a'; DROP TABLE x"]), null);
  assert.equal(cleanOrder(Array.from({ length: 201 }, (_, i) => `id${i}`)), null);
});
