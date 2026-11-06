import assert from "node:assert/strict";
import { test } from "node:test";
import { segmentBlocks, type Block } from "../shared/board.ts";

test("snel loggen na elkaar staat samen, de rest los en in dezelfde volgorde", () => {
  const blocks: Block[] = [
    { kind: "quick", list: "A", type: "gegeten" },
    { kind: "food" },
    { kind: "quick", list: "A", type: "water" },
    { kind: "quick", list: "A", type: "slaap" },
    { kind: "timers" },
    { kind: "quick", list: "B" },
  ];
  assert.deepEqual(segmentBlocks(blocks), [
    [{ kind: "quick", list: "A", type: "gegeten" }],
    { kind: "food" },
    [
      { kind: "quick", list: "A", type: "water" },
      { kind: "quick", list: "A", type: "slaap" },
    ],
    { kind: "timers" },
    [{ kind: "quick", list: "B" }],
  ]);
  assert.deepEqual(segmentBlocks([]), []);
});
