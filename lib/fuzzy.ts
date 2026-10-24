/**
 * VS Code's Quick Open matching: the query's characters appear in order in the
 * candidate, not necessarily together — `fexb` finds `FileExplorerBody`.
 * Characters that start a word (after `-`, `_`, `.`, `/`, a space, or a
 * lower-to-upper case change) are preferred, so the positions picked are the
 * ones a reader would point at.
 */

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1]!;
  const current = text[index]!;
  if ("-_./ ".includes(previous)) return true;
  return previous === previous.toLowerCase() && current !== current.toLowerCase();
}

/** The positions `needle` matches at in `text`, case-insensitively, or null when it does not. */
export function fuzzyPositions(text: string, needle: string): number[] | null {
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase().replace(/\s+/gu, "");
  if (lowerNeedle === "") return [];
  const positions: number[] = [];
  let from = 0;
  for (let i = 0; i < lowerNeedle.length; i += 1) {
    const char = lowerNeedle[i]!;
    // Prefer the next word start that has this character, if the rest still fits after it.
    let pick = -1;
    for (let j = from; j < lowerText.length; j += 1) {
      if (lowerText[j] !== char) continue;
      if (pick === -1) pick = j;
      if (isWordStart(text, j) && (positions.length === 0 || j > positions[positions.length - 1]!)) {
        if (subsequenceFits(lowerText, lowerNeedle, i + 1, j + 1)) {
          pick = j;
          break;
        }
      }
      // Contiguous with the previous match is as good as a word start.
      if (positions.length > 0 && j === positions[positions.length - 1]! + 1) {
        pick = j;
        break;
      }
    }
    if (pick === -1) return null;
    positions.push(pick);
    from = pick + 1;
  }
  return positions;
}

function subsequenceFits(text: string, needle: string, needleFrom: number, textFrom: number): boolean {
  let t = textFrom;
  for (let n = needleFrom; n < needle.length; n += 1) {
    t = text.indexOf(needle[n]!, t);
    if (t === -1) return false;
    t += 1;
  }
  return true;
}

/** Lower is better: gaps between matched characters cost, word starts and an early start earn back. */
export function fuzzyScore(text: string, needle: string): number | null {
  const positions = fuzzyPositions(text, needle);
  if (positions === null) return null;
  let score = positions[0] ?? 0;
  for (let i = 0; i < positions.length; i += 1) {
    if (i > 0) score += (positions[i]! - positions[i - 1]! - 1) * 2;
    if (!isWordStart(text, positions[i]!)) score += 1;
  }
  return score;
}
