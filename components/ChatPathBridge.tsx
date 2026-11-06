import { useEffect, useLayoutEffect, useRef } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { mountChatPathButtons } from "@/lib/chat-path-buttons";
import { registerSurfaceNavigation } from "@/lib/surface-navigation";
import type { rpcContract } from "../contract";

/** The latest value, for callbacks that must not restart an effect. */
function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Drives the chat path scanner, which needs RPC and a thread.
 *
 * `threadId` arrives as a prop from the thread header action rather than from
 * the URL or a context hook. Parsing `/threads/<id>` out of `location` was a
 * guess about the desktop app's routing, and when it did not match the
 * scanner never started at all.
 *
 * Only a new `threadId` restarts the scanner. The thread header hands this
 * component a new `rpc` and `navigate` every few seconds; restarting on those
 * made the reveal buttons blink, so the scanner reads them through refs
 * instead. When the header remounts this component outright, the scanner
 * still restarts, and leaves its buttons in place for the next one to adopt.
 * The scanner keeps its verdicts in a module cache keyed by
 * `threadId`: another thread has its own key, because the same string may
 * exist in one workspace and not in another.
 *
 * The hidden span sits in the thread header, so in a split layout the scanner
 * can tell its own pane's messages from another pane's.
 *
 * `mount` is the scanner to start; tests pass their own.
 */
export function ChatPathBridge({
  threadId,
  mount = mountChatPathButtons,
}: {
  threadId: string;
  mount?: typeof mountChatPathButtons;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const rpcRef = useLatest(rpc);
  const navigateRef = useLatest(navigate);
  const headerRef = useRef<HTMLSpanElement>(null);

  // The window tree opens previews through whichever navigator is current.
  useEffect(() => registerSurfaceNavigation(threadId, navigate), [navigate, threadId]);

  useEffect(() => {
    const controller = new AbortController();
    mount(
      controller.signal,
      threadId,
      async (paths) => {
        const { known } = await rpcRef.current.call("resolvePaths", { threadId, paths });
        return new Set(known);
      },
      async (anchors) => {
        const { fixes } = await rpcRef.current.call("resolveFileAnchors", {
          threadId,
          anchors,
        });
        return fixes;
      },
      (fix) => {
        // The file is named from another project as often as from this one, so
        // it is addressed by host and absolute path rather than by workspace.
        navigateRef.current.experimental_openFilePreview({
          target: { kind: "host", hostId: fix.hostId, path: fix.absolutePath },
          location: null,
        });
      },
      (message) => {
        void rpcRef.current.call("clientLog", { message }).catch(() => undefined);
      },
      headerRef.current,
    );
    return () => controller.abort();
  }, [mount, threadId]);

  return <span ref={headerRef} hidden />;
}
