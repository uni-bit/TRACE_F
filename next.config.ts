import type { NextConfig } from "next";

/**
 * GitHub Pages serves a project site from a sub-path and cannot run a server,
 * so the app is exported as static files under a base path. Both settings come
 * from the environment: the deploy workflow sets them, and a local `next dev`
 * leaves them unset so the app still lives at the root and keeps its route
 * handlers.
 *
 * The base path reaches `next/link` and `next/image` on its own. It does NOT
 * reach a URL that application code hands to a loader of its own — the floor
 * plan textures the map viewer pulls through three.js are the one such case,
 * and they go through `withBasePath` in src/lib/base-path.ts.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  ...(process.env.NEXT_STATIC_EXPORT === "1" ? { output: "export" as const } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  images: {
    // A static export has no image optimizer behind it.
    unoptimized: true,
  },
};

export default nextConfig;
