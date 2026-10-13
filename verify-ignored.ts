import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listHostDirectory } from "./src/host-listing";

// Mirrors the `ignoredFolders` setting `default` now defined in server.ts.
const DEF = [
  ".git", ".claude", "node_modules", "dist", "build", "coverage",
  ".next", ".turbo", ".cache", "__pycache__", ".venv", "venv",
];

const root = mkdtempSync(join(tmpdir(), "fe-verify-"));
for (const d of [".git", ".claude", "node_modules", "dist", "Docs"]) mkdirSync(join(root, d), { recursive: true });
mkdirSync(join(root, "foo"), { recursive: true });
writeFileSync(join(root, "Docs", "a.md"), "x");

const hidden = await listHostDirectory(root, "", false, DEF);
const hiddenNames = hidden.entries.map((e) => e.name).sort();
const shown = await listHostDirectory(root, "", true, DEF);
const shownNames = shown.entries.map((e) => e.name).sort();
const withUser = await listHostDirectory(root, "", false, [...DEF, "foo"]);
const withUserNames = withUser.entries.map((e) => e.name).sort();

const okHidden = JSON.stringify(hiddenNames) === JSON.stringify(["Docs"]);
const okShown = JSON.stringify(shownNames) === JSON.stringify([".c", ".claude", ".git", "Docs", "foo"].sort());
// shown: .git, .claude, node_modules, dist hidden-by? no, showSkipped=true -> all visible
const okUser = JSON.stringify(withUserNames) === JSON.stringify(["Docs"]);

// Set-equivalence: old model `new Set([...DEF, ...userLines])` (seed+user) vs
// new model where the setting value already contains DEF + user lines.
const userLines = "foo\nbar";
const oldModel = new Set([...DEF, ...userLines.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)]);
const newModel = new Set([...DEF, "foo", "bar"]);
const okSetEq = [...oldModel].sort().join("|") === [...newModel].sort().join("|");

console.log("hidden(defaults only Docs):", okHidden);
console.log("shown(all):", okShown);
console.log("withUser(appended 'foo' still hidden as a folder? 'foo' is a dir user added -> should be hidden):", okUser, withUserNames);
console.log("setEq(seed+user == preloaded+user):", okSetEq);

rmSync(root, { recursive: true, force: true });
