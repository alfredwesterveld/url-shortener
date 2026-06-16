import type { Env } from "./types";
import { createSession } from "./session";
import { isAllowed } from "./access";
import { randomToken } from "./util";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const redirectUri = (origin: string): string => `${origin}/auth/google/callback`;

/** Step 1: redirect the browser to Google's consent screen. */
export async function startGoogleLogin(env: Env, origin: string): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID) {
    return new Response("Google login not configured.", { status: 503 });
  }
  const state = randomToken(16);
  await env.AUTH.put(`oauth:${state}`, "1", { expirationTtl: 600 });

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  });
  return Response.redirect(`${AUTH_ENDPOINT}?${params}`, 302);
}

/** Step 2: exchange the code, verify the email, mint a session. */
export async function handleGoogleCallback(
  request: Request,
  env: Env,
  origin: string,
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return loginError("Missing code/state.");

  const seen = await env.AUTH.get(`oauth:${state}`);
  if (!seen) return loginError("Invalid or expired login attempt.");
  await env.AUTH.delete(`oauth:${state}`);

  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri(origin),
    grant_type: "authorization_code",
  });
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) return loginError("Google token exchange failed.");
  const token = (await tokenRes.json()) as { id_token?: string };
  if (!token.id_token) return loginError("No id_token from Google.");

  const claims = decodeJwtPayload(token.id_token);
  // id_token comes straight from Google over our TLS backchannel, so it is trusted.
  const email = typeof claims?.["email"] === "string" ? (claims["email"] as string) : "";
  if (claims?.["email_verified"] !== true || !email) {
    return loginError("Google account email not verified.");
  }
  if (!(await isAllowed(env, email))) {
    return loginError("This account has not been granted access.");
  }

  const setCookie = await createSession(env, url.host, email);
  return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": setCookie } });
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function loginError(msg: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `/login?error=${encodeURIComponent(msg)}` },
  });
}
