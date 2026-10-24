import assert from "node:assert/strict";
import { test } from "bun:test";
import { moveProblem } from "./move-entry";

test("a drop that cannot or need not move anything is caught before the disk", () => {
  assert.equal(moveProblem("", "src"), "The workspace root cannot be moved.");
  assert.equal(moveProblem("src", "src"), "A folder cannot be moved into itself.");
  assert.equal(moveProblem("src", "src/lib"), "A folder cannot be moved into itself.");
  assert.equal(moveProblem("src/a.ts", "src"), "already-there");
  assert.equal(moveProblem("a.ts", ""), "already-there");
  assert.equal(moveProblem("src/a.ts", ""), null);
  assert.equal(moveProblem("srcx/a.ts", "src"), null);
});
