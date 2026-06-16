import type { Env } from "./types";
import { json, html } from "./util";
import { getSession, destroySession } from "./session";
import { renderLogin } from "./login";
import { renderDashboard } from "./dashboard";
import { renderNotFound } from "./notfound";
import { startGoogleLogin, handleGoogleCallback } from "./oauth";
import {
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
  listUserCredentials,
  renameCredential,
  deleteCredential,
} from "./webauthn";
import {
  createLink,
  updateLink,
  deleteLink,
  moveLink,
  listLinks,
  resolve,
  bumpClicks,
  getStats,
  canAccess,
  type LinkView,
} from "./store";
import { exportCsv, importCsv } from "./csv";
import { qrSvg } from "./qr";
import { rateLimit } from "./ratelimit";
import { RESERVED } from "./reserved";
import { isOwner, isAllowed, listAllowed, addAllowed, removeAllowed } from "./access";
import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeamsForUser,
  listMembers,
  addMember,
  removeMember,
  getActiveTeam,
  setActiveTeam,
  isMember,
} from "./teams";

/** Logged-in email that is still allowed, else null (handles live revocation). */
async function currentUser(request: Request, env: Env): Promise<string | null> {
  const email = await getSession(request, env);
  if (!email) return null;
  return (await isAllowed(env, email)) ? email : null;
}

