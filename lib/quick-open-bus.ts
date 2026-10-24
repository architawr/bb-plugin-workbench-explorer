/** Opens Quick Open from a command or a button; the rail draws it. */
let open = false;
const listeners = new Set<() => void>();

export function setQuickOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

export function isQuickOpen(): boolean {
  return open;
}

export function subscribeQuickOpen(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `src/app.ts:42` → the path and the line; anything else is just a query. */
export function splitLineSuffix(query: string): { query: string; line: number | null } {
  const match = /^(.*?):(\d+)(?::\d+)?$/u.exec(query.trim());
  if (match === null || match[1] === "") return { query: query.trim(), line: null };
  return { query: match[1]!, line: Number(match[2]) };
}
