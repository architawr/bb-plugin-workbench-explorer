import { execFile } from "node:child_process";
import { parsePorcelainZ, type GitStatusEntry } from "../lib/git-status";

/** A repository with this many changes is past what a tree can usefully colour. */
const MAX_ENTRIES = 5000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

export interface HostGitStatus {
  /** False outside a work tree, or on a machine without git. */
  isRepository: boolean;
  entries: GitStatusEntry[];
  truncated: boolean;
}

function git(cwd: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      { maxBuffer: MAX_OUTPUT_BYTES, timeout: TIMEOUT_MS, windowsHide: true },
      (error, stdout) => resolve(error === null ? stdout : null),
    );
  });
}

/**
 * The working-tree status of the repository `rootPath` sits in, re-based onto
 * `rootPath`. The root can be a subdirectory of the repository — a monorepo
 * package pinned as a project — so changes outside it are dropped.
 */
export async function hostGitStatus(rootPath: string): Promise<HostGitStatus> {
  const prefixOutput = await git(rootPath, ["rev-parse", "--show-prefix"]);
  if (prefixOutput === null) return { isRepository: false, entries: [], truncated: false };
  const prefix = prefixOutput.trim();
  // Every untracked file, not just its top folder, so a new file deep in a new
  // folder is coloured where it is.
  const status = await git(rootPath, [
    "--no-optional-locks",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  if (status === null) return { isRepository: true, entries: [], truncated: false };
  const entries = parsePorcelainZ(status, prefix);
  return {
    isRepository: true,
    entries: entries.slice(0, MAX_ENTRIES),
    truncated: entries.length > MAX_ENTRIES,
  };
}

/** A diff past this size is not worth drawing in a panel. */
const MAX_PATCH_BYTES = 2 * 1024 * 1024;

/**
 * The uncommitted change to one file as a unified patch: against HEAD for a
 * tracked file, against nothing for an untracked one. Null when there is no
 * change to show, or the patch is too large.
 */
export async function hostGitDiff(rootPath: string, relativePath: string): Promise<string | null> {
  // A tracked file — modified, staged, or deleted — differs from HEAD; an
  // untracked one does not exist there, so diff it against nothing.
  let patch = await git(rootPath, ["--no-optional-locks", "diff", "--no-color", "--no-ext-diff", "HEAD", "--", relativePath]);
  if (patch === null || patch.trim() === "") patch = await gitNoIndex(rootPath, relativePath);
  if (patch === null || patch.trim() === "" || patch.length > MAX_PATCH_BYTES) return null;
  return patch;
}

/** `git diff --no-index` exits 1 when the sides differ, which is the answer. */
function gitNoIndex(cwd: string, relativePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", cwd, "diff", "--no-color", "--no-ext-diff", "--no-index", "--", "/dev/null", relativePath],
      { maxBuffer: MAX_OUTPUT_BYTES, timeout: TIMEOUT_MS, windowsHide: true },
      (error, stdout) => resolve(error === null || (error as { code?: unknown }).code === 1 ? stdout : null),
    );
  });
}
