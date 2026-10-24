import { getRailWidthPx, subscribeRailWidth } from "@/lib/rail-width";
import { getWindowFrame, subscribeWindowFrame } from "@/lib/window-frame";

const holders = new Set<string>();
/** Storage key for the git plugin's rail-open flag. Both plugins share the
 *  same host body padding — when this rail closes but the sibling is still
 *  open, we must not clear `paddingRight` or the chat loses its rail
 *  reservation mid-transition. */
const SIBLING_RAIL_STORAGE_KEY = "bb-plugin-git:rail-open";

function siblingRailOpen(): boolean {
  try {
    return localStorage.getItem(SIBLING_RAIL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function syncBodyPadding(): void {
  if (holders.size > 0) {
    // In a framed window the rail card keeps BB's lip to the window edge.
    const frame = getWindowFrame();
    const width = `${getRailWidthPx()}px`;
    document.body.style.paddingRight = frame === null ? width : `calc(${width} + ${frame.lip})`;
    return;
  }
  // Own rail holders are empty — only clear the padding when the sibling rail
  // is also closed. If the sibling is open, it owns the body padding.
  if (siblingRailOpen()) return;
  document.body.style.paddingRight = "";
}

/** The inset follows the handle, so the chat keeps up while the rail is dragged. */
subscribeRailWidth(() => {
  syncBodyPadding();
});

subscribeWindowFrame(() => {
  syncBodyPadding();
});

/** Reserve space for the overlay. Call from layout effects; always release on cleanup. */
export function acquireRailInset(holderId: string): () => void {
  holders.add(holderId);
  syncBodyPadding();
  return () => {
    holders.delete(holderId);
    syncBodyPadding();
  };
}

export function syncRailInset(): void {
  syncBodyPadding();
}
