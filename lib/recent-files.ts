import type { Workspace } from "../shared";

/** What Quick Open shows before anything is typed: files opened lately, newest first. */
const MAX_RECENT = 30;
const STORAGE_PREFIX = "bb-plugin-workbench-explorer:recent:";

function storageKey(workspace: Pick<Workspace, "hostId" | "rootPath">): string {
  return `${STORAGE_PREFIX}${workspace.hostId}:${workspace.rootPath}`;
}

export function readRecentFiles(workspace: Pick<Workspace, "hostId" | "rootPath">): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(workspace)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function recordRecentFile(workspace: Pick<Workspace, "hostId" | "rootPath">, relativePath: string): void {
  if (relativePath === "") return;
  const next = [relativePath, ...readRecentFiles(workspace).filter((path) => path !== relativePath)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(storageKey(workspace), JSON.stringify(next));
  } catch {
    // Without storage the list just starts empty next time.
  }
}
