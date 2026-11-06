import assert from "node:assert/strict";
import { afterAll, afterEach, beforeAll, mock, test } from "bun:test";
import { act, createElement, Fragment } from "react";
import type { Root } from "react-dom/client";
import type { AnchorFix } from "../shared";
import { mountChatPathButtons } from "../lib/chat-path-buttons";
import { delay, installDom, waitFor, type DomEnvironment } from "../lib/dom-test-helper";
import { subscribeReveal, type RevealRequest } from "../lib/reveal-bus";
import { surfaceNavigation } from "../lib/surface-navigation";

type Mount = typeof mountChatPathButtons;
type MountArgs = Parameters<Mount>;

interface FakeRpc {
  readonly calls: [string, unknown][];
  call(method: string, input: unknown): Promise<unknown>;
}

interface FakeNavigate {
  readonly opened: unknown[];
  experimental_openFilePreview(options: unknown): boolean;
}

/** An rpc for a workspace that holds exactly `existing`. */
function fakeRpc(...existing: string[]): FakeRpc {
  const present = new Set(existing.length > 0 ? existing : ["src/a.ts"]);
  const calls: [string, unknown][] = [];
  return {
    calls,
    async call(method, input) {
      calls.push([method, input]);
      if (method === "resolvePaths") {
        return { known: (input as { paths: string[] }).paths.filter((path) => present.has(path)) };
      }
      if (method === "resolveFileAnchors") return { fixes: [] };
      return {};
    },
  };
}

function fakeNavigate(): FakeNavigate {
  const opened: unknown[] = [];
  return {
    opened,
    experimental_openFilePreview(options) {
      opened.push(options);
      return true;
    },
  };
}

// What bb's runtime hands the component on its current render. Only this
// module is mocked: no other test file imports it, and module mocks are
// process-wide.
let currentRpc: FakeRpc = fakeRpc();
let currentNavigate: FakeNavigate = fakeNavigate();
mock.module("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => currentRpc,
  useBbNavigate: () => currentNavigate,
}));

let dom: DomEnvironment;
let ChatPathBridge: typeof import("./ChatPathBridge").ChatPathBridge;
let createRoot: typeof import("react-dom/client").createRoot;
const roots: Root[] = [];

beforeAll(async () => {
  dom = installDom();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // After the document exists and the SDK is mocked.
  ({ createRoot } = await import("react-dom/client"));
  ({ ChatPathBridge } = await import("./ChatPathBridge"));
});

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  document.body.innerHTML = "";
});

afterAll(async () => {
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  await dom.restore();
});

/** A scanner stand-in that records each start and what it was given. */
function recordMounts(): { calls: MountArgs[]; mount: Mount } {
  const calls: MountArgs[] = [];
  return {
    calls,
    mount: (...args) => {
      calls.push(args);
    },
  };
}

function createTestRoot(): Root {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  return root;
}

async function render(root: Root, threadId: string, mount: Mount): Promise<void> {
  await act(async () => {
    root.render(createElement(ChatPathBridge, { threadId, mount }));
  });
}

/**
 * Past every sweep the scanner had queued: one that finds work can queue two
 * more, 750 ms apart. After that only a change in the chat wakes it.
 */
const IDLE_MS = 2000;

const FIX: AnchorFix = {
  text: "notes.md",
  href: "/wrong/notes.md",
  absolutePath: "/repo/docs/notes.md",
  hostId: "host-1",
  isDirectory: false,
};

test("a re-render with a new rpc and navigate keeps the scanner and points it at the new ones", async () => {
  const { calls, mount } = recordMounts();
  const root = createTestRoot();
  const firstRpc = fakeRpc();
  const firstNavigate = fakeNavigate();
  currentRpc = firstRpc;
  currentNavigate = firstNavigate;
  await render(root, "bridge-1", mount);
  assert.equal(calls.length, 1);

  const secondRpc = fakeRpc();
  const secondNavigate = fakeNavigate();
  currentRpc = secondRpc;
  currentNavigate = secondNavigate;
  await render(root, "bridge-1", mount);
  assert.equal(calls.length, 1, "the scanner was not restarted");
  const [signal, threadId, validate, resolveAnchors, openFixed, report, header] = calls[0]!;
  assert.equal(signal.aborted, false);
  assert.equal(threadId, "bridge-1");
  // The scanner finds the thread's pane from an element in its header.
  assert.equal(header?.isConnected, true);
  assert.equal((header as HTMLElement).hidden, true);

  assert.deepEqual([...(await validate(["src/a.ts", "src/b.ts"]))], ["src/a.ts"]);
  assert.deepEqual(await resolveAnchors([{ text: "notes.md", href: "/wrong/notes.md" }]), []);
  report!("sweep known=1");
  openFixed(FIX);
  await Promise.resolve();

  assert.deepEqual(firstRpc.calls, []);
  assert.deepEqual(firstNavigate.opened, []);
  assert.deepEqual(secondRpc.calls, [
    ["resolvePaths", { threadId: "bridge-1", paths: ["src/a.ts", "src/b.ts"] }],
    ["resolveFileAnchors", { threadId: "bridge-1", anchors: [{ text: "notes.md", href: "/wrong/notes.md" }] }],
    ["clientLog", { message: "sweep known=1" }],
  ]);
  assert.deepEqual(secondNavigate.opened, [{
    target: { kind: "host", hostId: "host-1", path: "/repo/docs/notes.md" },
    location: null,
  }]);
  assert.equal(surfaceNavigation("bridge-1"), secondNavigate);
});

