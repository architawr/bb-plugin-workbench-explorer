import { buildMatcher, type MatchOptions } from "../src/text-match";

export interface PreviewSegment {
  kind: "same" | "old" | "new";
  text: string;
}

/** `String.replace`'s `$` patterns, applied to one match: `$$`, `$&`, `$1`…`$99`, `$<name>`. */
export function expandReplacement(replacement: string, match: RegExpExecArray): string {
  return replacement.replace(/\$(\$|&|\d{1,2}|<[^>]*>)/gu, (token, key: string) => {
    if (key === "$") return "$";
    if (key === "&") return match[0];
    if (key.startsWith("<")) return match.groups?.[key.slice(1, -1)] ?? token;
    const group = Number(key);
    return group > 0 && group < match.length ? match[group] ?? "" : token;
  });
}

/**
 * How a line reads after Replace, as VS Code previews it: each match struck
 * through and followed by what replaces it. Null when the pattern does not
 * compile or matches nothing, so the caller shows the plain line.
 */
export function previewReplace(
  line: string,
  query: string,
  options: MatchOptions,
  replacement: string,
): PreviewSegment[] | null {
  let matcher: RegExp;
  try {
    matcher = buildMatcher(query, options);
  } catch {
    return null;
  }
  const segments: PreviewSegment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  matcher.lastIndex = 0;
  while ((match = matcher.exec(line)) !== null) {
    if (match[0].length === 0) {
      matcher.lastIndex += 1;
      continue;
    }
    if (match.index > last) segments.push({ kind: "same", text: line.slice(last, match.index) });
    segments.push({ kind: "old", text: match[0] });
    const next = options.useRegex ? expandReplacement(replacement, match) : replacement;
    if (next !== "") segments.push({ kind: "new", text: next });
    last = match.index + match[0].length;
  }
  if (segments.length === 0) return null;
  if (last < line.length) segments.push({ kind: "same", text: line.slice(last) });
  return segments;
}
