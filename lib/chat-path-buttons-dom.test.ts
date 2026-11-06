import assert from "node:assert/strict";
import { afterAll, afterEach, beforeAll, test } from "bun:test";
import type { AnchorFix } from "../shared";
import {
  mountChatPathButtons,
  type AnchorResolver,
  type PathValidator,
} from "./chat-path-buttons";
import { delay, installDom, waitFor, type DomEnvironment } from "./dom-test-helper";
import { subscribeReveal, type RevealRequest } from "./reveal-bus";

// The scanner runs on its real timers: a sweep 250 ms after a change, a
// request 400 ms after a sweep finds something new. Waits are sized to that.
const SLOW = 15_000;
/** Longer than a sweep plus a flush, so work that was going to happen has. */
const SETTLE_MS = 900;

const BUTTON = "button[data-file-explorer-reveal]";
const FIXED = "data-file-explorer-fixed";

let dom: DomEnvironment;
const cleanups: (() => void)[] = [];

beforeAll(() => {
  dom = installDom();
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  document.body.innerHTML = "";
});

afterAll(async () => {
  await dom.restore();
});

// The verdict and anchor caches are shared by every scanner of a thread, for
// the whole process. Each test takes thread ids of its own.
let threadSeq = 0;
function nextThread(): string {
  threadSeq += 1;
  return `dom-thread-${threadSeq}`;
}

interface Scanner {
  readonly validateCalls: string[][];
  readonly anchorCalls: { text: string; href: string }[][];
  readonly reports: string[];
  /** Fixed links this scanner opened. */
  readonly opened: AnchorFix[];
  abort(): void;
}

function startScanner(
  threadId: string,
  options: { validate?: PathValidator; resolveAnchors?: AnchorResolver; header?: Element } = {},
): Scanner {
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const scanner: Scanner = {
    validateCalls: [],
    anchorCalls: [],
    reports: [],
    opened: [],
    abort: () => controller.abort(),
  };
  mountChatPathButtons(
    controller.signal,
    threadId,
    (paths) => {
      scanner.validateCalls.push([...paths]);
      return (options.validate ?? exists())(paths);
    },
    (anchors) => {
      scanner.anchorCalls.push(anchors.map((anchor) => ({ ...anchor })));
      return (options.resolveAnchors ?? fixes())(anchors);
    },
    (fix) => {
      scanner.opened.push(fix);
    },
    (message) => {
      scanner.reports.push(message);
    },
    options.header ?? null,
  );
  return scanner;
}

/** A validator for a workspace that holds exactly `paths`. */
function exists(...paths: string[]): PathValidator {
  const present = new Set(paths);
  return async (asked) => new Set(asked.filter((path) => present.has(path)));
}

/** A resolver that knows the fixes given and finds every other link fine. */
function fixes(...known: AnchorFix[]): AnchorResolver {
  return async (asked) =>
    known.filter((fix) => asked.some((anchor) => anchor.text === fix.text && anchor.href === fix.href));
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A rendered chat message holding `html`, the scope the scanner works in. */
function message(html: string, parent: Element = document.body): HTMLElement {
  const element = document.createElement("div");
  element.className = "group/message";
  element.innerHTML = html;
  parent.appendChild(element);
  return element;
}

/** One pane of bb's split layout, with an element in its thread header. */
function splitPane(id: string): { pane: HTMLElement; header: HTMLElement } {
  const pane = document.createElement("div");
  pane.setAttribute("data-split-pane-id", id);
  const header = document.createElement("span");
  pane.appendChild(header);
  document.body.appendChild(pane);
  return { pane, header };
}

function codeNamed(container: Element, text: string): HTMLElement {
  for (const code of Array.from(container.querySelectorAll<HTMLElement>("code"))) {
    if (code.firstChild?.textContent === text) return code;
  }
  throw new Error(`no <code> named ${text}`);
}

function buttonOf(element: Element): HTMLButtonElement | null {
  return element.querySelector<HTMLButtonElement>(BUTTON);
}

function pathOf(button: HTMLButtonElement | null): string | undefined {
  return button?.dataset.fileExplorerRevealPath;
}

/** Resolves once the scanner has run its first sweep, which always reports. */
function firstSweep(scanner: Scanner): Promise<void> {
  return waitFor(() => scanner.reports.some((line) => line.startsWith("sweep ")), "the first sweep");
}

function listenReveals(): RevealRequest[] {
  const seen: RevealRequest[] = [];
  cleanups.push(subscribeReveal((request) => seen.push(request)));
  seen.length = 0;
  return seen;
}

/**
 * Counts `window.setTimeout` callbacks of one delay as they finish. The
 * scanner's request timers are 400 ms, and when one has fired the batch is on
 * the thread's chain.
 */
function countTimers(delayMs: number): () => number {
  const original = window.setTimeout;
  let fired = 0;
  const counting = (handler: TimerHandler, timeout?: number, ...rest: unknown[]): number =>
    original.call(
      window,
      () => {
        (handler as (...args: unknown[]) => void)(...rest);
        if (timeout === delayMs) fired += 1;
      },
      timeout,
    );
  window.setTimeout = counting as typeof window.setTimeout;
  cleanups.push(() => {
    window.setTimeout = original;
  });
  return () => fired;
}

const NOTES_FIX: AnchorFix = {
  text: "notes.md",
  href: "/wrong/notes.md",
  absolutePath: "/repo/docs/notes.md",
  hostId: "host-1",
  isDirectory: false,
};

const TODO_FIX: AnchorFix = {
  text: "todo.md",
  href: "/wrong/todo.md",
  absolutePath: "/repo/docs/todo.md",
  hostId: "host-1",
  isDirectory: false,
};

function notesLink(container: Element): HTMLAnchorElement {
  const anchor = container.querySelector<HTMLAnchorElement>('a[href="file:///wrong/notes.md"]');
  if (anchor === null) throw new Error("no notes link");
  return anchor;
}

const NOTES_HTML = '<a href="file:///wrong/notes.md">notes.md</a>';

/**
 * Clicks `target`, a link or a button, and tells whether the click got past
 * every scanner to bb, which would then open the link's own href.
 */
function clickReachesBb(target: Element): boolean {
  let reached = false;
  const bb = (event: Event): void => {
    reached = true;
    event.preventDefault();
  };
  target.addEventListener("click", bb);
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  target.removeEventListener("click", bb);
  return reached;
}

/** Counts reveal buttons added to or removed from the document from now on. */
function watchButtonChurn(): () => number {
  let churn = 0;
  const watch = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)]) {
        if (node instanceof Element && node.matches(BUTTON)) churn += 1;
      }
    }
  });
  watch.observe(document.body, { childList: true, subtree: true });
  cleanups.push(() => watch.disconnect());
  return () => churn;
}

