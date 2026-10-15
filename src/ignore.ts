import { SKIP_FILE_NAMES, type TreeEntry } from "../shared";

export function shouldSkip(entry: TreeEntry, showSkipped: boolean, ignoredDirs: Set<string>): boolean {
  if (showSkipped) return false;
  if (entry.kind === "directory") return ignoredDirs.has(entry.name);
  return SKIP_FILE_NAMES[entry.name] === true;
}

export function sortEntries(entries: readonly TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}
