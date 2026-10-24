/** ⌘⇧F: show the rail on its Search tab with the query field focused. */
const EVENT = "bb-plugin-workbench-explorer:text-search";

let pending = false;

export function requestTextSearch(): void {
  pending = true;
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** True once per request, for a panel that mounts after the request was made. */
export function consumeTextSearchRequest(): boolean {
  const was = pending;
  pending = false;
  return was;
}

export function subscribeTextSearch(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