/** The bucket a user is acting in: their active team, else their private links. */
async function viewFor(env: Env, user: string): Promise<LinkView> {
  return { ownerEmail: user, teamId: await getActiveTeam(env, user) };
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

    // ---------------- Passkey management (protected) ----------------
    if (path === "/api/passkeys" && method === "GET") {
      const email = await currentUser(request, env);
      if (!email) return json({ error: "Unauthorized." }, 401);
      return json({ passkeys: await listUserCredentials(env, email) });
    }
    if (path.startsWith("/api/passkeys/") && (method === "PATCH" || method === "DELETE")) {
      const email = await currentUser(request, env);
      if (!email) return json({ error: "Unauthorized." }, 401);
      const id = decodeURIComponent(path.slice("/api/passkeys/".length));
      if (!id) return json({ error: "Missing passkey id." }, 400);
      if (method === "DELETE") {
        const ok = await deleteCredential(env, email, id);
        return ok ? json({ ok: true }) : json({ error: "Passkey not found." }, 404);
      }
      let body: { label?: unknown };
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      const label = typeof body.label === "string" ? body.label.trim() : "";
      if (!label) return json({ error: "Missing label." }, 400);
      const ok = await renameCredential(env, email, id, label);
      return ok ? json({ ok: true }) : json({ error: "Passkey not found." }, 404);
    }

    // ---------------- Dashboard (protected) ----------------
    if (path === "/" || path === "/index.html") {
      const email = await currentUser(request, env);
      if (!email) return Response.redirect(`${url.origin}/login`, 302);
      const owner = isOwner(env, email);
      const view = await viewFor(env, email);
      const [links, allowed, passkeys, teams] = await Promise.all([
        listLinks(env, view),
        owner ? listAllowed(env) : Promise.resolve([]),
        listUserCredentials(env, email),
        listTeamsForUser(env, email),
      ]);
      // Owner manages membership inline, so load each team's members.
      const teamMembers = owner
        ? Object.fromEntries(
            await Promise.all(
              teams.map(async (t) => [t.id, await listMembers(env, t.id)] as const),
            ),
          )
        : {};
      return html(
        renderDashboard(env, links, email, owner, allowed, passkeys, {
          teams,
          activeTeam: view.teamId,
          teamMembers,
        }),
      );
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

    // ---------------- Teams ----------------
    // Switch the active sharing context (any member of the target team).
    if (path === "/api/team/active" && method === "POST") {
      const user = await currentUser(request, env);
      if (!user) return json({ error: "Unauthorized." }, 401);
      let payload: { team_id?: unknown };
      try {
        payload = await request.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      const teamId = typeof payload.team_id === "string" && payload.team_id ? payload.team_id : null;
      const ok = await setActiveTeam(env, user, teamId);
      if (!ok) return json({ error: "Not a member of that team." }, 403);
      return json({ ok: true, team_id: teamId });
    }

    // Create a team (owner only).
    if (path === "/api/teams" && method === "POST") {
      const user = await currentUser(request, env);
      if (!user || !isOwner(env, user)) return json({ error: "Owner only." }, 403);
      let payload: { name?: unknown };
      try {
        payload = await request.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      const name = typeof payload.name === "string" ? payload.name : "";
      const result = await createTeam(env, name, user);
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ team: result.team }, 201);
    }

    // Team member add: POST /api/teams/:id/members  (owner only).
    if (path.startsWith("/api/teams/") && path.endsWith("/members") && method === "POST") {
      const user = await currentUser(request, env);
      if (!user || !isOwner(env, user)) return json({ error: "Owner only." }, 403);
      const teamId = decodeURIComponent(
        path.slice("/api/teams/".length, path.length - "/members".length),
      );
      let payload: { email?: unknown };
      try {
        payload = await request.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      const target = typeof payload.email === "string" ? payload.email : "";
      const result = await addMember(env, teamId, target);
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ email: result.email }, 201);
    }

    // Team member remove: DELETE /api/teams/:id/members/:email  (owner only).
    if (
      path.startsWith("/api/teams/") &&
      path.includes("/members/") &&
      method === "DELETE"
    ) {
      const user = await currentUser(request, env);
      if (!user || !isOwner(env, user)) return json({ error: "Owner only." }, 403);
      const rest = path.slice("/api/teams/".length);
      const sep = rest.indexOf("/members/");
      const teamId = decodeURIComponent(rest.slice(0, sep));
      const memberEmail = decodeURIComponent(rest.slice(sep + "/members/".length));
      if (!teamId || !memberEmail) return json({ error: "Missing team or email." }, 400);
      await removeMember(env, teamId, memberEmail);
      return json({ ok: true });
    }

    // Delete a team: DELETE /api/teams/:id  (owner only). Its links go private.
    if (path.startsWith("/api/teams/") && method === "DELETE") {
      const user = await currentUser(request, env);
      if (!user || !isOwner(env, user)) return json({ error: "Owner only." }, 403);
      const teamId = decodeURIComponent(path.slice("/api/teams/".length));
      if (!teamId) return json({ error: "Missing team id." }, 400);
      if (!(await getTeam(env, teamId))) return json({ error: "Team not found." }, 404);
      await deleteTeam(env, teamId);
      return json({ ok: true });
    }

    // ---------------- CSV import / export (protected) ----------------
    if (path === "/api/links/export" && method === "GET") {
      const user = await currentUser(request, env);
      if (!user) return json({ error: "Unauthorized." }, 401);
      return exportCsv(env, await viewFor(env, user));
    }
    if (path === "/api/links/import" && method === "POST") {
      const user = await currentUser(request, env);
      if (!user) return json({ error: "Unauthorized." }, 401);
      const text = await request.text();
      const result = await importCsv(env, text, await viewFor(env, user));
      return json(result, 200);
    }

    // ---------------- Analytics (protected) ----------------
    if (path.startsWith("/api/links/") && path.endsWith("/stats") && method === "GET") {
      const user = await currentUser(request, env);
      if (!user) return json({ error: "Unauthorized." }, 401);
      const slug = decodeURIComponent(
        path.slice("/api/links/".length, path.length - "/stats".length),
      );
      if (!slug) return json({ error: "Missing slug." }, 400);
      if (!(await canAccess(env, user, slug))) return json({ error: "Not found." }, 404);
      return json(await getStats(env, slug));
    }

    // ---------------- Write API (protected) ----------------
    if (path === "/api/links" && method === "POST") {
      const user = await currentUser(request, env);
      if (!user) return json({ error: "Unauthorized." }, 401);
      const rl = await rateLimit(env, `create:${user}`);
      if (!rl.ok) return json({ error: "Rate limit exceeded. Try again shortly." }, 429);
      let payload: { url?: unknown; slug?: unknown; expires_at?: unknown };
      try {
        payload = await request.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      const target = typeof payload.url === "string" ? payload.url : "";
      const slug = typeof payload.slug === "string" && payload.slug ? payload.slug : undefined;
      const expiresAt = typeof payload.expires_at === "number" ? payload.expires_at : null;
      const view = await viewFor(env, user);
      const result = await createLink(env, target, slug, expiresAt, view.ownerEmail, view.teamId);
      if (!result.ok) return json({ error: result.error }, 400);
      const base = env.BASE_URL.replace(/\/$/, "");
      return json({ slug: result.slug, short: `${base}/${result.slug}` }, 201);
    }
    // Move a link between private and a team: POST /api/links/:slug/move
    if (path.startsWith("/api/links/") && path.endsWith("/move") && method === "POST") {
      const user = await currentUser(request, env);
      if (!user) return json({ error: "Unauthorized." }, 401);
      const slug = decodeURIComponent(
        path.slice("/api/links/".length, path.length - "/move".length),
      );
      if (!slug) return json({ error: "Missing slug." }, 400);
      if (!(await canAccess(env, user, slug))) return json({ error: "Not found." }, 404);
      let payload: { team_id?: unknown };
      try {
        payload = await request.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      const teamId = typeof payload.team_id === "string" && payload.team_id ? payload.team_id : null;
      // Must be a member of the destination team to move a link into it.
      if (teamId && !(await isMember(env, teamId, user))) {
        return json({ error: "Not a member of that team." }, 403);
      }
      await moveLink(env, slug, teamId);
      return json({ ok: true });
    }
    if (path.startsWith("/api/links/") && method === "PATCH") {
      const user = await currentUser(request, env);
      if (!user) return json({ error: "Unauthorized." }, 401);
      const slug = decodeURIComponent(path.slice("/api/links/".length));
      if (!slug) return json({ error: "Missing slug." }, 400);
      if (!(await canAccess(env, user, slug))) return json({ error: "Not found." }, 404);
      let payload: { url?: unknown; expires_at?: unknown };
      try {
        payload = await request.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      const target = typeof payload.url === "string" ? payload.url : "";
      const expiresAt = typeof payload.expires_at === "number" ? payload.expires_at : null;
      const result = await updateLink(env, slug, target, expiresAt);
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ ok: true });
    }
    if (path.startsWith("/api/links/") && method === "DELETE") {
      const user = await currentUser(request, env);
      if (!user) return json({ error: "Unauthorized." }, 401);
      const slug = decodeURIComponent(path.slice("/api/links/".length));
      if (!slug) return json({ error: "Missing slug." }, 400);
      if (!(await canAccess(env, user, slug))) return json({ error: "Not found." }, 404);
      await deleteLink(env, slug);
      return json({ ok: true });
    }

    if (path === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: { "content-type": "text/plain" },
      });
    }

    // ---------------- QR code (public): /:slug/qr.svg ----------------
    if ((method === "GET" || method === "HEAD") && path.endsWith("/qr.svg")) {
      const slug = decodeURIComponent(path.slice(1, path.length - "/qr.svg".length));
      if (slug && !slug.includes("/") && !RESERVED.has(slug)) {
        return qrSvg(env, slug);
      }
    }

    // ---------------- Redirect (public) ----------------
    if (method === "GET" || method === "HEAD") {
      const slug = decodeURIComponent(path.slice(1));
      if (!RESERVED.has(slug) && !slug.includes("/")) {
        const r = await resolve(env, slug);
        if (r && "url" in r) {
          const country = (request.cf?.country as string | undefined) ?? null;
          const ref = referrerHost(request.headers.get("Referer"));
          ctx.waitUntil(bumpClicks(env, slug, country, ref));
          return Response.redirect(r.url, 302);
        }
        if (r && "expired" in r) {
          return html(renderNotFound(env, true), 410);
        }
      }
      return html(renderNotFound(env, false), 404);
    }

    return new Response("Method not allowed.", { status: 405 });
  },
} satisfies ExportedHandler<Env>;

/** Reduce a Referer URL to its host for compact analytics; null if absent. */
function referrerHost(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).host || null;
  } catch {
    return null;
  }
}
