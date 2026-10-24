/**
 * Material Icon Theme lookups, resolved the way VS Code resolves a file icon
 * theme: an exact file name first, then the longest matching extension, then
 * the default. Folder names map to a closed and an "-open" icon.
 */
import manifest from "./material-icons-manifest.json";

export type IconTheme = "dark" | "light";

type Table = Readonly<Record<string, string>>;
interface Tables {
  fileExtensions: Table;
  fileNames: Table;
  folderNames: Table;
  folderNamesExpanded?: Table;
}

const dark = manifest.dark as Tables;
const light = manifest.light as Tables;

export const MATERIAL_ICONS_VERSION: string = manifest.version;

function lookup(theme: IconTheme, pick: (tables: Tables) => Table | undefined, key: string): string | undefined {
  if (theme === "light") {
    const override = pick(light)?.[key];
    if (override !== undefined) return override;
  }
  return pick(dark)?.[key];
}

export function fileIconId(fileName: string, theme: IconTheme = "dark"): string {
  const name = fileName.toLowerCase();
  const byName = lookup(theme, (tables) => tables.fileNames, name);
  if (byName !== undefined) return byName;
  // `app.spec.ts` tries `spec.ts` before `ts`; a dotfile like `.env` is its
  // own extension.
  for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
    const byExtension = lookup(theme, (tables) => tables.fileExtensions, name.slice(dot + 1));
    if (byExtension !== undefined) return byExtension;
  }
  return manifest.file;
}

export function folderIconId(
  folderName: string,
  { expanded, isRoot = false, theme = "dark" }: { expanded: boolean; isRoot?: boolean; theme?: IconTheme },
): string {
  if (isRoot) return expanded ? manifest.rootFolderExpanded : manifest.rootFolder;
  const name = folderName.toLowerCase();
  const closed = lookup(theme, (tables) => tables.folderNames, name);
  if (closed === undefined) return expanded ? manifest.folderExpanded : manifest.folder;
  if (!expanded) return closed;
  return lookup(theme, (tables) => tables.folderNamesExpanded, name) ?? `${closed}-open`;
}
