import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { FileExplorerHeaderAction } from "@/components/FileExplorerHeaderAction";
import { GlobalFileExplorerRail } from "@/components/GlobalFileExplorerRail";
import { NewThreadFileExplorerAction } from "@/components/NewThreadFileExplorerAction";
import { ChatDraftBridge } from "@/components/ChatDraftBridge";
import { FILE_DIFF_ACTION_ID, FileDiffPanel } from "@/components/FileDiffPanel";
import { requestSearchFocus } from "@/lib/search-focus-bus";
import { toggleRailOpen, writeStoredOpen } from "@/lib/rail-state";
import { setQuickOpen } from "@/lib/quick-open-bus";
import { requestTextSearch } from "@/lib/text-search-bus";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "global-file-explorer", component: GlobalFileExplorerRail });

  app.slots.experimental_threadHeaderAction({
    id: "file-explorer-toggle",
    title: "Workbench Explorer",
    component: ({ threadId }) => <FileExplorerHeaderAction threadId={threadId} />,
  });

  app.slots.threadPanelAction({
    id: FILE_DIFF_ACTION_ID,
    title: "File diff",
    layout: "flush",
    component: FileDiffPanel,
  });

  app.slots.sidebarFooterAction({
    id: "file-explorer-toggle",
    title: "Workbench Explorer",
    icon: "FileText",
    run: toggleRailOpen,
  });

  app.composer.customize({
    id: "new-thread-file-explorer",
    scopes: ["new-thread"],
    actions: [{ id: "open-file-explorer", component: NewThreadFileExplorerAction }],
  });

  app.composer.customize({
    id: "file-explorer-chat-draft",
    scopes: ["thread", "queued-message", "side-chat", "new-thread"],
    banners: [{ id: "bridge", chrome: "bare", component: ChatDraftBridge }],
  });

  app.commands.register({
    id: "quick-open",
    title: "Explorer: Go to File…",
    // ⌘P is BB's own "Quick open file"; ⌘E is VS Code's other Quick Open key on macOS.
    defaultShortcut: { key: "e", mod: true },
    run: () => setQuickOpen(true),
  });

  app.commands.register({
    id: "search-in-files",
    title: "Explorer: Search in Files",
    defaultShortcut: { key: "f", mod: true, shift: true },
    run: requestTextSearch,
  });

  app.commands.register({
    id: "toggle-file-explorer",
    title: "Explorer: show or hide",
    // ⇧⌘E resizes BB's chat pane; ⌘B is VS Code's sidebar toggle.
    defaultShortcut: { key: "b", mod: true },
    run: toggleRailOpen,
  });

  app.slots.commandPaletteAction({
    id: "find-file-in-tree",
    title: "Explorer: find a file",
    run: () => {
      writeStoredOpen(true);
      requestSearchFocus();
    },
  });

  app.slots.commandPaletteAction({
    id: "open-file-explorer",
    title: "Explorer: show pinned folder",
    run: () => {
      writeStoredOpen(true);
    },
  });
});
