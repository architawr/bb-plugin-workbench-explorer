import { ChatPathBridge } from "@/components/ChatPathBridge";

/**
 * Mounted in every thread header, but draws nothing: the show/hide button
 * lives in the window title bar. The slot is kept because it is the one place
 * a thread's own navigation is in reach, which file opens and chat path
 * reveals go through.
 */
export function FileExplorerHeaderAction({ threadId }: { threadId: string }) {
  return <ChatPathBridge threadId={threadId} />;
}
