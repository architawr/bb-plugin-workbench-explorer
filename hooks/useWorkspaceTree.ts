import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { subscribeReveal } from "@/lib/reveal-bus";
import { includeRevealedChild, type VisibleReveal } from "@/lib/visible-reveal";
import { refreshGitStatus, useGitStatus } from "@/hooks/useGitStatus";
import { topLevelPaths, type VisibleRow } from "@/lib/tree-nav";
import { requestConfirm } from "@/lib/confirm-bus";
import { getFileClipboard, setFileClipboard } from "@/lib/file-clipboard";
import { type rpcContract } from "../contract";
import type { TreeEntry, Workspace } from "../shared";

function parentPath(relativePath: string): string {
  const slash = relativePath.lastIndexOf("/");
  return slash === -1 ? "" : relativePath.slice(0, slash);
}

function ancestorChain(relativePath: string): string[] {
  const chain = [""];
  let accumulated = "";
  for (const part of relativePath.split("/").filter(Boolean)) {
    accumulated = accumulated === "" ? part : `${accumulated}/${part}`;
    chain.push(accumulated);
  }
  return chain;
}

export interface Revealed {
  workspace: Workspace;
  relativePath: string;
  isDirectory: boolean;
}

/** An inline name field in the tree: renaming a row, or naming a new one. */
export type TreeEditing =
  | { kind: "rename"; path: string; isDirectory: boolean }
  | { kind: "create"; parent: string; type: "file" | "folder" };

/** What the keyboard can ask a row to do; each mounted row registers its own. */
export interface RowActions {
  open(): void;
  remove(): void;
}

type DirState =
  | { status: "loading" }
  | { status: "ready"; entries: TreeEntry[] }
  | { status: "error"; message: string };

