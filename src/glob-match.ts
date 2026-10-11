/**
 * Glob matching for the search panel's include and exclude fields.
 *
 * The patterns follow the same rules VSCode's search uses: comma-separated
 * globs where `*` stays inside one path segment, `**` crosses segments, and a
 * pattern without a slash matches by file or folder name at any depth. The
 * same module answers for both engines — ripgrep receives the raw globs, the
 * fallback walk matches them here — so a folder hidden by `exclude` is hidden
 * whichever engine answers.
 */

/** Split a comma-separated field into individual glob patterns. */
export function parseGlobs(value: string): string[] {
  return value
    .split(",")
    .map((glob) => glob.trim())
    .filter((glob) => glob.length > 0);
}

/** Translate one path segment's pattern into a regex source fragment. */
function segmentSource(pattern: string): string {
  let out = "";
  let openBraces = 0;
  for (const character of pattern) {
    if (character === "*") out += "[^/]*";
    else if (character === "?") out += "[^/]";
    else if (character === "{") {
      out += "(?:";
      openBraces += 1;
    } else if (character === "," && openBraces > 0) out += "|";
    else if (character === "}" && openBraces > 0) {
      out += ")";
      openBraces -= 1;
    } else out += character.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
  // An unclosed brace would produce an invalid regex; close it rather than
  // let the whole search crash on a typo.
  out += ")".repeat(openBraces);
  return out;
}

/**
 * The regex source for one glob, matched against a path relative to the
 * search root.
 */
function globSource(glob: string): string {
  const segments = glob.split("/");
  let out = "";
  let pendingSlash = false;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (segment === "**") {
      const segmentsLeft = segments.length - index - 1;
      if (segmentsLeft === 0) {
        // Trailing `**` matches the directory itself and everything under it.
        out += out === "" ? ".*" : "(?:/.*)?";
        break;
      }
      // Middle `**` consumes whole segments, including the separators.
      if (pendingSlash) {
        out += "/";
        pendingSlash = false;
      }
      out += "(?:[^/]+/)*";
      continue;
    }
    if (pendingSlash) {
      out += "/";
      pendingSlash = false;
    }
    out += segmentSource(segment);
    pendingSlash = true;
  }
  return out;
}

/**
 * Compile one glob into a regex over a path relative to the search root. A
 * pattern without a slash matches the name of any file or folder at any
 * depth; a pattern with a slash matches the path itself.
 */
export function compileGlob(glob: string): RegExp {
  const source = glob.includes("/") ? globSource(glob) : `(?:.*/)?${segmentSource(glob)}`;
  return new RegExp(`^${source}$`, "u");
}

/**
 * Whether any pattern matches the path or one of its parent folders. The
 * ancestors matter for exclusions: `node_modules` should hide
 * `node_modules/pkg/index.js` even though only the folder's name matches, and
 * `src/**` should hide the `src` folder itself so the walk can prune it.
 */
export function anyGlobMatches(
  patterns: readonly RegExp[],
  relativePath: string,
): boolean {
  let path = relativePath.replace(/\/+$/u, "");
  while (true) {
    for (const pattern of patterns) {
      if (pattern.test(path)) return true;
    }
    const slash = path.lastIndexOf("/");
    if (slash === -1) return false;
    path = path.slice(0, slash);
  }
}