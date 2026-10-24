/**
 * The tree's own clipboard for files: Copy or Cut remembers paths, Paste
 * copies or moves them. Shared by every row and the keyboard handler.
 */
export interface FileClipboard {
  rootId: string;
  paths: readonly string[];
  mode: "copy" | "cut";
}

let current: FileClipboard | null = null;
const listeners = new Set<() => void>();

export function setFileClipboard(next: FileClipboard | null): void {
  current = next;
  for (const listener of listeners) listener();
}

export function getFileClipboard(): FileClipboard | null {
  return current;
}

export function subscribeFileClipboard(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
