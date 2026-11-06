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
  options: { validate?: PathValidator; resolveAnchors?: AnchorResolver } = {},
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
function message(html: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "group/message";
  element.innerHTML = html;
  document.body.appendChild(element);
  return element;
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
 * Clicks `anchor` and tells whether the click got past every scanner to bb,
 * which would then open the link's own href.
 */
function clickReachesBb(anchor: HTMLAnchorElement): boolean {
  let reached = false;
  const bb = (event: Event): void => {
    reached = true;
    event.preventDefault();
  };
  anchor.addEventListener("click", bb);
  anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  anchor.removeEventListener("click", bb);
  return reached;
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
  await firstSweep(second);
  assert.equal(anchor.hasAttribute(FIXED), false);
  assert.equal(anchor.dataset.fileExplorerFixedPath, undefined);
  assert.equal(anchor.dataset.fileExplorerFixedHost, undefined);
}, SLOW);

// --- Scanners side by side --------------------------------------------------

test("scanners for two split panes leave each other's buttons and fixes alone", async () => {
  // One scanner per visible thread, each sweeping every message in the document.
  const paneA = message(`<code>src/a.ts</code> ${NOTES_HTML}`);
  const paneB = message("<code>src/b.ts</code>");
  const codeA = codeNamed(paneA, "src/a.ts");
  const codeB = codeNamed(paneB, "src/b.ts");
  const anchor = notesLink(paneA);
  // Pane A's scanner starts first, so pane B's sweeps run after it: thread B,
  // where bb's link is fine, sees thread A's fix in place.
  const a = startScanner(nextThread(), {
    validate: exists("src/a.ts"),
    resolveAnchors: fixes(NOTES_FIX),
  });
  const b = startScanner(nextThread(), { validate: exists("src/b.ts") });
  await waitFor(
    () =>
      a.validateCalls.length > 0 && b.validateCalls.length > 0 &&
      a.anchorCalls.length > 0 && b.anchorCalls.length > 0,
    "both threads' answers",
  );
  await delay(SETTLE_MS);

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
  const buttonA = buttonOf(codeA);
  const buttonB = buttonOf(codeB);
  await delay(1500);
  assert.equal(churn, 0, "no button added or removed while the chat is idle");
  assert.equal(pathOf(buttonA), "src/a.ts");
  assert.equal(pathOf(buttonB), "src/b.ts");
  assert.equal(buttonOf(codeA), buttonA);
  assert.equal(buttonOf(codeB), buttonB);
  assert.equal(anchor.dataset.fileExplorerFixedPath, "/repo/docs/notes.md");
  assert.equal(clickReachesBb(anchor), false);
  assert.equal(a.opened.length, 1);
  assert.deepEqual(b.opened, []);

  // Once pane A's scanner stops, pane B's adopts what it left and drops what
  // thread B lacks on its next sweep.
  a.abort();
  paneB.appendChild(document.createElement("span"));
  await waitFor(() => buttonOf(codeA) === null, "the stopped thread's button to go");
  assert.equal(anchor.hasAttribute(FIXED), false);
  assert.equal(buttonOf(codeB), buttonB);
}, SLOW);
