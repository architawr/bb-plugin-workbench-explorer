/**
 * Keyboard navigation over the tree as it is drawn: only folders that are
 * expanded and loaded contribute their children, in display order.
 */
export interface NavEntry {
  relativePath: string;
  kind: "file" | "directory";
}

export type NavDirs = Readonly<Record<string, { status: string; entries?: readonly NavEntry[] }>>;

export interface VisibleRow {
  relativePath: string;
  isDirectory: boolean;
  parent: string;
}

export function visibleRows(dirs: NavDirs, expanded: ReadonlySet<string>): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const walk = (parent: string) => {
    const state = dirs[parent];
    if (state?.status !== "ready" || state.entries === undefined) return;
    for (const entry of state.entries) {
      const isDirectory = entry.kind === "directory";
      rows.push({ relativePath: entry.relativePath, isDirectory, parent });
      if (isDirectory && expanded.has(entry.relativePath)) walk(entry.relativePath);
    }
  };
  walk("");
  return rows;
}

export type NavKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/** The row a key moves to, or null when it stays put. With nothing selected, any key lands on the first row. */
export function moveSelection(rows: readonly VisibleRow[], selected: string | null, key: NavKey): string | null {
  if (rows.length === 0) return null;
  const index = selected === null ? -1 : rows.findIndex((row) => row.relativePath === selected);
  if (index === -1) return rows[0]!.relativePath;
  switch (key) {
    case "ArrowDown":
      return rows[Math.min(index + 1, rows.length - 1)]!.relativePath;
    case "ArrowUp":
      return rows[Math.max(index - 1, 0)]!.relativePath;
    case "Home":
      return rows[0]!.relativePath;
    case "End":
      return rows[rows.length - 1]!.relativePath;
  }
}

export type HorizontalAction =
  | { kind: "expand"; path: string }
  | { kind: "collapse"; path: string }
  | { kind: "select"; path: string }
  | { kind: "none" };

/**
 * VS Code's arrows: Right opens a folder, then steps into it; Left closes a
 * folder, then steps out to its parent.
 */
export function horizontalAction(
  rows: readonly VisibleRow[],
  expanded: ReadonlySet<string>,
  selected: string | null,
  key: "ArrowLeft" | "ArrowRight",
): HorizontalAction {
  const index = selected === null ? -1 : rows.findIndex((row) => row.relativePath === selected);
  if (index === -1) return { kind: "none" };
  const row = rows[index]!;
  const isOpen = row.isDirectory && expanded.has(row.relativePath);
  if (key === "ArrowRight") {
    if (!row.isDirectory) return { kind: "none" };
    if (!isOpen) return { kind: "expand", path: row.relativePath };
    const child = rows[index + 1];
    return child !== undefined && child.parent === row.relativePath
      ? { kind: "select", path: child.relativePath }
      : { kind: "none" };
  }
  if (isOpen) return { kind: "collapse", path: row.relativePath };
  return row.parent === "" ? { kind: "none" } : { kind: "select", path: row.parent };
}

/** What an inline rename pre-selects: the name without its extension, as VS Code does. */
export function renameSelectionEnd(name: string, isDirectory: boolean): number {
  if (isDirectory) return name.length;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}
