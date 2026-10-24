import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useBbContext, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { fuzzyPositions } from "@/lib/fuzzy";
import { openWorkspaceFile } from "@/lib/open-preview";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { isQuickOpen, setQuickOpen, splitLineSuffix, subscribeQuickOpen } from "@/lib/quick-open-bus";
import { readRecentFiles } from "@/lib/recent-files";
import { surfaceNavigation } from "@/lib/surface-navigation";
import { cn } from "@/lib/utils";
import type { rpcContract } from "../contract";
import type { Workspace } from "../shared";

const DEBOUNCE_MS = 120;
const LIMIT = 50;

interface Item {
  relativePath: string;
  name: string;
  folder: string;
}

function toItem(relativePath: string): Item {
  const slash = relativePath.lastIndexOf("/");
  return {
    relativePath,
    name: slash === -1 ? relativePath : relativePath.slice(slash + 1),
    folder: slash === -1 ? "" : relativePath.slice(0, slash),
  };
}

/** The name with the letters the query matched in bold, without injecting HTML. */
function MatchedName({ name, query }: { name: string; query: string }) {
  const positions = query === "" ? null : fuzzyPositions(name, query);
  if (positions === null || positions.length === 0) return <>{name}</>;
  const marked = new Set(positions);
  return (
    <>
      {[...name].map((char, index) =>
        marked.has(index)
          ? <span key={index} className="font-semibold" style={{ color: "var(--brand, currentColor)" }}>{char}</span>
          : <span key={index}>{char}</span>,
      )}
    </>
  );
}

/**
 * VS Code's Quick Open (⌘P): find any file in the pinned folder by a few
 * letters of its name, in order. Empty, it lists the files opened lately.
 * `name:42` opens on line 42.
 */
export function QuickOpen({ root }: { root: Workspace | null }) {
  const open = useSyncExternalStore(subscribeQuickOpen, isQuickOpen, isQuickOpen);
  if (!open) return null;
  return <QuickOpenDialog root={root} />;
}

function QuickOpenDialog({ root }: { root: Workspace | null }) {
  const rpc = useRpc<typeof rpcContract>();
  const { threadId } = useBbContext();
  const portalScopeProps = usePortalScopeProps();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [raw, setRaw] = useState("");
  const [found, setFound] = useState<Item[] | null>(null);
  const [active, setActive] = useState(0);
  const { query, line } = splitLineSuffix(raw);

  const recent = useMemo(() => (root === null ? [] : readRecentFiles(root).map(toItem)), [root]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (root === null || query === "") {
      setFound(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      rpc.call("quickOpen", { rootId: root.rootId, query, limit: LIMIT })
        .then(({ hits }) => {
          if (!cancelled) setFound(hits.map((hit) => toItem(hit.relativePath)));
        })
        .catch(() => {
          if (!cancelled) setFound([]);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rpc, root, query]);

  const items = query === "" ? recent : found ?? [];
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const close = () => setQuickOpen(false);
  const choose = (item: Item | undefined) => {
    if (item === undefined || root === null) return;
    close();
    const navigation = surfaceNavigation(threadId);
    if (!openWorkspaceFile(navigation, root, item.relativePath, undefined, "preview", line)) {
      toast.error(navigation === null ? "Open a thread or New Thread page to open files." : "Could not open the file.");
    }
  };

  return createPortal(
    <div
      {...portalScopeProps}
      className="fixed inset-0 z-[49] flex justify-center [app-region:no-drag] [-webkit-app-region:no-drag]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-label="Go to file"
        className="mt-[10vh] flex h-fit max-h-[60vh] w-[min(600px,92vw)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
      >
        <input
          ref={inputRef}
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          placeholder={root === null ? "Choose a folder in the File Explorer first" : `Go to file in ${root.rootName} (name:line goes to a line)`}
          disabled={root === null}
          spellCheck={false}
          autoComplete="off"
          aria-label="File name"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, items.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(items[active]);
            }
          }}
          className="w-full border-b border-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div ref={listRef} role="listbox" className="min-h-0 overflow-y-auto py-1">
          {query === "" && items.length > 0 ? (
            <p className="px-3 pb-1 pt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">Recently opened</p>
          ) : null}
          {items.map((item, index) => (
            <button
              key={item.relativePath}
              type="button"
              role="option"
              aria-selected={index === active}
              data-index={index}
              onMouseMove={() => setActive(index)}
              onClick={() => choose(item)}
              className={cn(
                "flex w-full min-w-0 items-center gap-2 px-3 py-1 text-left text-[13px]",
                index === active && "bg-state-active",
              )}
            >
              <FileTypeIcon name={item.name} className="size-4" />
              <span className="shrink-0"><MatchedName name={item.name} query={query} /></span>
              <span className="min-w-0 truncate text-xs text-muted-foreground/70">{item.folder}</span>
            </button>
          ))}
          {query !== "" && found !== null && items.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No matching files.</p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
