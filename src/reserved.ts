// Slugs that collide with real routes or assets. Keep in sync with the
// router in index.ts — any top-level path segment handled there must appear
// here so it can never be claimed as a short-link slug.
export const RESERVED = new Set([
  "",
  "api",
  "auth",
  "login",
  "stats",
  "favicon.ico",
  "robots.txt",
]);

export function isReserved(slug: string): boolean {
  return RESERVED.has(slug.toLowerCase());
}