/** Tree state belongs to the pinned navigator root, not the current route. */
export function useWorkspaceTree(root: Workspace | null) {
  const rpc = useRpc<typeof rpcContract>();
  const { values, isLoading: settingsLoading } = useSettings();
  const showSkipped = values?.showSkipped === true;
  const confirmDelete = values?.confirmDelete !== false;
  const ignoredFolders = useMemo(() => {
    const raw = values?.ignoredFolders;
    const str = typeof raw === "string" ? raw : "";
    return str.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }, [values?.ignoredFolders]);
  const [rerooted, setRerooted] = useState<Workspace | null>(null);
  const [dirs, setDirs] = useState<Record<string, DirState>>({});
  const dirsRef = useRef(dirs);
  dirsRef.current = dirs;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([""]));
  // `selected` is the focused row; `extraSelection` holds the rest of a
  // multi-selection made with ⌘/Ctrl or Shift. A plain selection clears it.
  const [selected, setFocusedRow] = useState<string | null>(null);
  const [extraSelection, setExtraSelection] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const setSelected = useCallback((value: SetStateAction<string | null>) => {
    setFocusedRow((current) => {
      const next = typeof value === "function" ? value(current) : value;
      anchor.current = next;
      return next;
    });
    setExtraSelection(new Set());
  }, []);
  const selection = useMemo(() => {
    const all = new Set(extraSelection);
    if (selected !== null) all.add(selected);
    return all as ReadonlySet<string>;
  }, [extraSelection, selected]);

  /** ⌘/Ctrl-click: add or remove one row, keeping the rest. */
  const toggleSelection = useCallback((path: string) => {
    const next = new Set(selection);
    const removing = next.has(path);
    if (removing) next.delete(path);
    else next.add(path);
    const focus = removing ? (next.values().next().value ?? null) : path;
    if (focus !== null) next.delete(focus);
    anchor.current = path;
    setFocusedRow(focus);
    setExtraSelection(next);
  }, [selection]);

  /** Shift-click or Shift+arrow: every visible row from the anchor to `path`. */
  const selectRange = useCallback((path: string, rows: readonly VisibleRow[]) => {
    const from = rows.findIndex((row) => row.relativePath === (anchor.current ?? selected ?? path));
    const to = rows.findIndex((row) => row.relativePath === path);
    if (to === -1) return;
    const [start, end] = from === -1 ? [to, to] : from < to ? [from, to] : [to, from];
    const range = new Set(rows.slice(start, end + 1).map((row) => row.relativePath));
    range.delete(path);
    setFocusedRow(path);
    setExtraSelection(range);
  }, [selected]);

  /** The folder a drag is over, highlighted until the drop or the drag leaves. */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [visibleReveal, setVisibleReveal] = useState<VisibleReveal | null>(null);
  const [editing, setEditing] = useState<TreeEditing | null>(null);
  const rowActions = useRef(new Map<string, RowActions>());

  const pinnedKey = root === null ? "" : `${root.hostId}\n${root.rootPath}`;
  useEffect(() => {
    setRerooted(null);
    setExpanded(new Set([""]));
    setSelected(null);
    setVisibleReveal(null);
    setEditing(null);
  }, [pinnedKey]);

  const active = rerooted ?? root;
  const activeRef = useRef(active);
  activeRef.current = active;
  const activeRootId = active?.rootId ?? "";
  const git = useGitStatus(active?.rootId ?? null);
  const stateKey = `${activeRootId}\n${showSkipped}\n${ignoredFolders.join("|")}`;
  const stateKeyRef = useRef(stateKey);
  stateKeyRef.current = stateKey;
  const loadVersions = useRef(new Map<string, number>());
  const visibleDirs = useMemo(() => {
    if (visibleReveal === null || visibleReveal.rootId !== activeRootId) return dirs;
    const next: Record<string, DirState> = {};
    for (const [parentPath, state] of Object.entries(dirs)) {
      next[parentPath] = state.status === "ready"
        ? { ...state, entries: includeRevealedChild(state.entries, parentPath, visibleReveal) }
        : state;
    }
    return next;
  }, [activeRootId, dirs, visibleReveal]);

  const loadDir = useCallback(
    async (workspace: Workspace, relativePath: string) => {
      const loadKey = `${workspace.rootId}\n${relativePath}`;
      const version = (loadVersions.current.get(loadKey) ?? 0) + 1;
      loadVersions.current.set(loadKey, version);
      setDirs((prev) => ({ ...prev, [relativePath]: { status: "loading" } }));
      try {
        const { entries } = await rpc.call("listDir", {
          rootId: workspace.rootId,
          relativePath,
          showSkipped,
          ignoredFolders,
        });
        if (stateKeyRef.current !== `${workspace.rootId}\n${showSkipped}\n${ignoredFolders.join("|")}` ||
          loadVersions.current.get(loadKey) !== version) return;
        setDirs((prev) => ({ ...prev, [relativePath]: { status: "ready", entries } }));
      } catch (cause) {
        if (stateKeyRef.current !== `${workspace.rootId}\n${showSkipped}\n${ignoredFolders.join("|")}` ||
          loadVersions.current.get(loadKey) !== version) return;
        setDirs((prev) => ({
          ...prev,
          [relativePath]: {
            status: "error",
            message: cause instanceof Error ? cause.message : String(cause),
          },
        }));
      }
    },
    [rpc, showSkipped, ignoredFolders],
  );

  useEffect(() => {
    loadVersions.current.clear();
    dirsRef.current = {};
    setDirs({});
  }, [activeRootId, showSkipped, ignoredFolders]);

  useEffect(() => {
    if (active === null) return;
    for (const path of expanded) {
      const current = dirsRef.current[path];
      if (current?.status === "ready" || current?.status === "loading") continue;
      void loadDir(active, path);
    }
  }, [activeRootId, expanded, loadDir, showSkipped, ignoredFolders]);

  const reveal = useCallback(
    async (
      rawPath: string,
      options?: { threadId?: string },
    ): Promise<Revealed | null> => {
      const current = activeRef.current;
      if (current === null) return null;
      let resolved;
      try {
        resolved = options?.threadId === undefined
          ? await rpc.call("resolveInRoot", { rootId: current.rootId, path: rawPath })
          : await rpc.call("resolveInWorkspace", { threadId: options.threadId, path: rawPath });
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
        return null;
      }
      if (!resolved.ok) {
        toast.error(resolved.message);
        return null;
      }

      let landedIn: Workspace;
      if (resolved.root !== null) {
        landedIn = { ...resolved.root, environmentId: null };
      } else if (options?.threadId !== undefined) {
        try {
          const threadRoot = await rpc.call("workspaceForThread", { threadId: options.threadId });
          if (!threadRoot.ok) {
            toast.error("The thread workspace is unavailable.");
            return null;
          }
          landedIn = threadRoot.workspace;
        } catch (cause) {
          toast.error(cause instanceof Error ? cause.message : String(cause));
          return null;
        }
      } else {
        landedIn = current;
      }

      const isPinned = root !== null && landedIn.hostId === root.hostId && landedIn.rootPath === root.rootPath;
      setRerooted(isPinned ? null : landedIn);
      setVisibleReveal({
        rootId: landedIn.rootId,
        relativePath: resolved.relativePath,
        isDirectory: resolved.isDirectory,
      });
      const chain = ancestorChain(resolved.relativePath);
      const toExpand = resolved.isDirectory ? chain : chain.slice(0, -1);
      setExpanded((prev) =>
        landedIn.rootId === current.rootId ? new Set([...prev, ...toExpand]) : new Set(toExpand),
      );
      setSelected(resolved.relativePath);
      return { workspace: landedIn, relativePath: resolved.relativePath, isDirectory: resolved.isDirectory };
    },
    [root, rpc],
  );

  useEffect(() => subscribeReveal(({ path, threadId }) => {
    void reveal(path, { threadId });
  }), [reveal]);

  const toggleDir = useCallback((relativePath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(relativePath)) next.delete(relativePath);
      else next.add(relativePath);
      return next;
    });
  }, []);

  const setDirExpanded = useCallback((relativePath: string, open: boolean) => {
    setExpanded((prev) => {
      if (prev.has(relativePath) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(relativePath);
      else next.delete(relativePath);
      return next;
    });
  }, []);

  /** Open the folder a new entry goes into, then show the name field at its top. */
  const startCreate = useCallback((parent: string, type: "file" | "folder") => {
    if (parent !== "") setDirExpanded(parent, true);
    setEditing({ kind: "create", parent, type });
  }, [setDirExpanded]);

  const showCreated = useCallback(async (relativePath: string) => {
    const workspace = activeRef.current;
    if (workspace === null) return;
    const chain = ancestorChain(relativePath);
    const folders = chain.slice(0, -1);
    setExpanded((prev) => new Set([...prev, ...folders]));
    await loadDir(workspace, folders[folders.length - 1] ?? "");
    setSelected(relativePath);
    refreshGitStatus(workspace.rootId);
  }, [loadDir]);

  const forgetPath = useCallback(async (relativePath: string) => {
    const workspace = activeRef.current;
    if (workspace === null) return;
    setVisibleReveal((current) =>
      current?.rootId === workspace.rootId && current.relativePath === relativePath ? null : current,
    );
    const slash = relativePath.lastIndexOf("/");
    await loadDir(workspace, slash === -1 ? "" : relativePath.slice(0, slash));
    setSelected((current) => current === relativePath ? null : current);
    refreshGitStatus(workspace.rootId);
  }, [loadDir]);

  /** Reload the folders a batch touched, once each. */
  const reloadFolders = useCallback(async (workspace: Workspace, folders: Iterable<string>) => {
    await Promise.all([...new Set(folders)].map((folder) => loadDir(workspace, folder)));
    refreshGitStatus(workspace.rootId);
  }, [loadDir]);

  /**
   * Move the dragged rows into `destination`. A row inside another dragged
   * folder travels with that folder, so it is not moved on its own.
   */
  const movePaths = useCallback(async (paths: readonly string[], destination: string) => {
    const workspace = activeRef.current;
    if (workspace === null) return;
    const roots = topLevelPaths(paths);
    const moved: string[] = [];
    const touched = new Set<string>([destination]);
    for (const path of roots) {
      try {
        const result = await rpc.call("moveEntry", { rootId: workspace.rootId, relativePath: path, destinationDirectory: destination });
        if (!result.ok) {
          toast.error(result.message);
          continue;
        }
        if (result.relativePath !== path) {
          touched.add(parentPath(path));
          moved.push(result.relativePath);
        }
      } catch {
        toast.error(`Could not move ${path}.`);
      }
    }
    if (moved.length === 0) return;
    if (destination !== "") setDirExpanded(destination, true);
    await reloadFolders(workspace, touched);
    setFocusedRow(moved[0]!);
    setExtraSelection(new Set(moved.slice(1)));
  }, [reloadFolders, rpc, setDirExpanded]);

  /**
   * Move rows to the Trash, after asking when the setting says so, and offer
   * an Undo that puts them back.
   */
  const deletePaths = useCallback(async (paths: readonly string[]) => {
    const workspace = activeRef.current;
    if (workspace === null) return;
    const targets = topLevelPaths(paths);
    if (targets.length === 0) return;
    const label = targets.length === 1 ? `"${targets[0]!.split("/").pop()}"` : `${targets.length} items`;
    if (confirmDelete && !(await requestConfirm({
      title: `Delete ${label}?`,
      description: "It goes to the Trash, and you can undo this right after.",
      confirmLabel: "Move to Trash",
    }))) return;
    const touched = new Set<string>();
    const trashed: { relativePath: string; trashedPath: string }[] = [];
    let permanent = false;
    for (const path of targets) {
      try {
        const result = await rpc.call("deleteEntry", { rootId: workspace.rootId, relativePath: path });
        if (!result.ok) {
          toast.error(result.message);
          continue;
        }
        touched.add(parentPath(path));
        if (result.trashedPath === null) permanent = true;
        else trashed.push({ relativePath: path, trashedPath: result.trashedPath });
      } catch {
        toast.error(`Could not delete ${path}.`);
      }
    }
    setSelected(null);
    await reloadFolders(workspace, touched);
    if (trashed.length === 0) {
      if (permanent) toast.success(`Deleted ${label} (this machine has no Trash).`);
      return;
    }
    toast.success(`Moved ${label} to the Trash`, {
      action: {
        label: "Undo",
        onClick: () => {
          void (async () => {
            const restored: string[] = [];
            for (const item of trashed) {
              const result = await rpc.call("restoreEntry", { rootId: workspace.rootId, ...item }).catch(() => null);
              if (result?.ok) restored.push(item.relativePath);
              else toast.error(result?.message ?? `Could not restore ${item.relativePath}.`);
            }
            if (restored.length === 0) return;
            await reloadFolders(workspace, restored.map(parentPath));
            setFocusedRow(restored[0]!);
            setExtraSelection(new Set(restored.slice(1)));
          })();
        },
      },
    });
  }, [confirmDelete, reloadFolders, rpc, setSelected]);

  /** Paste what Copy or Cut put on the tree's clipboard into `destination`. */
  const pastePaths = useCallback(async (destination: string) => {
    const workspace = activeRef.current;
    const clipboard = getFileClipboard();
    if (workspace === null || clipboard === null) return;
    if (clipboard.rootId !== workspace.rootId) {
      toast.error("Copied items belong to another folder of the explorer.");
      return;
    }
    if (clipboard.mode === "cut") {
      setFileClipboard(null);
      await movePaths(clipboard.paths, destination);
      return;
    }
    const pasted: string[] = [];
    for (const path of topLevelPaths(clipboard.paths)) {
      const result = await rpc.call("copyEntry", { rootId: workspace.rootId, relativePath: path, destinationDirectory: destination })
        .catch(() => null);
      if (result?.ok) pasted.push(result.relativePath);
      else toast.error(result?.message ?? `Could not paste ${path}.`);
    }
    if (pasted.length === 0) return;
    if (destination !== "") setDirExpanded(destination, true);
    await reloadFolders(workspace, [destination]);
    setFocusedRow(pasted[0]!);
    setExtraSelection(new Set(pasted.slice(1)));
  }, [movePaths, reloadFolders, rpc, setDirExpanded]);

  /** VS Code's "Collapse Folders in Explorer". */
  const collapseAll = useCallback(() => setExpanded(new Set([""])), []);

  const reload = useCallback(() => {
    setVisibleReveal(null);
    if (rerooted !== null) {
      setRerooted(null);
      setExpanded(new Set([""]));
      setSelected(null);
      return;
    }
    const current = activeRef.current;
    if (current === null) return;
    for (const path of expanded) void loadDir(current, path);
    refreshGitStatus(current.rootId);
  }, [expanded, loadDir, rerooted]);
  return {
    confirmDelete,
    settingsLoading,
    active,
    isRerooted: rerooted !== null,
    dirs: visibleDirs,
    gitStatus: git.byPath,
    expanded,
    selected,
    setSelected,
    selection,
    toggleSelection,
    selectRange,
    dropTarget,
    setDropTarget,
    movePaths,
    deletePaths,
    pastePaths,
    collapseAll,
    reveal,
    toggleDir,
    setDirExpanded,
    editing,
    setEditing,
    startCreate,
    rowActions: rowActions.current,
    showCreated,
    forgetPath,
    reload,
  };
}
