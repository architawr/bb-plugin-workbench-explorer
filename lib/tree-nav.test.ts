import assert from "node:assert/strict";
import { test } from "bun:test";
import { horizontalAction, moveSelection, renameSelectionEnd, topLevelPaths, visibleRows } from "./tree-nav";

const dirs = {
  "": { status: "ready", entries: [
    { relativePath: "src", kind: "directory" as const },
    { relativePath: "README.md", kind: "file" as const },
  ] },
  src: { status: "ready", entries: [
    { relativePath: "src/a.ts", kind: "file" as const },
    { relativePath: "src/lib", kind: "directory" as const },
  ] },
  "src/lib": { status: "loading" },
};

test("only expanded, loaded folders contribute rows, in display order", () => {
  assert.deepEqual(visibleRows(dirs, new Set([""])).map((row) => row.relativePath), ["src", "README.md"]);
  assert.deepEqual(
    visibleRows(dirs, new Set(["", "src", "src/lib"])).map((row) => row.relativePath),
    ["src", "src/a.ts", "src/lib", "README.md"],
  );
});

test("up and down stop at the ends; nothing selected lands on the first row", () => {
  const rows = visibleRows(dirs, new Set(["", "src"]));
  assert.equal(moveSelection(rows, null, "ArrowDown"), "src");
  assert.equal(moveSelection(rows, "src", "ArrowDown"), "src/a.ts");
  assert.equal(moveSelection(rows, "README.md", "ArrowDown"), "README.md");
  assert.equal(moveSelection(rows, "src", "ArrowUp"), "src");
  assert.equal(moveSelection(rows, "src", "End"), "README.md");
});

test("right opens then enters a folder; left closes then leaves it", () => {
  const closed = new Set([""]);
  const open = new Set(["", "src"]);
  assert.deepEqual(horizontalAction(visibleRows(dirs, closed), closed, "src", "ArrowRight"), { kind: "expand", path: "src" });
  assert.deepEqual(horizontalAction(visibleRows(dirs, open), open, "src", "ArrowRight"), { kind: "select", path: "src/a.ts" });
  assert.deepEqual(horizontalAction(visibleRows(dirs, open), open, "src/a.ts", "ArrowLeft"), { kind: "select", path: "src" });
  assert.deepEqual(horizontalAction(visibleRows(dirs, open), open, "src", "ArrowLeft"), { kind: "collapse", path: "src" });
  assert.deepEqual(horizontalAction(visibleRows(dirs, open), open, "README.md", "ArrowRight"), { kind: "none" });
});

test("rename pre-selects the name without its extension", () => {
  assert.equal(renameSelectionEnd("app.test.ts", false), 8);
  assert.equal(renameSelectionEnd(".env", false), 4);
  assert.equal(renameSelectionEnd("my.folder", true), 9);
});


test("a batch drops paths that travel inside another of its folders", () => {
  assert.deepEqual(topLevelPaths(["src/a.ts", "src", "README.md", "src/lib/b.ts", "srcx/c.ts"]), ["README.md", "src", "srcx/c.ts"]);
});
