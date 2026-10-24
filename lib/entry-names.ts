/** Split `name.ext` the way Finder and VS Code do: a leading dot is part of the name. */
export function splitExtension(name: string): { base: string; extension: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { base: name.slice(0, dot), extension: name.slice(dot) } : { base: name, extension: "" };
}

/** VS Code's duplicate names: `a.ts` → `a copy.ts` → `a copy 2.ts`. */
export function copyName(name: string, taken: ReadonlySet<string>, isDirectory: boolean): string {
  const { base, extension } = isDirectory ? { base: name, extension: "" } : splitExtension(name);
  for (let attempt = 1; ; attempt += 1) {
    const candidate = `${base} copy${attempt === 1 ? "" : ` ${attempt}`}${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A name for the Trash that does not collide: Finder appends the time, then a counter. */
export function trashName(name: string, taken: ReadonlySet<string>, now: Date, isDirectory: boolean): string {
  if (!taken.has(name)) return name;
  const { base, extension } = isDirectory ? { base: name, extension: "" } : splitExtension(name);
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((part) => String(part).padStart(2, "0")).join(".");
  for (let attempt = 1; ; attempt += 1) {
    const candidate = `${base} ${time}${attempt === 1 ? "" : ` ${attempt}`}${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
}
