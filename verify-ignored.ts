import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listHostDirectory } from "./src/host-listing";

// Mirrors the `ignoredFolders` setting `default` now defined in server.ts:
// empty — users add folder names (one per line) to hide them.
const DEF: string[] = [];

const root = mkdtempSync(join(tmpdir(), "fe-verify-"));
for (const d of [".git", ".claude", "node_modules", "dist", "Docs"]) mkdirSync(join(root, d), { recursive: true });
mkdirSync(join(root, "foo"), { recursive: true });
writeFileSync(join(root, "Docs", "a.md"), "x");

const all = [".claude", ".git", "Docs", "dist", "foo", "node_modules"].sort();

const hidden = await listHostDirectory(root, "", false, DEF);
const hiddenNames = hidden.entries.map((e) => e.name).sort();
const shown = await listHostDirectory(root, "", true, DEF);
const shownNames = shown.entries.map((e) => e.name).sort();
// User adds "node_modules" and "foo": those two get hidden, the rest stay.
const withUser = await listHostDirectory(root, "", false, ["node_modules", "foo"]);
const withUserNames = withUser.entries.map((e) => e.name).sort();

const okHidden = JSON.stringify(hiddenNames) === JSON.stringify(all);
const okShown = JSON.stringify(shownNames) === JSON.stringify(all);
const okUser = JSON.stringify(withUserNames) === JSON.stringify([".claude", ".git", "Docs", "dist"].sort());

console.log("hidden(empty default hides nothing):", okHidden, hiddenNames);
console.log("shown(showSkipped still shows all):", okShown, shownNames);
console.log("withUser('node_modules' + 'foo' hidden, rest visible):", okUser, withUserNames);

rmSync(root, { recursive: true, force: true });