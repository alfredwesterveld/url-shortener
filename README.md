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
| Passkey | none (code-only) | First passkey self-enrolls (trust-on-first-use, since no credentials exist). After that, enrolling more passkeys requires an active session. |
| Google | manual OAuth client (see below) | `id_token` email must equal `OWNER_EMAIL` and be verified. |

Login with either is always independent. Sessions are opaque tokens in KV (30-day TTL), `HttpOnly; Secure; SameSite=Lax` cookie.

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
4. A dialog shows **Client ID** and **Client secret**. Keep it open for the next two steps.
5. Put the **Client ID** in `wrangler.jsonc` → `vars.GOOGLE_CLIENT_ID`.
6. Store the **Client secret** (never commit it):
   ```sh
   wrangler secret put GOOGLE_CLIENT_SECRET   # paste the secret at the prompt
   ```
7. Redeploy: `bun run deploy`. The login page now shows **Sign in with Google**.

Leave `GOOGLE_CLIENT_ID` empty to disable Google entirely — the login page then shows passkey only.

#### Which value is secret?

| Value | Secret? | Where it lives | Safe to share/commit? |
|-------|---------|----------------|------------------------|
| **Client ID** | No — it's public by design (appears in browser redirect URLs) | `wrangler.jsonc` `vars` (committed) | **Yes** |
| **Client secret** | **Yes** | Cloudflare secret via `wrangler secret put` (encrypted, never in git) | **No — never paste in chat or commit** |

`wrangler secret put` prompts interactively and uploads the value straight to Cloudflare encrypted storage; it never lands in the repo or in any log. That is the secure path — the secret stays between you and Cloudflare.

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
