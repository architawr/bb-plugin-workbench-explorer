import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "bun:test";
import { copyHostPath, restoreHostPath, trashHostPath } from "./host-trash";

async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), "fe-trash-"));
  const root = path.join(base, "root");
  const trash = path.join(base, "Trash");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), "a");
  return { base, root, trash };
}

test("delete goes to the Trash, and undo brings it back", async () => {
  const { base, root, trash } = await fixture();
  try {
    const first = await trashHostPath(root, "src/a.ts", trash);
    assert.equal(first.ok, true);
    assert.equal(first.trashedPath, path.join(trash, "a.ts"));
    // A second item with the same name does not overwrite the first.
    await writeFile(path.join(root, "src", "a.ts"), "b");
    const second = await trashHostPath(root, "src/a.ts", trash);
    assert.notEqual(second.trashedPath, first.trashedPath);
    assert.equal((await readdir(trash)).length, 2);

    assert.deepEqual(await restoreHostPath(root, "src/a.ts", first.trashedPath!, trash), { ok: true, message: null });
    assert.equal(await readFile(path.join(root, "src", "a.ts"), "utf8"), "a");
    const blocked = await restoreHostPath(root, "src/a.ts", second.trashedPath!, trash);
    assert.equal(blocked.ok, false);
    const outside = await restoreHostPath(root, "src/x.ts", path.join(root, "src", "a.ts"), trash);
    assert.deepEqual(outside, { ok: false, message: "That item is not in the Trash." });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("paste copies under a free name and refuses a folder into itself", async () => {
  const { base, root } = await fixture();
  try {
    assert.equal((await copyHostPath(root, "src/a.ts", "src")).relativePath, "src/a copy.ts");
    assert.equal((await copyHostPath(root, "src/a.ts", "src")).relativePath, "src/a copy 2.ts");
    assert.equal((await copyHostPath(root, "src/a.ts", "")).relativePath, "a.ts");
    assert.equal((await copyHostPath(root, "src", "")).relativePath, "src copy");
    assert.equal((await copyHostPath(root, "src", "src")).ok, false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
