/**
 * A browser document for tests that drive DOM code, installed on demand.
 *
 * `bun test` runs every test file in one process with one `globalThis`, so a
 * file that needs a document installs it in `beforeAll` and calls `restore()`
 * in `afterAll`. The other test files keep seeing the globals they had,
 * including no `window` at all.
 */
import type { UnderlyingSource } from "node:stream/web";
import { Window } from "happy-dom";

// happy-dom's declarations name `UnderlyingDefaultSource`, which newer
// @types/node exports and the version this repository pins does not. Declare
// it as the general source type it narrows, so the helper typechecks.
declare module "node:stream/web" {
  interface UnderlyingDefaultSource<R = any> extends UnderlyingSource<R> {}
}

/** Globals DOM code reads without going through `window.`. */
const GLOBAL_NAMES = [
  "window",
  "document",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLAnchorElement",
  "HTMLButtonElement",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "MutationObserver",
  "getComputedStyle",
  "localStorage",
] as const;

type GlobalName = (typeof GLOBAL_NAMES)[number];

export interface DomEnvironment {
  readonly window: Window;
  /** Put back every global this install replaced and close the window. */
  restore(): Promise<void>;
}

export function installDom(url = "http://localhost/"): DomEnvironment {
  const window = new Window({ url });
  const source = window as unknown as Record<GlobalName, unknown>;
  const saved = new Map<GlobalName, PropertyDescriptor | undefined>();
  for (const name of GLOBAL_NAMES) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    let value: unknown = name === "window" ? window : source[name];
    if (name === "getComputedStyle") value = window.getComputedStyle.bind(window);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  let restored = false;
  return {
    window,
    async restore() {
      if (restored) return;
      restored = true;
      for (const name of GLOBAL_NAMES) {
        const previous = saved.get(name);
        if (previous) Object.defineProperty(globalThis, name, previous);
        else Reflect.deleteProperty(globalThis, name);
      }
      await window.happyDOM.abort();
      window.close();
    },
  };
}

/** Poll `condition` until it holds, failing with `message` after `timeoutMs`. */
export async function waitFor(
  condition: () => boolean,
  message: string,
  timeoutMs = 4000,
): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${message}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
