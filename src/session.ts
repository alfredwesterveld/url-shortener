import type { Env } from "./types";
import { parseCookies, randomToken } from "./util";

const COOKIE = "sid";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function cookieAttrs(host: string): string {
  const secure = host.startsWith("localhost") || host.startsWith("127.") ? "" : " Secure;";
  return `Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${TTL_SECONDS}`;
}

/** Create a server-side session, return a Set-Cookie value. */
export async function createSession(env: Env, host: string): Promise<string> {
  const token = randomToken();
  await env.AUTH.put(`sess:${token}`, env.OWNER_EMAIL, { expirationTtl: TTL_SECONDS });
  return `${COOKIE}=${token}; ${cookieAttrs(host)}`;
}

/** Return the owner email if the request carries a valid session, else null. */
export async function getSession(request: Request, env: Env): Promise<string | null> {
  const token = parseCookies(request)[COOKIE];
  if (!token) return null;
  return env.AUTH.get(`sess:${token}`);
}

export async function destroySession(request: Request, env: Env, host: string): Promise<string> {
  const token = parseCookies(request)[COOKIE];
  if (token) await env.AUTH.delete(`sess:${token}`);
  const secure = host.startsWith("localhost") || host.startsWith("127.") ? "" : " Secure;";
  return `${COOKIE}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`;
}