test("the DOM harness gives a document, MutationObserver and window timers", async () => {
  const element = message("<code>src/a.ts</code>");
  assert.equal(document.querySelectorAll(".group\\/message code").length, 1);
  const seen: number[] = [];
  const observer = new MutationObserver((records) => {
    seen.push(records.length);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  element.appendChild(document.createElement("span"));
  await waitFor(() => seen.length > 0, "a mutation record");
  observer.disconnect();
  let fired = false;
  window.setTimeout(() => {
    fired = true;
  }, 20);
  await waitFor(() => fired, "a window timer");
});

// --- Stopping a scanner -----------------------------------------------------

test("stopping the scanner leaves its button in place", async () => {
  const code = codeNamed(message("<code>src/a.ts</code>"), "src/a.ts");
  const scanner = startScanner(nextThread(), { validate: exists("src/a.ts") });
  await waitFor(() => buttonOf(code) !== null, "the button");
  scanner.abort();
  await delay(300);
  assert.equal(pathOf(buttonOf(code)), "src/a.ts");
}, SLOW);

test("stopping the scanner leaves a link fix in place", async () => {
  const anchor = notesLink(message(NOTES_HTML));
  const scanner = startScanner(nextThread(), { resolveAnchors: fixes(NOTES_FIX) });
  await waitFor(() => anchor.hasAttribute(FIXED), "the fix");
  scanner.abort();
  await delay(300);
  assert.equal(anchor.hasAttribute(FIXED), true);
  assert.equal(anchor.dataset.fileExplorerFixedPath, "/repo/docs/notes.md");
  assert.equal(anchor.dataset.fileExplorerFixedHost, "host-1");
  assert.equal(anchor.dataset.fileExplorerFixedKey, "notes.md\n/wrong/notes.md");
}, SLOW);

test("stopping disconnects the observer and cancels the sweep that was due", async () => {
  message("<code>src/a.ts</code>");
  const Base = globalThis.MutationObserver;
  const created: MutationObserver[] = [];
  const disconnected: MutationObserver[] = [];
  class Recording extends Base {
    constructor(callback: MutationCallback) {
      super(callback);
      created.push(this);
    }
    override disconnect(): void {
      disconnected.push(this);
      super.disconnect();
    }
  }
  globalThis.MutationObserver = Recording;
  let scanner: Scanner;
  try {
    scanner = startScanner(nextThread(), { validate: exists("src/a.ts") });
    assert.equal(created.length, 1);
    assert.deepEqual(disconnected, []);
    scanner.abort();
    assert.deepEqual(disconnected, created);
  } finally {
    globalThis.MutationObserver = Base;
  }
  await delay(SETTLE_MS);
  assert.deepEqual(scanner.reports, [], "no sweep ran");
  assert.deepEqual(scanner.validateCalls, []);
}, SLOW);

test("stopping cancels the requests that were due", async () => {
  message(`<code>src/a.ts</code>${NOTES_HTML}`);
  const scanner = startScanner(nextThread());
  await firstSweep(scanner);
  scanner.abort();
  await delay(SETTLE_MS);
  assert.deepEqual(scanner.validateCalls, []);
  assert.deepEqual(scanner.anchorCalls, []);
}, SLOW);

test("a request queued behind one in flight is dropped once the scanner stops", async () => {
  const container = message(`<code>src/a.ts</code>${NOTES_HTML}`);
  const paths = deferred<Set<string>>();
  const anchors = deferred<AnchorFix[]>();
  const scanner = startScanner(nextThread(), {
    validate: () => paths.promise,
    resolveAnchors: () => anchors.promise,
  });
  await waitFor(
    () => scanner.validateCalls.length === 1 && scanner.anchorCalls.length === 1,
    "both first requests in flight",
  );
  const requestTimers = countTimers(400);
  // New names arrive while the first requests are out, so the next batch of
  // each kind waits on the thread's chain behind them.
  container.insertAdjacentHTML(
    "beforeend",
    '<code>src/b.ts</code><a href="file:///wrong/other.md">other.md</a>',
  );
  await waitFor(() => requestTimers() >= 2, "the second batches queued");
  scanner.abort();
  paths.resolve(new Set());
  anchors.resolve([]);
  await delay(100);
  assert.equal(scanner.validateCalls.length, 1);
  assert.equal(scanner.anchorCalls.length, 1);
}, SLOW);

test("an answer that arrives after the stop is cached but changes nothing on screen", async () => {
  const threadId = nextThread();
  const container = message(`<code>src/a.ts</code>${NOTES_HTML}`);
  const code = codeNamed(container, "src/a.ts");
  const anchor = notesLink(container);
  const paths = deferred<Set<string>>();
  const anchors = deferred<AnchorFix[]>();
  const scanner = startScanner(threadId, {
    validate: () => paths.promise,
    resolveAnchors: () => anchors.promise,
  });
  await waitFor(
    () => scanner.validateCalls.length === 1 && scanner.anchorCalls.length === 1,
    "both requests in flight",
  );
  scanner.abort();
  const before = document.body.innerHTML;
  const reported = scanner.reports.length;
  paths.resolve(new Set(["src/a.ts"]));
  anchors.resolve([NOTES_FIX]);
  await delay(SETTLE_MS);
  assert.equal(document.body.innerHTML, before);
  assert.equal(scanner.reports.length, reported);

  // The answers were kept: the next scanner on the thread draws them unasked.
  const next = startScanner(threadId);
  await firstSweep(next);
  assert.equal(pathOf(buttonOf(code)), "src/a.ts");
  assert.equal(anchor.dataset.fileExplorerFixedPath, "/repo/docs/notes.md");
  await delay(SETTLE_MS);
  assert.deepEqual(next.validateCalls, []);
  assert.deepEqual(next.anchorCalls, []);
}, SLOW);

test("a click on a button left by a stopped scanner reaches no scanner", async () => {
  const code = codeNamed(message("<code>src/a.ts</code>"), "src/a.ts");
  const scanner = startScanner(nextThread(), { validate: exists("src/a.ts") });
  await waitFor(() => buttonOf(code) !== null, "the button");
  scanner.abort();
  const reveals = listenReveals();
  buttonOf(code)?.click();
  assert.deepEqual(reveals, []);
}, SLOW);

// --- Taking over from a previous scanner ------------------------------------

test("a remount on the same thread keeps the button element and asks nothing", async () => {
  const threadId = nextThread();
  const code = codeNamed(message("<code>src/a.ts</code>"), "src/a.ts");
  const first = startScanner(threadId, { validate: exists("src/a.ts") });
  await waitFor(() => buttonOf(code) !== null, "the first button");
  const button = buttonOf(code);
  first.abort();

  const second = startScanner(threadId);
  await firstSweep(second);
  assert.equal(buttonOf(code), button);
  await delay(SETTLE_MS);
  assert.equal(buttonOf(code), button);
  assert.equal(code.querySelectorAll(BUTTON).length, 1);
  assert.deepEqual(second.validateCalls, []);
}, SLOW);

test("the new scanner answers clicks on a leftover button before and after its first sweep", async () => {
  const threadId = nextThread();
  const code = codeNamed(message("<code>src/a.ts</code>"), "src/a.ts");
  const first = startScanner(threadId, { validate: exists("src/a.ts") });
  await waitFor(() => buttonOf(code) !== null, "the first button");
  first.abort();
  const reveals = listenReveals();

  const second = startScanner(threadId);
  assert.deepEqual(second.reports, [], "the first sweep has not run yet");
  buttonOf(code)?.click();
  assert.deepEqual(reveals, [{ path: "src/a.ts", threadId }]);

  await firstSweep(second);
  buttonOf(code)?.click();
  assert.deepEqual(reveals, [
    { path: "src/a.ts", threadId },
    { path: "src/a.ts", threadId },
  ]);
}, SLOW);

test("before its first sweep the new scanner leaves a click on a leftover button whose link or code changed to bb", async () => {
  const threadId = nextThread();
  const container = message(
    '<a href="file:///repo/old.ts">old.ts<svg></svg></a> <a href="file:///repo/same.ts">same.ts<svg></svg></a> <code>src/old.ts</code>',
  );
  const [changed, same] = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"));
  const code = codeNamed(container, "src/old.ts");
  const first = startScanner(threadId, { validate: exists("/repo/old.ts", "/repo/same.ts", "src/old.ts") });
  await waitFor(() => container.querySelectorAll(BUTTON).length === 3, "the three buttons");
  first.abort();
  // React kept the link and the code, and their buttons, but not what they say.
  changed!.setAttribute("href", "file:///repo/new.ts");
  code.firstChild!.textContent = "src/new.ts";
  const reveals = listenReveals();

  const second = startScanner(threadId);
  assert.deepEqual(second.reports, [], "the first sweep has not run yet");
  assert.equal(clickReachesBb(buttonOf(changed!)!), true, "changed link");
  assert.equal(clickReachesBb(buttonOf(code)!), true, "changed code");
  assert.deepEqual(reveals, []);
  assert.equal(clickReachesBb(buttonOf(same!)!), false, "unchanged link");
  assert.deepEqual(reveals, [{ path: "/repo/same.ts", threadId }]);
  assert.deepEqual(second.opened, []);
}, SLOW);

test("answers that land while the new scanner's batch waits are still drawn", async () => {
  const threadId = nextThread();
  const code = codeNamed(message("<code>src/a.ts</code>"), "src/a.ts");
  const answer = deferred<Set<string>>();
  const first = startScanner(threadId, { validate: () => answer.promise });
  await waitFor(() => first.validateCalls.length === 1, "the first request in flight");
  first.abort();

  const requestTimers = countTimers(400);
  const second = startScanner(threadId);
  // Its own batch for the same path is now queued behind the first request.
  await waitFor(() => requestTimers() >= 1, "the new scanner's batch queued");
  answer.resolve(new Set(["src/a.ts"]));
  await waitFor(() => buttonOf(code) !== null, "the button the earlier answer allows");
  assert.equal(pathOf(buttonOf(code)), "src/a.ts");
  assert.deepEqual(second.validateCalls, []);
}, SLOW);

test("a code whose text no longer names a path loses its leftover button on the first sweep", async () => {
  const threadId = nextThread();
  const code = codeNamed(message("<code>src/a.ts</code>"), "src/a.ts");
  const first = startScanner(threadId, { validate: exists("src/a.ts") });
  await waitFor(() => buttonOf(code) !== null, "the first button");
  first.abort();
  code.firstChild!.textContent = "not a path at all";

  const second = startScanner(threadId);
  await firstSweep(second);
  assert.equal(buttonOf(code), null);
}, SLOW);

test("a leftover button for a path cached as missing goes on the first sweep", async () => {
  const threadId = nextThread();
  const code = codeNamed(message("<code>src/a.ts</code>"), "src/a.ts");
  // This thread's workspace has no src/a.ts, and the cache already says so.
  const warm = startScanner(threadId);
  await waitFor(() => warm.validateCalls.length === 1, "the thread's own answer");
  await delay(50);
  warm.abort();
  // Another thread's scanner drew a button for it.
  const other = startScanner(nextThread(), { validate: exists("src/a.ts") });
  await waitFor(() => buttonOf(code) !== null, "the other thread's button");
  other.abort();

  const second = startScanner(threadId);
  await firstSweep(second);
  assert.equal(buttonOf(code), null);
  await delay(SETTLE_MS);
  assert.deepEqual(second.validateCalls, []);
}, SLOW);

test("a leftover button for a path not yet asked stays until the answer, then follows it", async () => {
  const container = message("<code>src/a.ts</code> and <code>src/b.ts</code>");
  const codeA = codeNamed(container, "src/a.ts");
  const codeB = codeNamed(container, "src/b.ts");
  const other = startScanner(nextThread(), { validate: exists("src/a.ts", "src/b.ts") });
  await waitFor(() => buttonOf(codeA) !== null && buttonOf(codeB) !== null, "both buttons");
  other.abort();
  const buttonA = buttonOf(codeA);
  const buttonB = buttonOf(codeB);

  const answer = deferred<Set<string>>();
  const second = startScanner(nextThread(), { validate: () => answer.promise });
  await firstSweep(second);
  assert.equal(buttonOf(codeA), buttonA);
  assert.equal(buttonOf(codeB), buttonB);
  await waitFor(() => second.validateCalls.length === 1, "the request");
  assert.equal(buttonOf(codeA), buttonA);
  assert.equal(buttonOf(codeB), buttonB);

  answer.resolve(new Set(["src/b.ts"]));
  await waitFor(() => buttonOf(codeA) === null, "the missing path's button to go");
  assert.equal(buttonOf(codeB), buttonB);
  assert.equal(pathOf(buttonOf(codeB)), "src/b.ts");
}, SLOW);

test("a leftover button for another path is replaced when the current path exists", async () => {
  const threadId = nextThread();
  const container = message("<code>src/a.ts</code> and <code>src/b.ts</code>");
  const code = codeNamed(container, "src/a.ts");
  const first = startScanner(threadId, { validate: exists("src/a.ts", "src/b.ts") });
  await waitFor(() => container.querySelectorAll(BUTTON).length === 2, "both buttons");
  first.abort();
  const stale = buttonOf(code);
  code.firstChild!.textContent = "src/b.ts";
  assert.equal(pathOf(buttonOf(code)), "src/a.ts");

  const second = startScanner(threadId);
  await firstSweep(second);
  const current = buttonOf(code);
  assert.notEqual(current, stale);
  assert.equal(pathOf(current), "src/b.ts");
  assert.equal(code.querySelectorAll(BUTTON).length, 1);
}, SLOW);

test("a leftover button in a link's code moves onto the link when bb gives the link its preview glyph", async () => {
  const threadId = nextThread();
  const container = message('<a href="file:///repo/a.ts"><code>/repo/a.ts</code></a>');
  const anchor = container.querySelector<HTMLAnchorElement>("a")!;
  const code = codeNamed(container, "/repo/a.ts");
  const first = startScanner(threadId, { validate: exists("/repo/a.ts") });
  await waitFor(() => buttonOf(code) !== null, "the button on the code");
  const button = buttonOf(code)!;
  first.abort();
  // React kept the code and its button, and bb added its glyph to the link.
  anchor.insertAdjacentHTML("beforeend", "<svg></svg>");

  const second = startScanner(threadId);
  await firstSweep(second);
  assert.equal(button.parentElement, anchor, "the same button, now the link's");
  assert.equal(container.querySelectorAll(BUTTON).length, 1);
  const reveals = listenReveals();
  assert.equal(clickReachesBb(button), false);
  assert.deepEqual(reveals, [{ path: "/repo/a.ts", threadId }]);
  await delay(SETTLE_MS);
  assert.equal(container.querySelectorAll(BUTTON).length, 1);
  assert.deepEqual(second.validateCalls, []);
}, SLOW);

test("a link that gains and then loses bb's preview glyph keeps one working button", async () => {
  const threadId = nextThread();
  const container = message('<a href="file:///repo/a.ts"><code>/repo/a.ts</code></a>');
  const anchor = container.querySelector<HTMLAnchorElement>("a")!;
  const code = codeNamed(container, "/repo/a.ts");
  const scanner = startScanner(threadId, { validate: exists("/repo/a.ts") });
  await waitFor(() => buttonOf(code) !== null, "the button on the code");
  const button = buttonOf(code)!;
  anchor.insertAdjacentHTML("beforeend", "<svg></svg>");
  const glyph = anchor.lastElementChild!;
  await waitFor(() => button.parentElement === anchor, "the button on the link");
  glyph.remove();
  await waitFor(() => button.parentElement === code, "the same button back on the code");
  await delay(SETTLE_MS);
  assert.equal(container.querySelectorAll(BUTTON).length, 1);
  const reveals = listenReveals();
  assert.equal(clickReachesBb(button), false);
  assert.deepEqual(reveals, [{ path: "/repo/a.ts", threadId }]);
  assert.equal(scanner.validateCalls.length, 1);
}, SLOW);

test("a leftover button for another path goes on the first sweep when the current path is not yet known", async () => {
  const threadId = nextThread();
  const code = codeNamed(message("<code>src/old.ts</code>"), "src/old.ts");
  const first = startScanner(threadId, { validate: exists("src/old.ts") });
  await waitFor(() => buttonOf(code) !== null, "the first button");
  first.abort();
  code.firstChild!.textContent = "src/new.ts";

  const second = startScanner(threadId, {
    validate: async () => {
      throw new Error("offline");
    },
  });
  await firstSweep(second);
  assert.equal(buttonOf(code), null);
  await waitFor(() => second.validateCalls.length === 1, "the lookup for the new path");
  assert.deepEqual(second.validateCalls[0], ["src/new.ts"]);
  await delay(SETTLE_MS);
  assert.equal(buttonOf(code), null);
}, SLOW);

test("a remount for another thread asks about every path and drops what that workspace lacks", async () => {
  const container = message("<code>src/a.ts</code> and <code>src/b.ts</code>");
  const codeA = codeNamed(container, "src/a.ts");
  const codeB = codeNamed(container, "src/b.ts");
  const first = startScanner(nextThread(), { validate: exists("src/a.ts", "src/b.ts") });
  await waitFor(() => container.querySelectorAll(BUTTON).length === 2, "both buttons");
  first.abort();

  const second = startScanner(nextThread(), { validate: exists("src/b.ts") });
  await waitFor(() => second.validateCalls.length === 1, "the new thread's request");
  assert.deepEqual([...(second.validateCalls[0] ?? [])].sort(), ["src/a.ts", "src/b.ts"]);
  await waitFor(() => buttonOf(codeA) === null, "the button the new workspace lacks to go");
  assert.equal(pathOf(buttonOf(codeB)), "src/b.ts");
}, SLOW);

test("a fixed link whose key is still cached keeps its fix without asking", async () => {
  const threadId = nextThread();
  const anchor = notesLink(message(NOTES_HTML));
  const first = startScanner(threadId, { resolveAnchors: fixes(NOTES_FIX) });
  await waitFor(() => anchor.hasAttribute(FIXED), "the fix");
  first.abort();

  const second = startScanner(threadId);
  assert.equal(clickReachesBb(anchor), false, "answered before the first sweep");
  assert.deepEqual(second.opened.map((fix) => fix.absolutePath), ["/repo/docs/notes.md"]);
  await firstSweep(second);
  assert.equal(anchor.dataset.fileExplorerFixedPath, "/repo/docs/notes.md");
  await delay(SETTLE_MS);
  assert.equal(anchor.hasAttribute(FIXED), true);
  assert.deepEqual(second.anchorCalls, []);
}, SLOW);

test("a link fixed for another thread is left to bb by the next thread's scanner, even when its lookups fail", async () => {
  const anchor = notesLink(message(NOTES_HTML));
  const first = startScanner(nextThread(), {
    resolveAnchors: fixes({ ...NOTES_FIX, absolutePath: "/project-A/notes.md", hostId: "host-A" }),
  });
  await waitFor(() => anchor.hasAttribute(FIXED), "the first thread's fix");
  first.abort();

  const second = startScanner(nextThread(), {
    resolveAnchors: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(clickReachesBb(anchor), true, "before the first sweep");
  await waitFor(() => second.anchorCalls.length === 1, "the failed lookup");
  await delay(100);
  assert.equal(anchor.hasAttribute(FIXED), false);
  assert.equal(anchor.dataset.fileExplorerFixedPath, undefined);
  assert.equal(anchor.dataset.fileExplorerFixedHost, undefined);
  assert.equal(clickReachesBb(anchor), true, "after the failed lookup");
  assert.deepEqual(first.opened, []);
  assert.deepEqual(second.opened, []);
}, SLOW);

test("a fixed link whose text or href changed loses the fix at once and is asked again", async () => {
  const threadId = nextThread();
  const container = message(`${NOTES_HTML} <a href="file:///wrong/todo.md">todo.md</a>`);
  const notes = notesLink(container);
  const todo = container.querySelector<HTMLAnchorElement>('a[href="file:///wrong/todo.md"]')!;
  const first = startScanner(threadId, { resolveAnchors: fixes(NOTES_FIX, TODO_FIX) });
  await waitFor(() => notes.hasAttribute(FIXED) && todo.hasAttribute(FIXED), "both fixes");
  first.abort();
  // bb's own preview links carry an absolute href rather than a file: URL.
  notes.setAttribute("href", "/changed/notes.md");
  todo.firstChild!.textContent = "todo-2.md";

  const answer = deferred<AnchorFix[]>();
  const second = startScanner(threadId, { resolveAnchors: () => answer.promise });
  assert.equal(clickReachesBb(notes), true, "changed href, before the first sweep");
  assert.equal(clickReachesBb(todo), true, "changed text, before the first sweep");
  assert.deepEqual(second.opened, []);
  await firstSweep(second);
  assert.equal(notes.hasAttribute(FIXED), false);
  assert.equal(notes.dataset.fileExplorerFixedPath, undefined);
  assert.equal(todo.hasAttribute(FIXED), false);
  assert.equal(todo.dataset.fileExplorerFixedKey, undefined);
  await waitFor(() => second.anchorCalls.length === 1, "the new keys asked");
  const asked = (second.anchorCalls[0] ?? []).map((anchor) => `${anchor.text} ${anchor.href}`).sort();
  assert.deepEqual(asked, ["notes.md /changed/notes.md", "todo-2.md /wrong/todo.md"]);

  answer.resolve([
    { ...NOTES_FIX, href: "/changed/notes.md", absolutePath: "/repo/changed/notes.md" },
    { ...TODO_FIX, text: "todo-2.md", absolutePath: "/repo/docs/todo-2.md" },
  ]);
  await waitFor(
    () => notes.hasAttribute(FIXED) && todo.hasAttribute(FIXED),
    "the replacement fixes on both links",
  );
  assert.equal(notes.dataset.fileExplorerFixedPath, "/repo/changed/notes.md");
  assert.equal(notes.dataset.fileExplorerFixedKey, "notes.md\n/changed/notes.md");
  assert.equal(todo.dataset.fileExplorerFixedPath, "/repo/docs/todo-2.md");
  assert.equal(todo.dataset.fileExplorerFixedKey, "todo-2.md\n/wrong/todo.md");
}, SLOW);

test("a link with an absolute file href is fixed like a file: link; a protocol-relative one is never asked", async () => {
  const container = message(
    '<a href="/wrong/notes.md">notes.md</a> <a href="//example.com/todo.md">todo.md</a>',
  );
  const notes = container.querySelector<HTMLAnchorElement>('a[href="/wrong/notes.md"]')!;
  const remote = container.querySelector<HTMLAnchorElement>('a[href="//example.com/todo.md"]')!;
  const scanner = startScanner(nextThread(), { resolveAnchors: fixes(NOTES_FIX) });
  await waitFor(() => notes.hasAttribute(FIXED), "the fix on the absolute link");
  assert.equal(notes.dataset.fileExplorerFixedPath, "/repo/docs/notes.md");
  await delay(SETTLE_MS);
  assert.deepEqual(scanner.anchorCalls, [[{ text: "notes.md", href: "/wrong/notes.md" }]]);
  assert.equal(remote.hasAttribute(FIXED), false);
}, SLOW);

test("a fixed link whose key is cached as fine loses the fix on the first sweep", async () => {
  const threadId = nextThread();
  const anchor = notesLink(message(NOTES_HTML));
  // In this thread bb's own link is fine, and the cache already says so.
  const warm = startScanner(threadId);
  await waitFor(() => warm.anchorCalls.length === 1, "the thread's own answer");
  await delay(50);
  warm.abort();
  assert.equal(anchor.hasAttribute(FIXED), false);
  // Another thread's scanner fixed the link.
  const other = startScanner(nextThread(), { resolveAnchors: fixes(NOTES_FIX) });
  await waitFor(() => anchor.hasAttribute(FIXED), "the other thread's fix");
  other.abort();

  const second = startScanner(threadId);
  await firstSweep(second);
  assert.equal(anchor.hasAttribute(FIXED), false);
  assert.equal(anchor.dataset.fileExplorerFixedPath, undefined);
  await delay(SETTLE_MS);
  assert.deepEqual(second.anchorCalls, []);
}, SLOW);

test("a fixed link whose href is no longer a file path loses the fix on the first sweep", async () => {
  const threadId = nextThread();
  const anchor = notesLink(message(NOTES_HTML));
  const first = startScanner(threadId, { resolveAnchors: fixes(NOTES_FIX) });
  await waitFor(() => anchor.hasAttribute(FIXED), "the fix");
  first.abort();
  anchor.setAttribute("href", "https://example.com/notes.md");

  const second = startScanner(threadId);
  assert.equal(clickReachesBb(anchor), true, "before the first sweep");
  assert.deepEqual(second.opened, []);
  await firstSweep(second);
  assert.equal(anchor.hasAttribute(FIXED), false);
  assert.equal(anchor.dataset.fileExplorerFixedPath, undefined);
  assert.equal(anchor.dataset.fileExplorerFixedHost, undefined);
}, SLOW);

// --- Scanners side by side --------------------------------------------------

test("scanners for two split panes leave each other's buttons and fixes alone", async () => {
  // One scanner per visible thread, each sweeping every message in the
  // document: nothing marks which pane a message is in.
  const paneA = message(`<code>src/a.ts</code> ${NOTES_HTML}`);
  const paneB = message("<code>src/b.ts</code>");
  const codeA = codeNamed(paneA, "src/a.ts");
  const codeB = codeNamed(paneB, "src/b.ts");
  const anchor = notesLink(paneA);
  // Pane A's scanner starts first, so pane B's sweeps run after it: thread B
  // has its own answer for the link, and sees thread A's fix in place.
  const a = startScanner(nextThread(), {
    validate: exists("src/a.ts"),
    resolveAnchors: fixes({ ...NOTES_FIX, absolutePath: "/project-A/notes.md", hostId: "host-A" }),
  });
  const b = startScanner(nextThread(), {
    validate: exists("src/b.ts"),
    resolveAnchors: fixes({ ...NOTES_FIX, absolutePath: "/project-B/notes.md", hostId: "host-B" }),
  });
  await waitFor(
    () =>
      a.validateCalls.length > 0 && b.validateCalls.length > 0 &&
      a.anchorCalls.length > 0 && b.anchorCalls.length > 0,
    "both threads' answers",
  );
  await delay(SETTLE_MS);

  const churn = watchButtonChurn();
  const buttonA = buttonOf(codeA);
  const buttonB = buttonOf(codeB);
  await delay(1500);
  assert.equal(churn(), 0, "no button added or removed while the chat is idle");
  assert.equal(pathOf(buttonA), "src/a.ts");
  assert.equal(pathOf(buttonB), "src/b.ts");
  assert.equal(buttonOf(codeA), buttonA);
  assert.equal(buttonOf(codeB), buttonB);
  assert.equal(anchor.dataset.fileExplorerFixedPath, "/project-A/notes.md");
  assert.equal(clickReachesBb(anchor), false);
  assert.equal(a.opened.length, 1);
  assert.deepEqual(b.opened, []);

  // Once pane A's scanner stops, pane B's adopts what it left: it drops what
  // thread B lacks and puts its own answer on the link, with no chat change.
  a.abort();
  await waitFor(() => buttonOf(codeA) === null, "the stopped thread's button to go");
  await waitFor(
    () => anchor.dataset.fileExplorerFixedPath === "/project-B/notes.md",
    "thread B's fix on the link",
  );
  assert.equal(buttonOf(codeB), buttonB);
  assert.equal(clickReachesBb(anchor), false);
  assert.deepEqual(b.opened.map((fix) => fix.absolutePath), ["/project-B/notes.md"]);
  assert.equal(a.opened.length, 1);
}, SLOW);

test("in bb's split panes each thread answers its own pane's links and buttons, even when another thread answers first", async () => {
  const left = splitPane("pane-left");
  const right = splitPane("pane-right");
  const codeA = codeNamed(message("<code>src/shared.ts</code>", left.pane), "src/shared.ts");
  const paneB = message(`<code>src/shared.ts</code> <a href="/B/notes.md">notes.md</a>`, right.pane);
  const codeB = codeNamed(paneB, "src/shared.ts");
  const anchor = paneB.querySelector<HTMLAnchorElement>("a")!;
  const threadA = nextThread();
  const threadB = nextThread();
  // On thread A's host /B/notes.md is missing and A has a notes.md of its own;
  // on thread B's host the link works, but B is slow to say so.
  const a = startScanner(threadA, {
    header: left.header,
    validate: exists("src/shared.ts"),
    resolveAnchors: fixes({
      ...NOTES_FIX,
      href: "/B/notes.md",
      absolutePath: "/A/notes.md",
      hostId: "host-A",
    }),
  });
  const answerB = deferred<AnchorFix[]>();
  const b = startScanner(threadB, {
    header: right.header,
    validate: exists("src/shared.ts"),
    resolveAnchors: () => answerB.promise,
  });
  await waitFor(() => b.anchorCalls.length === 1, "thread B's question");
  await delay(SETTLE_MS);
  assert.deepEqual(a.anchorCalls, [], "thread A never asks about pane B's link");
  assert.equal(anchor.hasAttribute(FIXED), false);

  answerB.resolve([]);
  await delay(SETTLE_MS);
  assert.equal(anchor.hasAttribute(FIXED), false);
  assert.equal(clickReachesBb(anchor), true);
  assert.deepEqual(a.opened, []);
  assert.deepEqual(b.opened, []);

  const buttonA = buttonOf(codeA);
  const buttonB = buttonOf(codeB);
  assert.equal(buttonA?.dataset.fileExplorerThread, threadA);
  assert.equal(buttonB?.dataset.fileExplorerThread, threadB);
  const churn = watchButtonChurn();
  await delay(1500);
  assert.equal(churn(), 0, "no button added or removed while the chat is idle");
  assert.equal(buttonOf(codeA), buttonA);
  assert.equal(buttonOf(codeB), buttonB);

  const reveals = listenReveals();
  buttonB?.click();
  buttonA?.click();
  assert.deepEqual(reveals, [
    { path: "src/shared.ts", threadId: threadB },
    { path: "src/shared.ts", threadId: threadA },
  ]);
}, SLOW);

test("a pane's new scanner reconciles what another pane's scanner adopted there while the pane had none", async () => {
  const left = splitPane("pane-left");
  const right = splitPane("pane-right");
  const code = codeNamed(message("<code>src/a.ts</code>", left.pane), "src/a.ts");
  const a = startScanner(nextThread(), { header: left.header, validate: exists("src/a.ts") });
  const threadB = nextThread();
  startScanner(threadB, { header: right.header, validate: exists("src/a.ts") });
  await waitFor(() => buttonOf(code) !== null, "pane A's button");

  // With pane A's scanner gone, pane B's adopts the button it left.
  a.abort();
  await waitFor(() => buttonOf(code)?.dataset.fileExplorerThread === threadB, "pane B's adoption");

  // Pane A shows a thread whose workspace lacks the path.
  const c = startScanner(nextThread(), { header: left.header, validate: exists() });
  await waitFor(() => buttonOf(code) === null, "the new thread to drop the button");
  await delay(SETTLE_MS);
  assert.equal(buttonOf(code), null);
  assert.deepEqual(c.validateCalls, [["src/a.ts"]]);
}, SLOW);
