import { cp, lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { copyName, splitExtension, trashName } from "../lib/entry-names";
import { resolveUnderRoot, toRelativePath } from "./paths";

/**
 * Where deleted items go on this machine: the macOS Trash, or the
 * freedesktop.org Trash on Linux. Null elsewhere, where a delete is permanent.
 */
export function trashFilesDir(): string | null {
  if (process.platform === "darwin") return path.join(os.homedir(), ".Trash");
  if (process.platform === "linux") {
    const data = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
    return path.join(data, "Trash", "files");
  }
  return null;
}

function isErrno(cause: unknown, code: string): boolean {
  return cause instanceof Error && "code" in cause && (cause as { code?: unknown }).code === code;
}

/** `rename`, falling back to copy-then-delete when the Trash is on another volume. */
async function relocate(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (cause) {
    if (!isErrno(cause, "EXDEV")) throw cause;
    await cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    await rm(from, { recursive: true });
  }
}

async function exists(absolute: string): Promise<boolean> {
  try {
    await lstat(absolute);
    return true;
  } catch (cause) {
    if (isErrno(cause, "ENOENT")) return false;
    throw cause;
  }
}

/**
 * A free name in the Trash, found by checking candidates one at a time:
 * macOS refuses to list ~/.Trash to apps without Full Disk Access, while
 * moving into it is allowed. Where even a single check is refused, a name
 * with the current time down to the millisecond stands in.
 */
async function freeTrashName(trash: string, name: string, isDirectory: boolean): Promise<string> {
  const now = new Date();
  const taken = new Set<string>();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = trashName(name, taken, now, isDirectory);
    try {
      await lstat(path.join(trash, candidate));
      taken.add(candidate);
    } catch (cause) {
      if (isErrno(cause, "ENOENT")) return candidate;
      break;
    }
  }
  const { base, extension } = isDirectory ? { base: name, extension: "" } : splitExtension(name);
  return `${base} ${now.getTime()}${extension}`;
}

/**
 * Move a file or folder to the Trash. A symlink goes as the link, never its
 * target. Returns where it went, so the delete can be undone; `trashedPath`
 * is null when this machine has no Trash and the item was removed for good.
 */
export async function trashHostPath(
  rootPath: string,
  relativePath: string,
  trash: string | null = trashFilesDir(),
): Promise<{ ok: boolean; trashedPath: string | null }> {
  const absolute = resolveUnderRoot(rootPath, relativePath);
  let stats;
  try {
    stats = await lstat(absolute);
  } catch (cause) {
    if (isErrno(cause, "ENOENT")) return { ok: false, trashedPath: null };
    throw cause;
  }
  if (trash === null) {
    await rm(absolute, { recursive: stats.isDirectory() && !stats.isSymbolicLink() });
    return { ok: true, trashedPath: null };
  }
  await mkdir(trash, { recursive: true });
  const name = await freeTrashName(trash, path.basename(absolute), stats.isDirectory());
  const destination = path.join(trash, name);
  await relocate(absolute, destination);
  if (process.platform === "linux") {
    // The freedesktop spec's record, so the desktop's own Trash can restore it too.
    const info = path.join(path.dirname(trash), "info", `${name}.trashinfo`);
    await mkdir(path.dirname(info), { recursive: true });
    const deletedAt = new Date().toISOString().slice(0, 19);
    await writeFile(info, `[Trash Info]\nPath=${encodeURI(absolute)}\nDeletionDate=${deletedAt}\n`).catch(() => undefined);
  }
  return { ok: true, trashedPath: destination };
}

/**
 * Undo a delete: move `trashedPath` back to where it was. Only paths directly
 * inside this machine's Trash are accepted, and nothing is overwritten.
 */
export async function restoreHostPath(
  rootPath: string,
  relativePath: string,
  trashedPath: string,
  trash: string | null = trashFilesDir(),
): Promise<{ ok: boolean; message: string | null }> {
  if (trash === null || path.dirname(path.resolve(trashedPath)) !== path.resolve(trash)) {
    return { ok: false, message: "That item is not in the Trash." };
  }
  const destination = resolveUnderRoot(rootPath, relativePath);
  // Checking inside the Trash can be refused on macOS; then the move itself says.
  if (!(await exists(trashedPath).catch(() => true))) return { ok: false, message: "The item is no longer in the Trash." };
  if (await exists(destination)) {
    return { ok: false, message: `Something named ${path.basename(destination)} is already there.` };
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await relocate(trashedPath, destination);
  if (process.platform === "linux") {
    await rm(path.join(path.dirname(trash), "info", `${path.basename(trashedPath)}.trashinfo`), { force: true });
  }
  return { ok: true, message: null };
}

/**
 * Copy a file or folder into `destinationDirectory` under a free name — the
 * same name when it is free there, else VS Code's "name copy" series.
 */
export async function copyHostPath(
  rootPath: string,
  relativePath: string,
  destinationDirectory: string,
): Promise<{ ok: boolean; relativePath: string | null; message: string | null }> {
  const source = resolveUnderRoot(rootPath, relativePath);
  const directory = resolveUnderRoot(rootPath, destinationDirectory);
  let stats;
  try {
    stats = await lstat(source);
  } catch (cause) {
    if (isErrno(cause, "ENOENT")) return { ok: false, relativePath: null, message: "That item is not on disk." };
    throw cause;
  }
  const isDirectory = stats.isDirectory();
  if (isDirectory && (directory === source || directory.startsWith(`${source}${path.sep}`))) {
    return { ok: false, relativePath: null, message: "A folder cannot be pasted into itself." };
  }
  const taken = new Set(await readdir(directory));
  const name = path.basename(source);
  const target = path.join(directory, taken.has(name) ? copyName(name, taken, isDirectory) : name);
  await cp(source, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  return { ok: true, relativePath: toRelativePath(rootPath, target), message: null };
}
