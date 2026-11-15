// URLs of files under public/. Owner: lead.
// The build lists every file under public/assets with a content hash. A hashed URL (?v=…) never
// changes its content, so the service worker (public/sw.js) may keep it forever; a file that is
// not in the list does not exist and is not requested at all. In development the list is empty.
import versions from 'virtual:asset-versions';

const V = versions as Record<string, string>;
const known = Object.keys(V).length > 0;

function base(): string {
  try { return (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'; } catch { return '/'; }
}

/** `path` is relative to public/, e.g. 'assets/models/kart.otter.glb'. */
export function assetUrl(path: string): string {
  const v = V[path];
  return base() + path + (v ? `?v=${v}` : '');
}

/** false only if the build knows the file is missing; true when unknown (development). */
export function assetExists(path: string): boolean {
  return !known || path in V;
}
