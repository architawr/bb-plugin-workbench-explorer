import { useMemo } from "react";
import { useBbContext, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { FILE_DIFF_ACTION_ID } from "@/components/FileDiffPanel";
import { useGitStatus } from "@/hooks/useGitStatus";
import { STATUS_BADGE, STATUS_LABEL, STATUS_TEXT } from "@/lib/git-status";
import { openWorkspaceFile } from "@/lib/open-preview";
import { surfaceNavigation } from "@/lib/surface-navigation";
import { cn } from "@/lib/utils";
import type { rpcContract } from "../contract";
import type { Workspace } from "../shared";

function splitPath(path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? { name: path, folder: "" } : { name: path.slice(slash + 1), folder: path.slice(0, slash) };
}

/** VS Code's Source Control list: every uncommitted file, its folder dimmed beside it. */
export function ChangesPanel({ root }: { root: Workspace | null }) {
  const rpc = useRpc<typeof rpcContract>();
  const { threadId } = useBbContext();
  const { result } = useGitStatus(root?.rootId ?? null);
  const entries = useMemo(
    () => [...result.entries].sort((left, right) => left.path.localeCompare(right.path)),
    [result.entries],
  );

  if (root === null) {
    return <p className="px-2 py-3 text-[11px] text-muted-foreground">Choose a folder above.</p>;
  }
  if (!result.isRepository) {
    return <p className="px-2 py-3 text-[11px] text-muted-foreground">This folder is not in a git repository.</p>;
  }
  if (entries.length === 0) {
    return <p className="px-2 py-3 text-[11px] text-muted-foreground">No uncommitted changes.</p>;
  }

  const report = (message: string) => {
    void rpc.call("clientLog", { message }).catch(() => undefined);
  };

  const openDiff = (relativePath: string) => {
    const navigation = surfaceNavigation(threadId);
    const opened = navigation?.openThreadPanel({
      actionId: FILE_DIFF_ACTION_ID,
      title: `Diff · ${splitPath(relativePath).name}`,
      params: { rootId: root.rootId, relativePath, hostId: root.hostId, rootPath: root.rootPath },
    }) ?? false;
    if (!opened) toast.error("Open a thread to see diffs.");
  };

  const openFile = (relativePath: string) => {
    const navigation = surfaceNavigation(threadId);
    if (!openWorkspaceFile(navigation, root, relativePath, report)) {
      toast.error(navigation === null ? "Open a thread or New Thread page to preview files." : "Could not open the file preview.");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="flex-1">Changes</span>
        <span className="rounded-full bg-state-active px-1.5 font-mono normal-case">{entries.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {entries.map((entry) => {
          const { name, folder } = splitPath(entry.path);
          const isDeleted = entry.status === "deleted";
          return (
            <div key={entry.path} className="group flex items-center rounded-[3px] hover:bg-state-hover">
              <button
                type="button"
                onClick={() => openDiff(entry.path)}
                title={`${entry.path} · ${STATUS_LABEL[entry.status]} — click for the diff`}
                className="flex min-w-0 flex-1 items-center gap-1 py-px pl-1.5 pr-1 text-left text-[11px] leading-5"
              >
                <FileTypeIcon name={name} className="size-4" />
                <span className={cn("min-w-0 shrink truncate", STATUS_TEXT[entry.status], isDeleted && "line-through")}>
                  {name}
                </span>
                {folder === "" ? null : (
                  <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/70">{folder}</span>
                )}
              </button>
              {isDeleted ? null : (
                <button
                  type="button"
                  aria-label={`Open ${entry.path}`}
                  title="Open file"
                  onClick={() => openFile(entry.path)}
                  className="hidden shrink-0 rounded px-1 text-[10px] text-muted-foreground hover:bg-state-active group-hover:block"
                >
                  Open
                </button>
              )}
              <span
                aria-label={STATUS_LABEL[entry.status]}
                className={cn("w-4 shrink-0 text-center font-mono text-[10px] leading-5", STATUS_TEXT[entry.status])}
              >
                {STATUS_BADGE[entry.status]}
              </span>
            </div>
          );
        })}
        {result.truncated ? (
          <p className="px-1.5 py-1 text-[10px] text-muted-foreground">Showing the first {entries.length} changes.</p>
        ) : null}
      </div>
    </div>
  );
}
