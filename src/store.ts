import type { Env, LinkRow, LinkStats } from "./types";
import { isReserved } from "./reserved";
import { isMember } from "./teams";
import { isOwner } from "./access";

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

export type ResolveResult =
  | { url: string }
  | { expired: true }
  | null;

/** Compute the KV cache TTL (seconds) for a link, or undefined for no expiry. */
function cacheTtl(expiresAt: number | null): number | undefined {
  if (!expiresAt) return undefined;
  const secs = Math.floor((expiresAt - Date.now()) / 1000);
  // KV requires a minimum TTL of 60s; below that, skip caching.
  return secs >= 60 ? secs : undefined;
}

/** Resolve a slug. KV cache first, fall back to D1, honoring expiry. */
export async function resolve(env: Env, slug: string): Promise<ResolveResult> {
  const cached = await env.LINKS_CACHE.get(slug);
  if (cached !== null) return { url: cached };

  const row = await env.DB.prepare("SELECT url, expires_at FROM links WHERE slug = ?")
    .bind(slug)
    .first<{ url: string; expires_at: number | null }>();
  if (!row) return null;

  if (row.expires_at && row.expires_at <= Date.now()) return { expired: true };

  const ttl = cacheTtl(row.expires_at);
  await env.LINKS_CACHE.put(slug, row.url, ttl ? { expirationTtl: ttl } : undefined);
  return { url: row.url };
}

/** Fire-and-forget click increment + event log (use with ctx.waitUntil). */
export function bumpClicks(
  env: Env,
  slug: string,
  country?: string | null,
  referrer?: string | null,
): Promise<unknown> {
  return env.DB.batch([
    env.DB.prepare("UPDATE links SET clicks = clicks + 1 WHERE slug = ?").bind(slug),
    env.DB.prepare(
      "INSERT INTO click_events (slug, ts, country, referrer) VALUES (?, ?, ?, ?)",
    ).bind(slug, Date.now(), country ?? null, referrer ?? null),
  ]);
}

/**
 * The link bucket a request is acting in:
 *  - teamId set   → the team's shared links (caller verified membership)
 *  - teamId null  → the user's own private links (owner_email = ownerEmail, no team)
 */
export interface LinkView {
  ownerEmail: string;
  teamId: string | null;
}

const LINK_COLS = "slug, url, clicks, created_at, expires_at, owner_email, team_id";

