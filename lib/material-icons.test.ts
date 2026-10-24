import assert from "node:assert/strict";
import { test } from "bun:test";
import { fileIconId, folderIconId } from "./material-icons";

test("file names win over extensions, and the longest extension wins", () => {
  assert.equal(fileIconId("package.json"), "nodejs");
  assert.equal(fileIconId("index.ts"), "typescript");
  assert.equal(fileIconId("index.d.ts"), "typescript-def");
  assert.equal(fileIconId("App.TSX"), "react_ts");
  assert.equal(fileIconId("no-extension-here"), "file");
});

test("folders map to a closed and an open icon", () => {
  assert.equal(folderIconId("src", { expanded: false }), "folder-src");
  assert.equal(folderIconId("src", { expanded: true }), "folder-src-open");
  assert.equal(folderIconId("whatever", { expanded: true }), "folder-open");
  assert.equal(folderIconId("src", { expanded: false, isRoot: true }), "folder-root");
});
