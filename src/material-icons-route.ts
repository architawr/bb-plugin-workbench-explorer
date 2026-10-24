import type { BbPluginApi } from "@get-bb/plugin-sdk";
import svgs from "./material-icons-svg.json";

const icons = svgs as Readonly<Record<string, string>>;

/** The tree asks for icons by id; the URL carries the theme version, so they never go stale. */
export function registerMaterialIconRoute(bb: BbPluginApi): void {
  bb.http.route("GET", "/icon", (context) => {
    const id = context.req.query("n") ?? "";
    const svg = Object.hasOwn(icons, id) ? icons[id] : undefined;
    if (svg === undefined) return new Response("unknown icon", { status: 404 });
    return new Response(svg, {
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
