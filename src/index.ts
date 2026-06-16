import type { Env } from "./types";
import { json, html } from "./util";
import { getSession, destroySession } from "./session";
import { renderLogin } from "./login";
import { renderDashboard } from "./dashboard";
import { startGoogleLogin, handleGoogleCallback } from "./oauth";
import {
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
} from "./webauthn";
import { createLink, deleteLink, listLinks, resolve, bumpClicks } from "./store";
import { isOwner, isAllowed, listAllowed, addAllowed, removeAllowed } from "./access";

const RESERVED = new Set(["", "api", "auth", "login", "favicon.ico", "robots.txt"]);

/** Logged-in email that is still allowed, else null (handles live revocation). */
async function currentUser(request: Request, env: Env): Promise<string | null> {
  const email = await getSession(request, env);
  if (!email) return null;
  return (await isAllowed(env, email)) ? email : null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID);

    // ---------------- Auth endpoints (public) ----------------
    if (path === "/login") {
      if (await getSession(request, env)) return Response.redirect(`${url.origin}/`, 302);
      return html(renderLogin(env, googleEnabled));
    }
    if (path === "/auth/logout" && method === "POST") {
      const clear = await destroySession(request, env, url.host);
      return json({ ok: true }, 200, { "Set-Cookie": clear });
    }
    if (path === "/auth/google" && method === "GET") {
      return startGoogleLogin(env, url.origin);
    }
    if (path === "/auth/google/callback" && method === "GET") {
      return handleGoogleCallback(request, env, url.origin);
    }
    if (path === "/auth/passkey/options" && method === "POST") {
      return authenticationOptions(request, env);
    }
    if (path === "/auth/passkey/verify" && method === "POST") {
      return verifyAuthentication(request, env);
    }

    // Passkey enrollment: must be signed in (no anonymous bootstrap).
    if (path === "/auth/passkey/register/options" && method === "POST") {
      const email = await currentUser(request, env);
      if (!email) return json({ error: "Sign in first to add a passkey." }, 401);
      return registrationOptions(request, env, email);
    }
    if (path === "/auth/passkey/register/verify" && method === "POST") {
      const email = await currentUser(request, env);
      if (!email) return json({ error: "Sign in first to add a passkey." }, 401);
      return verifyRegistration(request, env, email);
    }

    // ---------------- Dashboard (protected) ----------------
    if (path === "/" || path === "/index.html") {
      const email = await currentUser(request, env);
      if (!email) return Response.redirect(`${url.origin}/login`, 302);
      const owner = isOwner(env, email);
      const [links, allowed] = await Promise.all([
        listLinks(env),
        owner ? listAllowed(env) : Promise.resolve([]),
      ]);
      return html(renderDashboard(env, links, email, owner, allowed));
    }

    // ---------------- User allowlist (owner only) ----------------
    if (path === "/api/users" && method === "POST") {
      const email = await currentUser(request, env);
      if (!email || !isOwner(env, email)) return json({ error: "Owner only." }, 403);
      let payload: { email?: unknown };
      try {
        payload = await request.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      const target = typeof payload.email === "string" ? payload.email : "";
      const result = await addAllowed(env, target, email);
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ email: result.email }, 201);
    }
    if (path.startsWith("/api/users/") && method === "DELETE") {
      const email = await currentUser(request, env);
      if (!email || !isOwner(env, email)) return json({ error: "Owner only." }, 403);
      const target = decodeURIComponent(path.slice("/api/users/".length));
      if (!target) return json({ error: "Missing email." }, 400);
      await removeAllowed(env, target);
      return json({ ok: true });
    }

    // ---------------- Write API (protected) ----------------
    if (path === "/api/links" && method === "POST") {
      if (!(await currentUser(request, env))) return json({ error: "Unauthorized." }, 401);
      let payload: { url?: unknown; slug?: unknown };
      try {
        payload = await request.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      const target = typeof payload.url === "string" ? payload.url : "";
      const slug = typeof payload.slug === "string" && payload.slug ? payload.slug : undefined;
      const result = await createLink(env, target, slug);
      if (!result.ok) return json({ error: result.error }, 400);
      const base = env.BASE_URL.replace(/\/$/, "");
      return json({ slug: result.slug, short: `${base}/${result.slug}` }, 201);
    }
    if (path.startsWith("/api/links/") && method === "DELETE") {
      if (!(await currentUser(request, env))) return json({ error: "Unauthorized." }, 401);
      const slug = decodeURIComponent(path.slice("/api/links/".length));
      if (!slug) return json({ error: "Missing slug." }, 400);
      await deleteLink(env, slug);
      return json({ ok: true });
    }

    if (path === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: { "content-type": "text/plain" },
      });
    }

    // ---------------- Redirect (public) ----------------
    if (method === "GET" || method === "HEAD") {
      const slug = decodeURIComponent(path.slice(1));
      if (!RESERVED.has(slug) && !slug.includes("/")) {
        const dest = await resolve(env, slug);
        if (dest) {
          ctx.waitUntil(bumpClicks(env, slug));
          return Response.redirect(dest, 302);
        }
      }
      return new Response("Not found.", { status: 404 });
    }

    return new Response("Method not allowed.", { status: 405 });
  },
} satisfies ExportedHandler<Env>;
