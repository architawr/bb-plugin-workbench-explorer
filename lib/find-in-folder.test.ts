import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { consumeFindInFolder, requestFindInFolder } from "./find-in-folder";

describe("find-in-folder store", () => {
  test("consumeFindInFolder returns the pending scope and clears the store", () => {
    requestFindInFolder("root1", "src/utils");
    const scope = consumeFindInFolder();
    assert.deepEqual(scope, { rootId: "root1", folderPath: "src/utils" });
    // Second consume is null — already cleared.
    assert.equal(consumeFindInFolder(), null);
  });

  test("consumeFindInFolder returns null when store is empty", () => {
    assert.equal(consumeFindInFolder(), null);
  });

  test("requestFindInFolder overwrites the previous scope", () => {
    requestFindInFolder("root1", "src");
    requestFindInFolder("root2", "lib");
    const scope = consumeFindInFolder();
    assert.deepEqual(scope, { rootId: "root2", folderPath: "lib" });
  });

  test("empty folderPath represents the root itself", () => {
    requestFindInFolder("root1", "");
    const scope = consumeFindInFolder();
    assert.deepEqual(scope, { rootId: "root1", folderPath: "" });
  });
});
