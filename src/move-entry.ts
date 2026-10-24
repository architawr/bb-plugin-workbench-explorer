import type { BbPluginApi, ExperimentalHostClient } from "@get-bb/plugin-sdk";
import { hostContract } from "../host-contract";
import { resolveUnderRoot, toRelativePath } from "./paths";
import { resolveRoot } from "./roots";

export type MoveEntryInput = {
  rootId: string;
  relativePath: string;
  /** Folder to move into, relative to the root; "" is the root itself. */
  destinationDirectory: string;
};

export type MoveEntryResult =
  | { ok: true; relativePath: string }
  | { ok: false; message: string };

function parentOf(relativePath: string): string {
  const slash = relativePath.lastIndexOf("/");
  return slash === -1 ? "" : relativePath.slice(0, slash);
}

function nameOf(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf("/") + 1);
}

/**
 * The checks a drop needs before anything touches the disk, kept apart so they
 * can be tested without a host.
 */
export function moveProblem(relativePath: string, destinationDirectory: string): string | null {
  if (relativePath === "") return "The workspace root cannot be moved.";
  if (destinationDirectory === relativePath || destinationDirectory.startsWith(`${relativePath}/`)) {
    return "A folder cannot be moved into itself.";
  }
  if (parentOf(relativePath) === destinationDirectory) return "already-there";
  return null;
}

/**
 * Move one file or folder into another folder of the same tree, the way a drop
 * in VS Code's explorer does. Refuses to overwrite: a name already taken in
 * the destination is reported, not replaced.
 */
export async function moveEntry(
  bb: BbPluginApi,
  host: ExperimentalHostClient<typeof hostContract>,
  input: MoveEntryInput,
): Promise<MoveEntryResult> {
  const problem = moveProblem(input.relativePath, input.destinationDirectory);
  if (problem === "already-there") return { ok: true, relativePath: input.relativePath };
  if (problem !== null) return { ok: false, message: problem };

  const root = resolveRoot(input.rootId);
  if (root === undefined) {
    return { ok: false, message: "This file explorer panel is out of date — reopen it and try again." };
  }

  let sourceAbsolute: string;
  let destinationAbsolute: string;
  const name = nameOf(input.relativePath);
  const destinationRelative = input.destinationDirectory === "" ? name : `${input.destinationDirectory}/${name}`;
  try {
    sourceAbsolute = resolveUnderRoot(root.rootPath, input.relativePath);
    destinationAbsolute = resolveUnderRoot(root.rootPath, destinationRelative);
    resolveUnderRoot(root.rootPath, input.destinationDirectory);
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : "That path is not in this tree." };
  }

  try {
    const [source, destination] = await Promise.all([
      host.call("statPath", { rootPath: root.rootPath, relativePath: input.relativePath }, { hostId: root.hostId }),
      host.call("statPath", { rootPath: root.rootPath, relativePath: input.destinationDirectory }, { hostId: root.hostId }),
    ]);
    if (source === null) return { ok: false, message: `${name} is no longer on disk.` };
    if (destination === null || !destination.isDirectory) return { ok: false, message: "The drop target is not a folder." };
    const listing = await host.call("listDirectory", {
      rootPath: root.rootPath,
      relativePath: input.destinationDirectory,
      showSkipped: true,
      ignoredFolders: [],
    }, { hostId: root.hostId });
    if (listing.entries.some((entry) => entry.name === name)) {
      return { ok: false, message: `An item named ${name} already exists in the destination folder.` };
    }
    await bb.sdk.files.move({
      hostId: root.hostId,
      sourcePath: sourceAbsolute,
      destinationPath: destinationAbsolute,
      rootPath: root.rootPath,
    });
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : `Could not move ${name}.` };
  }
  return { ok: true, relativePath: toRelativePath(root.rootPath, destinationAbsolute) };
}
