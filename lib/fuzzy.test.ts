import assert from "node:assert/strict";
import { test } from "bun:test";
import { fuzzyPositions, fuzzyScore } from "./fuzzy";

test("characters match in order, preferring word starts", () => {
  assert.deepEqual(fuzzyPositions("FileExplorerBody.tsx", "fexb"), [0, 4, 5, 12]);
  assert.deepEqual(fuzzyPositions("FileExplorerBody.tsx", "feb"), [0, 4, 12]);
  assert.equal(fuzzyPositions("server.ts", "xyz"), null);
  assert.deepEqual(fuzzyPositions("use-git-status.ts", "ugs"), [0, 4, 8]);
});

test("tighter and word-aligned matches score better", () => {
  assert.ok(fuzzyScore("FileExplorerBody.tsx", "feb")! < fuzzyScore("fooEnumBar.tsx", "feb")! + 100);
  assert.ok(fuzzyScore("git-status.ts", "gs")! < fuzzyScore("aging-strategy.ts", "gs")!);
});
