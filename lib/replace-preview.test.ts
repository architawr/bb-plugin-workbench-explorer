import assert from "node:assert/strict";
import { test } from "bun:test";
import { previewReplace } from "./replace-preview";

const plain = { matchCase: false, wholeWord: false, useRegex: false };

test("every match is shown struck and followed by its replacement", () => {
  assert.deepEqual(previewReplace("foo bar foo", "foo", plain, "baz"), [
    { kind: "old", text: "foo" }, { kind: "new", text: "baz" },
    { kind: "same", text: " bar " },
    { kind: "old", text: "foo" }, { kind: "new", text: "baz" },
  ]);
});

test("a literal replacement keeps $ signs; a regex one expands groups", () => {
  assert.deepEqual(previewReplace("a=1", "a", plain, "$&$1")?.[1], { kind: "new", text: "$&$1" });
  const regex = { matchCase: true, wholeWord: false, useRegex: true };
  assert.deepEqual(previewReplace("get(user)", "(\\w+)\\((\\w+)\\)", regex, "$2.$1()")?.[1], { kind: "new", text: "user.get()" });
});

test("deleting shows only the struck text; a broken pattern shows no preview", () => {
  assert.deepEqual(previewReplace("x-y", "-", plain, ""), [
    { kind: "same", text: "x" }, { kind: "old", text: "-" }, { kind: "same", text: "y" },
  ]);
  assert.equal(previewReplace("x", "(", { ...plain, useRegex: true }, "y"), null);
});
