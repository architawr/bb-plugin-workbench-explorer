import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { useBbContext, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { FileTypeIcon, FolderTypeIcon } from "@/components/FileTypeIcon";
import { STATUS_BADGE, STATUS_LABEL, STATUS_TEXT } from "@/lib/git-status";
import { Icon } from "@/components/ui/icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { openWorkspaceFile } from "@/lib/open-preview";
import { surfaceNavigation } from "@/lib/surface-navigation";
import {
  getChatTargets,
  requestAddToChat,
  subscribeChatTargets,
  type ChatTarget,
} from "@/lib/chat-draft-bus";
import { requestFindInFolder } from "@/lib/find-in-folder";
import { horizontalAction, moveSelection, renameSelectionEnd, visibleRows } from "@/lib/tree-nav";
import type { rpcContract } from "../contract";
import type { TreeEntry, Workspace } from "../shared";
import type { RowActions, TreeEditing, useWorkspaceTree } from "@/hooks/useWorkspaceTree";

type TreeModel = ReturnType<typeof useWorkspaceTree>;

function absolutePathOf(workspace: Workspace, relativePath: string): string {
  const root = workspace.rootPath.replace(/\/+$/u, "");
  return relativePath === "" ? root : `${root}/${relativePath}`;
}

function makeCopyPathToClipboard(
  rpc: PluginRpcClient<typeof rpcContract>,
  workspace: Workspace,
) {
  return (text: string, successMessage: string): void => {
    void rpc
      .call("copyTextToClipboard", {
        rootId: workspace.rootId,
        text,
      })
      .then((result) => {
        if (result.ok) toast.success(successMessage);
        else toast.error(result.message);
      })
      .catch(() => {
        toast.error("Could not copy to the clipboard.");
      });
  };
}

/** Folder a new file should land in: the row itself if it is a folder, else its parent. */
function directoryOf(entry: TreeEntry): string {
  if (entry.kind === "directory") return entry.relativePath;
  const slash = entry.relativePath.lastIndexOf("/");
  return slash === -1 ? "" : entry.relativePath.slice(0, slash);
}

function targetLabel(
  target: ChatTarget,
  activeThreadId: string | null,
): string {
  switch (target.scope.kind) {
    case "thread":
      return target.scope.threadId === activeThreadId
        ? "main thread"
        : `thread ${target.scope.threadId.slice(-6)}`;
    case "side-chat":
      return `side chat ${target.scope.tabId.slice(-6)}`;
    case "queued-message":
      return `queued message ${target.scope.queuedMessageId.slice(-6)}`;
    case "new-thread":
      return "new thread";
  }
}

/**
 * Create a file and open it in BB's editor, as VS Code opens a file it just
 * created. False keeps the name field open so the user can fix the name.
 */
async function createAndOpenFile(args: {
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>;
  navigate: ReturnType<typeof useBbNavigate> | null;
  workspace: Workspace;
  directoryRelativePath: string;
  name: string;
  showCreated: (relativePath: string) => Promise<void>;
}): Promise<boolean> {
  try {
    const result = await args.rpc.call("createFile", {
      rootId: args.workspace.rootId,
      directoryRelativePath: args.directoryRelativePath,
      name: args.name,
    });
    if (!result.ok) {
      toast.error(result.message);
      return false;
    }
    await args.showCreated(result.relativePath);
    openWorkspaceFile(args.navigate, args.workspace, result.relativePath, (message) => {
      void args.rpc.call("clientLog", { message }).catch(() => undefined);
    });
    return true;
  } catch {
    toast.error("Could not create the file.");
    return false;
  }
}

async function createFolderNamed(args: {
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>;
  workspace: Workspace;
  directoryRelativePath: string;
  name: string;
  showCreated: (relativePath: string) => Promise<void>;
}): Promise<boolean> {
  try {
    const result = await args.rpc.call("createFolder", {
      rootId: args.workspace.rootId,
      directoryRelativePath: args.directoryRelativePath,
      name: args.name,
    });
    if (!result.ok) {
      toast.error(result.message);
      return false;
    }
    await args.showCreated(result.relativePath);
    return true;
  } catch {
    toast.error("Could not create the folder.");
    return false;
  }
}

const SETTLE_MS = 300;

/**
 * The name field VS Code puts in a tree row. Enter or leaving the field
 * commits, Escape cancels; a rejected name keeps the field open.
 */
function InlineNameInput({
  initial,
  selectEnd,
  onCommit,
  onCancel,
  onDraft,
}: {
  initial: string;
  selectEnd: number;
  onCommit: (name: string) => Promise<boolean>;
  onCancel: () => void;
  onDraft?: (name: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const busy = useRef(false);
  // A context menu that opened this field is still closing when it mounts,
  // and its focus trap pulls focus back for a moment. Until things settle, a
  // lost focus is taken back rather than read as "done editing".
  const settlesAt = useRef(0);

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    settlesAt.current = Date.now() + SETTLE_MS;
    const focus = () => {
      if (document.activeElement === input) return;
      input.focus();
      input.setSelectionRange(0, selectEnd);
    };
    focus();
    const timers = [0, 50, 150, SETTLE_MS].map((delay) => setTimeout(focus, delay));
    return () => timers.forEach(clearTimeout);
  }, [selectEnd]);

  const commit = async () => {
    if (busy.current) return;
    const name = value.trim();
    if (name === "" || name === initial) {
      onCancel();
      return;
    }
    busy.current = true;
    const done = await onCommit(name);
    busy.current = false;
    if (!done) inputRef.current?.focus();
  };

  return (
    <input
      ref={inputRef}
      value={value}
      spellCheck={false}
      aria-label="Name"
      onChange={(event) => {
        setValue(event.target.value);
        onDraft?.(event.target.value);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          void commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => {
        if (Date.now() < settlesAt.current) return;
        void commit();
      }}
      onClick={(event) => event.stopPropagation()}
      className="min-w-0 flex-1 rounded-[2px] border border-ring bg-background px-1 text-[11px] leading-[18px] outline-none"
    />
  );
}

/** The row a new file or folder is named in, at the top of its folder. */
function CreateRow({
  depth,
  editing,
  workspace,
  tree,
}: {
  depth: number;
  editing: Extract<TreeEditing, { kind: "create" }>;
  workspace: Workspace;
  tree: TreeModel;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const { threadId } = useBbContext();
  const [draft, setDraft] = useState("");
  const onCommit = async (name: string) => {
    const args = { rpc, workspace, directoryRelativePath: editing.parent, name, showCreated: tree.showCreated };
    const done = editing.type === "file"
      ? await createAndOpenFile({ ...args, navigate: surfaceNavigation(threadId) })
      : await createFolderNamed(args);
    if (done) tree.setEditing(null);
    return done;
  };
  return (
    <div className="flex w-full min-w-0 items-center gap-0.5 py-px pr-1" style={{ paddingLeft: 4 + depth * 10 }}>
      <span className="size-3 shrink-0" />
      {editing.type === "folder" ? (
        <FolderTypeIcon name={draft} expanded={false} className="size-4" />
      ) : (
        <FileTypeIcon name={draft} className="size-4" />
      )}
      <InlineNameInput
        initial=""
        selectEnd={0}
        onDraft={setDraft}
        onCommit={onCommit}
        onCancel={() => tree.setEditing(null)}
      />
    </div>
  );
}

function TreeRow({
  entry,
  depth,
  workspace,
  tree,
  chatTargets,
  activeThreadId,
}: {
  entry: TreeEntry;
  depth: number;
  workspace: Workspace;
  tree: TreeModel;
  chatTargets: readonly ChatTarget[];
  activeThreadId: string | null;
}) {
  const overlayNavigate = useBbNavigate();
  const { threadId } = useBbContext();
  const rpc = useRpc<typeof rpcContract>();
  const isDir = entry.kind === "directory";
  const isOpen = isDir && tree.expanded.has(entry.relativePath);
  const isSelected = tree.selected === entry.relativePath;
  const childState = isOpen ? tree.dirs[entry.relativePath] : undefined;
  // A row git would not track is dimmed the way an editor draws an ignored
  // path, and says so in the tooltip. A label on every ignored row would cost
  // the name the narrow rail needs.
  const isIgnored = entry.gitIgnored === true;
  // VS Code's Git decoration: the name takes the change's colour, a file ends
  // with its status letter, and a folder holding changes ends with a dot.
  const gitStatus = isIgnored ? undefined : tree.gitStatus.get(entry.relativePath);
  const rowRef = useRef<HTMLButtonElement>(null);

  // A reveal can land far below the fold, so bring the row into view once it
  // becomes the selected one.
  useEffect(() => {
    if (!isSelected) return;
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isSelected]);

  const onActivate = () => {
    tree.setSelected(entry.relativePath);
    if (isDir) {
      tree.toggleDir(entry.relativePath);
      return;
    }
    const navigation = surfaceNavigation(threadId);
    const opened = openWorkspaceFile(
      navigation,
      workspace,
      entry.relativePath,
      (message) => {
        void rpc.call("clientLog", { message }).catch(() => undefined);
      },
    );
    if (!opened)
      toast.error(
        navigation === null
          ? "Open a thread or New Thread page to preview files."
          : "Could not open the file preview.",
      );
  };

  const addToChat = (targetKey: string) => {
    if (
      !requestAddToChat(
        targetKey,
        absolutePathOf(workspace, entry.relativePath),
      )
    ) {
      toast.error("That chat draft is no longer open.");
    }
  };

  const osPath = {
    rootId: workspace.rootId,
    relativePath: entry.relativePath,
  };

  const openInFinder = () => {
    void rpc
      .call("revealInExplorer", osPath)
      .then((result) => {
        if (!result.ok) toast.error(result.message);
      })
      .catch(() => {
        toast.error("Could not open in Explorer.");
      });
  };

  const copyPathToClipboard = makeCopyPathToClipboard(rpc, workspace);

  // Radix hands focus back to the row when its menu closes, which would blur
  // the name field a menu item just opened. Those items opt out.
  const keepFocusAfterMenu = useRef(false);
  const createFile = () => {
    keepFocusAfterMenu.current = true;
    tree.startCreate(directoryOf(entry), "file");
  };
  const createFolder = () => {
    keepFocusAfterMenu.current = true;
    tree.startCreate(directoryOf(entry), "folder");
  };

  const deleteThisEntry = () => {
    if (tree.confirmDelete && !window.confirm(`Delete ${entry.name}?`)) return;
    void rpc
      .call("deleteEntry", {
        rootId: workspace.rootId,
        relativePath: entry.relativePath,
      })
      .then(async (result) => {
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        await tree.forgetPath(result.relativePath);
      })
      .catch(() => {
        toast.error("Could not delete the item.");
      });
  };

  const renameThisEntry = () => {
    keepFocusAfterMenu.current = true;
    tree.setSelected(entry.relativePath);
    tree.setEditing({ kind: "rename", path: entry.relativePath, isDirectory: isDir });
  };

  const commitRename = async (newName: string): Promise<boolean> => {
    try {
      const result = await rpc.call("renameEntry", {
        rootId: workspace.rootId,
        relativePath: entry.relativePath,
        newName,
      });
      if (!result.ok) {
        toast.error(result.message);
        return false;
      }
      tree.setEditing(null);
      await tree.showCreated(result.relativePath);
      return true;
    } catch {
      toast.error("Could not rename the item.");
      return false;
    }
  };

  // The keyboard handler lives on the tree; it reaches a row's own open and
  // delete through this registration. A ref keeps it pointing at this
  // render's closures without re-registering every render.
  const actionsRef = useRef<RowActions>({ open: onActivate, remove: deleteThisEntry });
  actionsRef.current = { open: onActivate, remove: deleteThisEntry };
  useEffect(() => {
    const actions: RowActions = {
      open: () => actionsRef.current.open(),
      remove: () => actionsRef.current.remove(),
    };
    tree.rowActions.set(entry.relativePath, actions);
    return () => {
      if (tree.rowActions.get(entry.relativePath) === actions) tree.rowActions.delete(entry.relativePath);
    };
  }, [tree.rowActions, entry.relativePath]);

  const isRenaming = tree.editing?.kind === "rename" && tree.editing.path === entry.relativePath;
  const creating = tree.editing?.kind === "create" && tree.editing.parent === entry.relativePath && isDir
    ? tree.editing
    : null;

  const findInFolder = () => {
    if (!isDir) return;
    requestFindInFolder(workspace.rootId, entry.relativePath);
  };

  const chevron = (
    <span
      className={cn(
        "flex size-3 shrink-0 items-center justify-center text-muted-foreground",
        isIgnored && "opacity-50",
      )}
    >
      {isDir ? (
        <Icon name={isOpen ? "ChevronDown" : "ChevronRight"} className="size-2.5" />
      ) : null}
    </span>
  );
  const typeIcon = isDir ? (
    <FolderTypeIcon name={entry.name} expanded={isOpen} className={cn("size-4", isIgnored && "opacity-45")} />
  ) : (
    <FileTypeIcon name={entry.name} className={cn("size-4", isIgnored && "opacity-45")} />
  );

  return (
    <div>
      {isRenaming ? (
        <div
          className="flex w-full min-w-0 items-center gap-0.5 rounded-[3px] bg-state-active py-px pr-1"
          style={{ paddingLeft: 4 + depth * 10 }}
        >
          {chevron}
          {typeIcon}
          <InlineNameInput
            initial={entry.name}
            selectEnd={renameSelectionEnd(entry.name, isDir)}
            onCommit={commitRename}
            onCancel={() => tree.setEditing(null)}
          />
        </div>
      ) : (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            ref={rowRef}
            type="button"
            role="treeitem"
            aria-selected={isSelected}
            aria-expanded={isDir ? isOpen : undefined}
            data-tree-path={entry.relativePath}
            onClick={onActivate}
            title={
              isIgnored
                ? `${entry.relativePath} — ignored by git`
                : gitStatus !== undefined
                  ? `${entry.relativePath} · ${isDir ? "Contains changes" : STATUS_LABEL[gitStatus]}`
                  : entry.relativePath
            }
            className={cn(
              "flex w-full min-w-0 items-center gap-0.5 rounded-[3px] py-px pr-1 text-left text-[11px] leading-5",
              "hover:bg-state-hover",
              isSelected && "bg-state-active font-medium",
            )}
            style={{ paddingLeft: 4 + depth * 10 }}
          >
            {chevron}
            {typeIcon}
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                isIgnored && "text-muted-foreground/50",
                gitStatus !== undefined && STATUS_TEXT[gitStatus],
              )}
            >
              {entry.name}
            </span>
            {gitStatus === undefined ? null : (
              <span
                aria-label={isDir ? "Contains changes" : STATUS_LABEL[gitStatus]}
                className={cn(
                  "shrink-0 pl-1 font-mono text-[10px] leading-5",
                  STATUS_TEXT[gitStatus],
                )}
              >
                {isDir ? "•" : STATUS_BADGE[gitStatus]}
              </span>
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent
          className="w-56"
          onCloseAutoFocus={(event) => {
            if (!keepFocusAfterMenu.current) return;
            keepFocusAfterMenu.current = false;
            event.preventDefault();
          }}
        >
          {chatTargets.map((target) => (
            <ContextMenuItem
              key={target.key}
              onSelect={() => addToChat(target.key)}
            >
              <Icon name="MessageSquarePlus" className="size-4" />
              {chatTargets.length === 1
                ? "Add to chat"
                : `Add to ${targetLabel(target, activeThreadId)}`}
            </ContextMenuItem>
          ))}
          <ContextMenuItem onSelect={openInFinder}>
            <Icon name="FolderOpen" className="size-4" />
            Open in Explorer
          </ContextMenuItem>
          {isDir ? (
            <ContextMenuItem onSelect={findInFolder}>
              <Icon name="Search" className="size-4" />
              Find in Folder
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem onSelect={createFile}>
            <Icon name="FileText" className="size-4" />
            Create File
          </ContextMenuItem>
          <ContextMenuItem onSelect={createFolder}>
            <Icon name="FolderPlus" className="size-4" />
            Create Folder
          </ContextMenuItem>
          <ContextMenuItem onSelect={renameThisEntry}>
            <Icon name="EditFile" className="size-4" />
            {isDir ? "Rename Folder" : "Rename File"}
          </ContextMenuItem>
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={deleteThisEntry}
          >
            <Icon name="Trash2" className="size-4" />
            {isDir ? "Delete folder" : "Delete file"}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => {
              copyPathToClipboard(entry.relativePath, "Relative path copied");
            }}
          >
            <Icon name="Copy" className="size-4" />
            Copy Relative Path
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              copyPathToClipboard(
                absolutePathOf(workspace, entry.relativePath),
                "Path copied",
              );
            }}
          >
            <Icon name="Copy" className="size-4" />
            Copy Path
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      )}
      {creating !== null && isOpen ? (
        <CreateRow depth={depth + 1} editing={creating} workspace={workspace} tree={tree} />
      ) : null}
      {isOpen && childState?.status === "loading" ? (
        <p
          className="py-0.5 pr-1 text-[11px] text-muted-foreground"
          style={{ paddingLeft: 20 + (depth + 1) * 10 }}
        >
          …
        </p>
      ) : null}
      {isOpen && childState?.status === "error" ? (
        <p
          className="py-0.5 pr-1 text-[11px] text-destructive"
          style={{ paddingLeft: 20 + (depth + 1) * 10 }}
        >
          {childState.message}
        </p>
      ) : null}
      {isOpen && childState?.status === "ready"
        ? childState.entries.map((child) => (
            <TreeRow
              key={child.relativePath}
              entry={child}
              depth={depth + 1}
              workspace={workspace}
              tree={tree}
              chatTargets={chatTargets}
              activeThreadId={activeThreadId}
            />
          ))
        : null}
    </div>
  );
}

export function FileExplorerBody({ tree }: { tree: TreeModel }) {
  const keepFocusAfterMenu = useRef(false);
  const rpc = useRpc<typeof rpcContract>();
  const { threadId } = useBbContext();
  const chatTargets = useSyncExternalStore(
    subscribeChatTargets,
    getChatTargets,
    getChatTargets,
  );

  if (tree.settingsLoading) {
    return (
      <p className="px-2 py-3 text-[11px] text-muted-foreground">Loading…</p>
    );
  }
  const workspace = tree.active;
  if (workspace === null) {
    return (
      <p className="px-2 py-3 text-[11px] text-muted-foreground">
        Choose a folder above.
      </p>
    );
  }

  const copyPathToClipboard = makeCopyPathToClipboard(rpc, workspace);

  const createFileInRoot = () => {
    keepFocusAfterMenu.current = true;
    tree.startCreate("", "file");
  };
  const createFolderInRoot = () => {
    keepFocusAfterMenu.current = true;
    tree.startCreate("", "folder");
  };

  /**
   * VS Code's tree keys. Arrows move and open, Enter opens, F2
   * renames, Delete (or ⌘⌫) deletes. Focus follows the selection so the row
   * stays in view and the next key lands here too.
   */
  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (tree.editing !== null || event.target instanceof HTMLInputElement) return;
    if (event.altKey || event.ctrlKey) return;
    const rows = visibleRows(tree.dirs, tree.expanded);
    const select = (path: string) => {
      tree.setSelected(path);
      const container = event.currentTarget;
      requestAnimationFrame(() => {
        container.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(path)}"]`)?.focus();
      });
    };
    const selected = tree.selected;
    const selectedRow = rows.find((row) => row.relativePath === selected);
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Home":
      case "End": {
        if (event.metaKey) return;
        const next = moveSelection(rows, selectedRow === undefined ? null : selected, event.key);
        if (next !== null) select(next);
        break;
      }
      case "ArrowLeft":
      case "ArrowRight": {
        if (event.metaKey) return;
        const action = horizontalAction(rows, tree.expanded, selected, event.key);
        if (action.kind === "expand") tree.setDirExpanded(action.path, true);
        else if (action.kind === "collapse") tree.setDirExpanded(action.path, false);
        else if (action.kind === "select") select(action.path);
        else return;
        break;
      }
      case "Enter":
        if (selectedRow === undefined) return;
        tree.rowActions.get(selectedRow.relativePath)?.open();
        break;
      case "F2":
        if (selectedRow === undefined) return;
        tree.setEditing({ kind: "rename", path: selectedRow.relativePath, isDirectory: selectedRow.isDirectory });
        break;
      case "Delete":
      case "Backspace":
        if (selectedRow === undefined || (event.key === "Backspace" && !event.metaKey)) return;
        tree.rowActions.get(selectedRow.relativePath)?.remove();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  
  const openInFinder = () => {
    void rpc
      .call("revealInExplorer", {
        rootId: workspace.rootId,
        relativePath: "",
      })
      .then((result) => {
        if (!result.ok) toast.error(result.message);
      })
      .catch(() => {
        toast.error("Could not open in Explorer.");
      });
  };

  const root = tree.dirs[""];
  const creatingInRoot = tree.editing?.kind === "create" && tree.editing.parent === "" ? tree.editing : null;
  return (
    <div
      role="tree"
      aria-label="Files"
      tabIndex={0}
      onKeyDown={onTreeKeyDown}
      className="min-h-0 flex-1 overflow-auto py-1 outline-none"
    >
      <div className="flex w-full items-center justify-between px-1.5 py-0.5">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-left text-[11px] font-medium text-muted-foreground"
              onClick={() => void tree.reload()}
              title={
                tree.isRerooted
                  ? `${workspace.rootPath} — click to return to the pinned folder`
                  : workspace.rootPath
              }
            >
              <Icon
                name={tree.isRerooted ? "ArrowTurnBackward" : "FolderGit"}
                className="size-3 shrink-0"
              />
              <span className="min-w-0 truncate">{workspace.rootName}</span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent
            className="w-56"
            onCloseAutoFocus={(event) => {
              if (!keepFocusAfterMenu.current) return;
              keepFocusAfterMenu.current = false;
              event.preventDefault();
            }}
          >
            <ContextMenuItem onSelect={createFileInRoot}>
              <Icon name="FileText" className="size-4" />
              Create File
            </ContextMenuItem>
            <ContextMenuItem onSelect={createFolderInRoot}>
              <Icon name="FolderPlus" className="size-4" />
              Create Folder
            </ContextMenuItem>
            <ContextMenuItem onSelect={openInFinder}>
              <Icon name="FolderOpen" className="size-4" />
              Open in Explorer
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => {
                copyPathToClipboard("", "Relative path copied");
              }}
            >
              <Icon name="Copy" className="size-4" />
              Copy Relative Path
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                copyPathToClipboard(
                  absolutePathOf(workspace, ""),
                  "Path copied",
                );
              }}
            >
              <Icon name="Copy" className="size-4" />
              Copy Path
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <button
          type="button"
          aria-label="Reload folder"
          title="Reload folder"
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover"
          onClick={() => void tree.reload()}
        >
          <Icon name="RotateCcw" className="size-3" />
        </button>
      </div>
      {root?.status === "error" ? (
        <p className="px-2 text-[11px] text-destructive">{root.message}</p>
      ) : null}
      {creatingInRoot !== null ? (
        <CreateRow depth={0} editing={creatingInRoot} workspace={workspace} tree={tree} />
      ) : null}
      {root?.status === "ready"
        ? root.entries.map((entry) => (
            <TreeRow
              key={entry.relativePath}
              entry={entry}
              depth={0}
              workspace={workspace}
              tree={tree}
              chatTargets={chatTargets}
              activeThreadId={threadId}
            />
          ))
        : null}
    </div>
  );
}
