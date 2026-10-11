/**
 * The hand-off from a right-clicked folder in the Files tab to the Search text
 * tab. Both live in the same rail, but in different components that mount and
 * unmount as the tab changes, so the scope travels through a small in-memory
 * store: the rail reads it to switch tabs, and the search panel reads it to
 * scope its query. The last request wins, and it survives the panel being
 * unmounted — the switch happens in the same instant the tab changes.
 */

export interface FindInFolderScope {
  /** The pinned root the folder belongs to; a different root ignores it. */
  rootId: string;
  /** Folder path relative to the root; "" is the root itself. */
  folderPath: string;
}

let current: FindInFolderScope | null = null;
const listeners = new Set<() => void>();
export function requestFindInFolder(rootId: string, folderPath: string): void {
  current = { rootId, folderPath };
  for (const listener of listeners) listener();
}

/** Consume and return the pending scope, clearing it for next use. */
export function consumeFindInFolder(): FindInFolderScope | null {
  const scope = current;
  current = null;
  for (const listener of listeners) listener();
  return scope;
}

export function subscribeFindInFolder(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFindInFolder(): FindInFolderScope | null {
  return current;
}
