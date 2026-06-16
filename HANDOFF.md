# Handoff

## Status: LIVE in production
URL shortener deployed at **https://cq.fyi**. Both auth methods working (passkey + Google). All on `main`, pushed to github.com/alfredwesterveld/url-shortener.

## Stack
- Cloudflare Workers, **Bun + TypeScript only**, deployed via Wrangler.
- **D1** (`url-shortener`) = source of truth. **KV** `LINKS_CACHE` = redirect cache, `AUTH` = sessions + challenges.
- Passwordless: passkey (WebAuthn, `@simplewebauthn/server`) + Google OAuth (locked to `alfredwesterveld@gmail.com`).
- Custom in-page modal/toast, no native dialogs.

## Provisioned resources (already created)
- D1 `url-shortener` id `96fbea9e-682f-46da-96aa-1213f711ee90`
- KV `LINKS_CACHE` id `d31dbe83c4ac450fa52f050cb2d87f72`
- KV `AUTH` id `88ed9c66ebce4a24810698f7f4937a58`
- Secret `GOOGLE_CLIENT_SECRET` set (in Cloudflare, not repo)
- `GOOGLE_CLIENT_ID` in wrangler.jsonc (public)
- Custom domain `cq.fyi` bound

## Layout
`src/index.ts` router · `store.ts` links (D1+KV) · `access.ts` allowlist · `session.ts` · `oauth.ts` Google · `webauthn.ts` passkeys · `login.ts` · `dashboard.ts` · `util.ts` · `types.ts`. Schema in `schema.sql` (tables: `links`, `allowed_users`, `credentials`).

## Commands
- `bun run dev` · `bun run deploy` · `bun run typecheck`
- `bun run db:schema:remote` / `:local`
- Passkeys only testable on deployed domain (custom-domain host in dev breaks WebAuthn origin).

## Backlog / next ideas (not built)
1. **Analytics page** — clicks already counted in D1. Add per-link timeseries: new `clicks` event table (slug, ts, country via `request.cf.country`, referrer). Dashboard sparkline + top-referrers.
2. **QR codes** — generate per short link (SVG, client-side lib or a Worker route `/:slug/qr.svg`).
3. **Link expiry** — add `expires_at` column; redirect 410 when past; filter in cache. Optional max-clicks cap.
4. **Edit links** — currently create/delete only; add PATCH to change destination.
5. **Bulk import/export** — CSV in/out via dashboard.
6. **Custom 404 / branded landing** at apex for unknown slugs.
7. **Rate limiting** on create API (Workers rate-limit binding).
8. **UTM builder** in the create form.
9. **Multiple passkeys management UI** — list/rename/delete registered passkeys (table exists, no UI yet).
10. **Reserved-slug guard** — block slugs colliding with routes (`api`, `auth`, `login` already reserved in `RESERVED` set; keep in sync).

## Access control (built)
- **Email allowlist** in D1 `allowed_users`. Owner (`OWNER_EMAIL`) = super-admin, always allowed, only one who manages the list (dashboard "Allowed users" panel, `/api/users` POST/DELETE owner-only).
- Google login + passkey login both gated on `isAllowed`. Checked every request (`currentUser` in index.ts) → live revocation.
- Passkeys owned by user (`credentials.user_email`); no anonymous bootstrap. Revoking a user deletes their passkeys.

## Known notes
- Sessions: opaque KV tokens, 30-day TTL, store signed-in email.
- Google consent screen in "Testing" mode — fine for personal use, owner added as test user.
- Schema migration: `credentials` gained `user_email` (table was dropped+recreated remotely while empty); `allowed_users` added. 3 tables total.
