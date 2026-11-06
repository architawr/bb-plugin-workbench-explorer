import assert from "node:assert/strict";
import { afterAll, afterEach, beforeAll, mock, test } from "bun:test";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import type { AnchorFix } from "../shared";
import type { mountChatPathButtons } from "../lib/chat-path-buttons";
import { installDom, type DomEnvironment } from "../lib/dom-test-helper";
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

function fakeRpc(): FakeRpc {
  const calls: [string, unknown][] = [];
  return {
    calls,
    async call(method, input) {
      calls.push([method, input]);
      if (method === "resolvePaths") return { known: ["src/a.ts"] };
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
  const [signal, threadId, validate, resolveAnchors, openFixed, report] = calls[0]!;
  assert.equal(signal.aborted, false);
  assert.equal(threadId, "bridge-1");

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
