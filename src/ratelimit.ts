import type { Env } from "./types";

// Simple fixed-window rate limiter backed by the AUTH KV namespace.
// Avoids the unsafe ratelimit binding so it works in plain wrangler config.
const WINDOW_SECONDS = 60;
const MAX_PER_WINDOW = 30;

export interface RateResult {
  ok: boolean;
  remaining: number;
}

/** Count one action for `key`; deny once MAX_PER_WINDOW is exceeded in the window. */
export async function rateLimit(
  env: Env,
  key: string,
  max = MAX_PER_WINDOW,
): Promise<RateResult> {
  const bucket = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
  const k = `rl:${key}:${bucket}`;
  const current = Number((await env.AUTH.get(k)) ?? "0");
  if (current >= max) return { ok: false, remaining: 0 };
  await env.AUTH.put(k, String(current + 1), { expirationTtl: WINDOW_SECONDS * 2 });
  return { ok: true, remaining: max - current - 1 };
}