test("a new thread stops the old scanner and starts one for the new thread", async () => {
  const { calls, mount } = recordMounts();
  const root = createTestRoot();
  currentRpc = fakeRpc();
  currentNavigate = fakeNavigate();
  await render(root, "bridge-2", mount);
  await render(root, "bridge-3", mount);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]![0].aborted, true);
  assert.equal(calls[1]![0].aborted, false);
  assert.equal(calls[1]![1], "bridge-3");
  assert.equal(surfaceNavigation("bridge-2"), null);
  assert.equal(surfaceNavigation("bridge-3"), currentNavigate);
});

test("unmounting stops the scanner and drops the thread's navigator", async () => {
  const { calls, mount } = recordMounts();
  const root = createTestRoot();
  currentRpc = fakeRpc();
  currentNavigate = fakeNavigate();
  await render(root, "bridge-4", mount);
  assert.equal(surfaceNavigation("bridge-4"), currentNavigate);
  await act(async () => root.unmount());
  roots.splice(roots.indexOf(root), 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![0].aborted, true);
  assert.equal(surfaceNavigation("bridge-4"), null);
});

test("a link whose href alone changes gets a button for its new file from the scanner that keeps running", async () => {
  const signals: AbortSignal[] = [];
  // One identity for every render, as the default has, so only a new thread restarts it.
  const mount: Mount = (...args) => {
    signals.push(args[0]);
    mountChatPathButtons(...args);
  };
  // The header and a message React owns, with one of bb's preview links.
  const view = (href: string, label: string) =>
    createElement(
      Fragment,
      null,
      createElement(ChatPathBridge, { threadId: "bridge-5", mount }),
      createElement("div", { className: "group/message" }, createElement("a", { href }, label, createElement("svg"))),
    );
  const root = createTestRoot();
  currentRpc = fakeRpc("/repo/old.ts", "/repo/new.ts");
  currentNavigate = fakeNavigate();
  await act(async () => root.render(view("file:///repo/old.ts", "old.ts")));
  const anchor = document.querySelector<HTMLAnchorElement>(".group\\/message a")!;
  const buttonPath = (): string | undefined =>
    anchor.querySelector<HTMLElement>("button[data-file-explorer-reveal]")?.dataset.fileExplorerRevealPath;
  await waitFor(() => buttonPath() === "/repo/old.ts", "the button for the old file");
  await delay(IDLE_MS);

  // bb's next render: a new rpc and navigate, and the same link with a new href.
  const nextRpc = fakeRpc("/repo/old.ts", "/repo/new.ts");
  currentRpc = nextRpc;
  currentNavigate = fakeNavigate();
  await act(async () => root.render(view("file:///repo/new.ts", "old.ts")));
  assert.equal(document.querySelector(".group\\/message a"), anchor, "React kept the link");
  await waitFor(() => buttonPath() === "/repo/new.ts", "the button for the new file");
  assert.equal(signals.length, 1, "the scanner was not restarted");
  assert.equal(signals[0]!.aborted, false);
  assert.equal(anchor.querySelectorAll("button[data-file-explorer-reveal]").length, 1);
  const asked = nextRpc.calls.filter(([method]) => method === "resolvePaths").map(([, input]) => input);
  assert.deepEqual(asked, [{ threadId: "bridge-5", paths: ["/repo/new.ts"] }]);
  const reveals: RevealRequest[] = [];
  const unsubscribe = subscribeReveal((request) => reveals.push(request));
  reveals.length = 0;
  anchor.querySelector<HTMLElement>("button[data-file-explorer-reveal]")!.click();
  unsubscribe();
  assert.deepEqual(reveals, [{ path: "/repo/new.ts", threadId: "bridge-5" }]);

  await delay(IDLE_MS);

  // A new label alone is a text change, not a new child, and is asked about too.
  await act(async () => root.render(view("file:///repo/new.ts", "new.ts")));
  assert.equal(document.querySelector(".group\\/message a"), anchor, "React kept the link");
  const anchorsAsked = (): unknown[] =>
    nextRpc.calls.filter(([method]) => method === "resolveFileAnchors").map(([, input]) => input);
  await waitFor(
    () => JSON.stringify(anchorsAsked()).includes('"text":"new.ts"'),
    "the link's new label asked about",
  );
  assert.deepEqual(anchorsAsked().at(-1), {
    threadId: "bridge-5",
    anchors: [{ text: "new.ts", href: "/repo/new.ts" }],
  });
  assert.equal(signals.length, 1, "the scanner was not restarted");
}, 15_000);
