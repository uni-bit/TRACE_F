/**
 * The deployment's base path, for URLs Next.js does not rewrite itself.
 *
 * `next/link`, `next/image` and the router all prepend `basePath` from
 * next.config.ts without being asked. Anything that builds a URL and hands it
 * to something else — three.js `TextureLoader`, a bare `fetch`, a `new Image()`
 * — does not, and on a GitHub Pages project site those requests go to the
 * domain root and 404. Route every such URL through here.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function withBasePath(path: string): string {
  if (!BASE_PATH || !path.startsWith("/")) return path;
  return `${BASE_PATH}${path}`;
}
