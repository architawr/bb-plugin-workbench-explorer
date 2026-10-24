import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import {
  MATERIAL_ICONS_VERSION,
  fileIconId,
  folderIconId,
  type IconTheme,
} from "@/lib/material-icons";

declare const __BB_PLUGIN_ID__: string | undefined;

const PLUGIN_ID = typeof __BB_PLUGIN_ID__ === "string" ? __BB_PLUGIN_ID__ : "file-explorer";

/** Served by the plugin's own route; the version in the URL lets the browser cache them for good. */
function iconUrl(id: string): string {
  return `/api/v1/plugins/${encodeURIComponent(PLUGIN_ID)}/http/icon?n=${encodeURIComponent(id)}&v=${MATERIAL_ICONS_VERSION}`;
}

/** BB marks dark mode with a `dark` class on <html>; the light theme swaps a few icons. */
function subscribeTheme(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function readTheme(): IconTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function useIconTheme(): IconTheme {
  return useSyncExternalStore(subscribeTheme, readTheme, () => "dark");
}

function MaterialIcon({ id, className }: { id: string; className?: string }) {
  return (
    <img
      src={iconUrl(id)}
      alt=""
      aria-hidden
      draggable={false}
      loading="lazy"
      decoding="async"
      className={cn("size-4 shrink-0 select-none", className)}
    />
  );
}

export function FileTypeIcon({ name, className }: { name: string; className?: string }) {
  const theme = useIconTheme();
  return <MaterialIcon id={fileIconId(name, theme)} className={className} />;
}

export function FolderTypeIcon({
  name,
  expanded,
  isRoot = false,
  className,
}: {
  name: string;
  expanded: boolean;
  isRoot?: boolean;
  className?: string;
}) {
  const theme = useIconTheme();
  return <MaterialIcon id={folderIconId(name, { expanded, isRoot, theme })} className={className} />;
}
