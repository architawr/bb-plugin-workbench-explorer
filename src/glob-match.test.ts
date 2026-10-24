import assert from "node:assert/strict";
import { test } from "bun:test";
import { anyGlobMatches, compileGlob, parseGlobs } from "./glob-match";

function matches(glob: string, path: string): boolean {
  return anyGlobMatches([compileGlob(glob)], path);
}

test("splits a comma-separated field and drops the blanks", () => {
  assert.deepEqual(parseGlobs("*.ts , src/**,,  "), ["*.ts", "src/**"]);
  assert.deepEqual(parseGlobs(""), []);
});

test("a star stays inside one segment, a double star crosses segments", () => {
  assert.equal(matches("*.ts", "src/a.ts"), true);
  assert.equal(matches("*.ts", "src/deep/a.ts"), true);
  assert.equal(matches("*.ts", "src/a.tsx"), false);
  assert.equal(matches("src/*.ts", "src/a.ts"), true);
  assert.equal(matches("src/*.ts", "src/deep/a.ts"), false);
  assert.equal(matches("src/**", "src/deep/a.ts"), true);
  assert.equal(matches("src/**", "src"), true);
  assert.equal(matches("src/**", "other/a.ts"), false);
});

test("a pattern without a slash matches the name at any depth", () => {
  assert.equal(matches("node_modules", "node_modules/pkg/index.js"), true);
  assert.equal(matches("node_modules", "deep/node_modules/pkg"), true);
  assert.equal(matches("node_modules", "deep/pkg"), false);
  assert.equal(matches("a.ts", "src/nested/a.ts"), true);
});

test("a pattern with a slash matches the path, not just the name", () => {
  assert.equal(matches("src/main.ts", "src/main.ts"), true);
  assert.equal(matches("src/main.ts", "other/src/main.ts"), false);
  assert.equal(matches("a/**/b", "a/b"), true);
  assert.equal(matches("a/**/b", "a/x/b"), true);
  assert.equal(matches("a/**/b", "a/x/y/b"), true);
  assert.equal(matches("a/**/b", "ab"), false);
  assert.equal(matches("a/**/b", "axb"), false);
});

test("a glob with a question mark or braces compiles to one matching regex", () => {
  assert.equal(matches("a?.ts", "ab.ts"), true);
  assert.equal(matches("a?.ts", "abc.ts"), false);
  assert.equal(matches("*.{ts,tsx}", "a.ts"), true);
  assert.equal(matches("*.{ts,tsx}", "a.tsx"), true);
  assert.equal(matches("*.{ts,tsx}", "a.js"), false);
});

test("an unclosed brace still compiles instead of crashing the search", () => {
  assert.equal(matches("a.{b", "a.b"), true);
  assert.equal(matches("a.{b", "a?b"), false);
});

test("parent folders are checked, so a folder name hides everything under it", () => {
  assert.equal(matches("dist", "dist/a/b.js"), true);
  assert.equal(matches("*.log", "logs/app.log"), true);
  assert.equal(matches("*.log", "src/app.ts"), false);
  // The parent of "src/a.ts" is "src", not a file whose name matches.
  assert.equal(matches("*.ts", "src/nested"), false);
});