export async function listLinks(env: Env, view: LinkView, limit = 200): Promise<LinkRow[]> {
  const res = view.teamId
    ? await env.DB.prepare(
        `SELECT ${LINK_COLS} FROM links WHERE team_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
        .bind(view.teamId, limit)
        .all<LinkRow>()
    : await env.DB.prepare(
        `SELECT ${LINK_COLS} FROM links
         WHERE owner_email = ? AND team_id IS NULL ORDER BY created_at DESC LIMIT ?`,
      )
        .bind(view.ownerEmail.trim().toLowerCase(), limit)
        .all<LinkRow>();
  return res.results ?? [];
}

/** Ownership/sharing of a single link, or null if it doesn't exist. */
export async function getOwnership(
  env: Env,
  slug: string,
): Promise<{ owner_email: string | null; team_id: string | null } | null> {
  return env.DB.prepare("SELECT owner_email, team_id FROM links WHERE slug = ?")
    .bind(slug)
    .first<{ owner_email: string | null; team_id: string | null }>();
}

/**
 * May `email` view/edit/delete this slug? True when they own it (private) or
 * are a member of its team. Owner is super-admin. Missing slug → false.
 */
export async function canAccess(env: Env, email: string, slug: string): Promise<boolean> {
  if (isOwner(env, email)) return true;
  const row = await getOwnership(env, slug);
  if (!row) return false;
  if (row.team_id) return isMember(env, row.team_id, email);
  return row.owner_email === email.trim().toLowerCase();
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
  expiresAt?: number | null,
  ownerEmail?: string,
  teamId?: string | null,
): Promise<CreateResult> {
  if (!isValidUrl(url)) return { ok: false, error: "Invalid URL (must be http/https)." };

  let slug: string;
  if (customSlug) {
    if (!isValidSlug(customSlug)) {
      return { ok: false, error: "Slug must be 1-128 chars of A-Z a-z 0-9 _ -." };
    }
    if (isReserved(customSlug)) {
      return { ok: false, error: `Slug "${customSlug}" is reserved.` };
    }
    slug = customSlug;
  } else {
    slug = await uniqueRandomSlug(env);
  }

  const exp = expiresAt && expiresAt > Date.now() ? expiresAt : null;
  const now = Date.now();
  try {
    await env.DB.prepare(
      "INSERT INTO links (slug, url, clicks, created_at, expires_at, owner_email, team_id) VALUES (?, ?, 0, ?, ?, ?, ?)",
    )
      .bind(slug, url, now, exp, ownerEmail?.trim().toLowerCase() ?? null, teamId ?? null)
      .run();
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg.includes("UNIQUE") || msg.includes("constraint")) {
      return { ok: false, error: `Slug "${slug}" already taken.` };
    }
    throw e;
  }

  const ttl = cacheTtl(exp);
  await env.LINKS_CACHE.put(slug, url, ttl ? { expirationTtl: ttl } : undefined);
  return { ok: true, slug };
}

export interface UpdateResult {
  ok: boolean;
  error?: string;
}

/** Edit a link's destination URL and/or expiry. */
export async function updateLink(
  env: Env,
  slug: string,
  url: string,
  expiresAt?: number | null,
): Promise<UpdateResult> {
  if (!isValidUrl(url)) return { ok: false, error: "Invalid URL (must be http/https)." };
  const exp = expiresAt && expiresAt > Date.now() ? expiresAt : null;
  const res = await env.DB.prepare(
    "UPDATE links SET url = ?, expires_at = ? WHERE slug = ?",
  )
    .bind(url, exp, slug)
    .run();
  if (!res.meta.changes) return { ok: false, error: "Link not found." };

  const ttl = cacheTtl(exp);
  if (exp && !ttl) await env.LINKS_CACHE.delete(slug); // already (near) expired
  else await env.LINKS_CACHE.put(slug, url, ttl ? { expirationTtl: ttl } : undefined);
  return { ok: true };
}

/** Move a link to a team (teamId set) or back to private (null). owner unchanged. */
export async function moveLink(env: Env, slug: string, teamId: string | null): Promise<void> {
  await env.DB.prepare("UPDATE links SET team_id = ? WHERE slug = ?")
    .bind(teamId, slug)
    .run();
}

export async function deleteLink(env: Env, slug: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM links WHERE slug = ?").bind(slug),
    env.DB.prepare("DELETE FROM click_events WHERE slug = ?").bind(slug),
  ]);
  await env.LINKS_CACHE.delete(slug);
}

/** Per-link analytics: 30-day daily timeseries, top countries + referrers. */
export async function getStats(env: Env, slug: string): Promise<LinkStats> {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const [daily, countries, referrers, total] = await Promise.all([
    env.DB.prepare(
      `SELECT date(ts / 1000, 'unixepoch') AS day, COUNT(*) AS count
       FROM click_events WHERE slug = ? AND ts >= ? GROUP BY day ORDER BY day`,
    )
      .bind(slug, since)
      .all<{ day: string; count: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(country, '??') AS country, COUNT(*) AS count
       FROM click_events WHERE slug = ? GROUP BY country ORDER BY count DESC LIMIT 10`,
    )
      .bind(slug)
      .all<{ country: string; count: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(referrer, 'direct') AS referrer, COUNT(*) AS count
       FROM click_events WHERE slug = ? GROUP BY referrer ORDER BY count DESC LIMIT 10`,
    )
      .bind(slug)
      .all<{ referrer: string; count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM click_events WHERE slug = ?")
      .bind(slug)
      .first<{ n: number }>(),
  ]);
  return {
    total: total?.n ?? 0,
    daily: daily.results ?? [],
    countries: countries.results ?? [],
    referrers: referrers.results ?? [],
  };
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
