# url-shortener

Serverless URL shortener on **Cloudflare Workers**, deployed with **Wrangler**, built with **Bun** and **TypeScript only**.

- **D1** (SQLite) = source of truth — durable, strongly consistent, 30-day [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) restore.
- **KV** = hot read cache for fast edge redirects, plus sessions/challenges.
- **Auth = passwordless.** Two independent methods:
  - **Passkey** (WebAuthn) — works with zero external setup.
  - **Sign in with Google** — locked to `alfredwesterveld@gmail.com`.
- **No native dialogs** — custom in-page modal (delete confirm) + toast (messages). No `alert/confirm/prompt`.
- Custom slugs (`cq.fyi/blog`) with random fallback (`cq.fyi/aB3xY9z`).
- Domain: **cq.fyi**.

## Cost

Fits the Cloudflare **free tier** (Workers 100k req/day, D1 5M reads/day + 5GB, KV 100k reads/day). ~$0 for personal use.

## Auth model

| Method | Setup | Notes |
|--------|-------|-------|
| Passkey | none (code-only) | Enroll only while signed in (no anonymous bootstrap). Each passkey is owned by the email that enrolled it; login as that user. |
| Google | manual OAuth client (see below) | `id_token` email must be verified **and** allowed (owner or on the allowlist). |

**Access control (allowlist).** Only approved accounts may sign in:
- `OWNER_EMAIL` (`alfredwesterveld@gmail.com`) is the super-admin — always allowed, and the only one who can manage the allowlist.
- Everyone else must be added to the `allowed_users` table. The owner adds/removes them from the **Allowed users** panel on the dashboard.
- Revoking a user deletes their passkeys too, and is enforced on every request — existing sessions/passkeys stop working immediately.

Login with either method is independent. Sessions are opaque tokens in KV (30-day TTL), `HttpOnly; Secure; SameSite=Lax` cookie, storing the signed-in email.

> **Passkeys bind to the registrable domain (`cq.fyi`).** Test passkeys on the deployed site, not `localhost` — wrangler dev applies the custom-domain host, so the WebAuthn origin won't match a local browser.

## One-time setup

```sh
bun install

# 1. D1 — copy database_id into wrangler.jsonc
wrangler d1 create url-shortener

# 2. Two KV namespaces — copy each id into wrangler.jsonc
wrangler kv namespace create LINKS_CACHE
wrangler kv namespace create AUTH

# 3. Apply schema to remote D1
bun run db:schema:remote
```

Fill the `REPLACE_WITH_*` placeholders in `wrangler.jsonc`.

### Google sign-in (optional — passkey works without it)

Google has **no API/CLI to create an OAuth client** — this step is console-only.

Step-by-step:

1. **Project** — https://console.cloud.google.com/ → top bar project picker → **New Project** → name it (e.g. `cq-fyi`) → Create.
2. **Consent screen** — **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create.
   - App name (e.g. `cq.fyi links`), user support email, developer email → Save and continue.
   - Scopes: skip (the app only needs `openid` + `email`, requested at runtime) → Save and continue.
   - **Test users → Add users →** `alfredwesterveld@gmail.com` → Save. (Leaving the app in "Testing" is fine for personal use — no Google verification needed.)
3. **Create the client** — **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Name: anything.
   - **Authorized redirect URIs → Add URI:** `https://cq.fyi/auth/google/callback`
   - Create.
4. A dialog shows **Client ID** and **Client secret** (`GOCSPX-…`). Keep it open for the next steps.
5. Put the **Client ID** in `wrangler.jsonc` → `vars.GOOGLE_CLIENT_ID`, then `bun run deploy`.
6. Store the **Client secret** — run this in your **own terminal** (Terminal.app / VS Code terminal), not inside an AI agent session:
   ```sh
   cd /path/to/url-shortener
   wrangler secret put GOOGLE_CLIENT_SECRET
   # at "Enter a secret value:" paste the GOCSPX-… secret (input is hidden) → Enter
   ```
   Prints `✨ Success! Uploaded secret GOOGLE_CLIENT_SECRET`. No redeploy needed — live immediately.
7. Lost the secret? Console → **Credentials → your OAuth client → Add secret / Reset secret** mints a new `GOCSPX-…` (resetting kills the old one).

Verify it took: `wrangler secret list` shows `GOOGLE_CLIENT_SECRET` (name only, never the value).

Leave `GOOGLE_CLIENT_ID` empty to disable Google entirely — the login page then shows passkey only.

#### Which value is secret? (how to handle each)

| Value | Secret? | Where it lives | Safe to share/commit? |
|-------|---------|----------------|------------------------|
| **Client ID** (`…apps.googleusercontent.com`) | No — public by design (appears in browser redirect URLs) | `wrangler.jsonc` `vars` (committed) | **Yes** |
| **Client secret** (`GOCSPX-…`) | **Yes** | Cloudflare secret via `wrangler secret put` (encrypted, never in git) | **No — never paste in chat, never commit** |

**Secure handling of the client secret:**
- Set it with `wrangler secret put` from **your own terminal**, not via an AI agent's shell (an agent can see command output; the dedicated terminal keeps the value entirely between you and Cloudflare). The prompt reads hidden input — the value is never echoed, logged, or written to the repo.
- Never pass it as a CLI argument or pipe it in (`--text "…"`, `echo "…" | …`) — those land the value in shell history and process output.
- The Client ID is fine to hand to anyone, including pasting into a chat; only the `GOCSPX-…` secret needs this care.

## Deploy

```sh
bun run deploy
```

Then visit `https://cq.fyi/login`, click **Use a passkey** → it self-enrolls the first passkey, and you're in. Add more passkeys or sign out from the dashboard.

The `routes` entry binds `cq.fyi` as a custom domain (must be an active zone in your Cloudflare account).

## Routes

```
GET  /:slug                          public  -> 302 redirect (KV→D1), async click bump
GET  /login                          public  -> login page (Google + passkey)
GET  /                               session -> dashboard
POST /api/links {url, slug?}         session -> create
DEL  /api/links/:slug                session -> delete
GET  /auth/google                    public  -> start Google OAuth
GET  /auth/google/callback           public  -> finish Google OAuth, set session
POST /auth/passkey/options           public  -> WebAuthn login options
POST /auth/passkey/verify            public  -> finish passkey login, set session
POST /auth/passkey/register/options  session* -> enroll options
POST /auth/passkey/register/verify   session* -> finish enroll
POST /auth/logout                    -> clear session
```
`session*` = session OR bootstrap (zero passkeys registered).

Files: `src/index.ts` router · `src/store.ts` links (D1+KV) · `src/session.ts` · `src/oauth.ts` Google · `src/webauthn.ts` passkeys · `src/login.ts` · `src/dashboard.ts` · `src/util.ts` · `src/types.ts`.

## Local dev

```sh
bun run db:schema:local
bun run dev          # routing works; passkey ceremony needs the deployed domain
```

## Scripts

| script | action |
|--------|--------|
| `bun run dev` | local Worker |
| `bun run deploy` | deploy to Cloudflare |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run db:schema:remote` / `:local` | apply `schema.sql` |
| `bun run cf-typegen` | regenerate binding types |
