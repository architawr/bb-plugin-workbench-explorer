import assert from "node:assert/strict";
import { test } from "bun:test";
import { copyName, trashName } from "./entry-names";

test("duplicates are named the way VS Code names them", () => {
  assert.equal(copyName("a.ts", new Set(["a.ts"]), false), "a copy.ts");
  assert.equal(copyName("a.ts", new Set(["a.ts", "a copy.ts"]), false), "a copy 2.ts");
  assert.equal(copyName(".env", new Set([".env"]), false), ".env copy");
  assert.equal(copyName("my.dir", new Set(["my.dir"]), true), "my.dir copy");
});

test("a name already in the Trash gets the time, then a counter", () => {
  const now = new Date(2026, 0, 1, 9, 5, 7);
  assert.equal(trashName("a.ts", new Set(), now, false), "a.ts");
  assert.equal(trashName("a.ts", new Set(["a.ts"]), now, false), "a 09.05.07.ts");
  assert.equal(trashName("a.ts", new Set(["a.ts", "a 09.05.07.ts"]), now, false), "a 09.05.07 2.ts");
});
