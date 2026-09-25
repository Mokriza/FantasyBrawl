/**
 * Asset paths in the content JSON and in manifest.json are written from the site
 * root ("/assets/..."). When the game is served from a subfolder — GitHub Pages puts
 * it under /<repository>/ — Vite's base path has to go in front of them. Locally the
 * base is "/", so nothing changes.
 */
export function assetUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  return import.meta.env.BASE_URL + path.slice(1);
}
