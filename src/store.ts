import type { Env, LinkRow } from "./types";

const SLUG_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function randomSlug(len = 7): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += SLUG_ALPHABET[bytes[i]! % SLUG_ALPHABET.length];
  return out;
}

/** Resolve a slug to its URL. KV cache first, fall back to D1 and warm the cache. */
export async function resolve(env: Env, slug: string): Promise<string | null> {
  const cached = await env.LINKS_CACHE.get(slug);
  if (cached !== null) return cached;

  const row = await env.DB.prepare("SELECT url FROM links WHERE slug = ?")
    .bind(slug)
    .first<{ url: string }>();
  if (!row) return null;

  await env.LINKS_CACHE.put(slug, row.url);
  return row.url;
}

/** Fire-and-forget click increment in D1 (use with ctx.waitUntil). */
export function bumpClicks(env: Env, slug: string): Promise<unknown> {
  return env.DB.prepare("UPDATE links SET clicks = clicks + 1 WHERE slug = ?")
    .bind(slug)
    .run();
}

export async function listLinks(env: Env, limit = 200): Promise<LinkRow[]> {
  const res = await env.DB.prepare(
    "SELECT slug, url, clicks, created_at FROM links ORDER BY created_at DESC LIMIT ?",
  )
    .bind(limit)
    .all<LinkRow>();
  return res.results ?? [];
}

export interface CreateResult {
  ok: boolean;
  slug?: string;
  error?: string;
}

/** Create a link. Custom slug if given+free, else generate a unique random one. */
export async function createLink(
  env: Env,
  url: string,
  customSlug?: string,
): Promise<CreateResult> {
  if (!isValidUrl(url)) return { ok: false, error: "Invalid URL (must be http/https)." };

  let slug: string;
  if (customSlug) {
    if (!isValidSlug(customSlug)) {
      return { ok: false, error: "Slug must be 1-128 chars of A-Z a-z 0-9 _ -." };
    }
    slug = customSlug;
  } else {
    slug = await uniqueRandomSlug(env);
  }

  const now = Date.now();
  try {
    await env.DB.prepare(
      "INSERT INTO links (slug, url, clicks, created_at) VALUES (?, ?, 0, ?)",
    )
      .bind(slug, url, now)
      .run();
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg.includes("UNIQUE") || msg.includes("constraint")) {
      return { ok: false, error: `Slug "${slug}" already taken.` };
    }
    throw e;
  }

  await env.LINKS_CACHE.put(slug, url);
  return { ok: true, slug };
}

export async function deleteLink(env: Env, slug: string): Promise<void> {
  await env.DB.prepare("DELETE FROM links WHERE slug = ?").bind(slug).run();
  await env.LINKS_CACHE.delete(slug);
}

async function uniqueRandomSlug(env: Env): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = randomSlug(7 + attempt); // grow length on collision
    const exists = await env.DB.prepare("SELECT 1 FROM links WHERE slug = ?")
      .bind(slug)
      .first();
    if (!exists) return slug;
  }
  throw new Error("Could not generate a unique slug.");
}
