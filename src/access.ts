import type { Env, AllowedUserRow } from "./types";

const norm = (email: string): string => email.trim().toLowerCase();

export function isOwner(env: Env, email: string): boolean {
  return norm(email) === norm(env.OWNER_EMAIL);
}

/** Owner is always allowed; everyone else must be on the allowlist. */
export async function isAllowed(env: Env, email: string): Promise<boolean> {
  if (isOwner(env, email)) return true;
  const row = await env.DB.prepare("SELECT 1 FROM allowed_users WHERE email = ?")
    .bind(norm(email))
    .first();
  return Boolean(row);
}

export async function listAllowed(env: Env): Promise<AllowedUserRow[]> {
  const res = await env.DB.prepare(
    "SELECT email, added_by, added_at FROM allowed_users ORDER BY added_at DESC",
  ).all<AllowedUserRow>();
  return res.results ?? [];
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface AddResult {
  ok: boolean;
  email?: string;
  error?: string;
}

export async function addAllowed(env: Env, rawEmail: string, addedBy: string): Promise<AddResult> {
  const email = norm(rawEmail);
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Invalid email address." };
  if (isOwner(env, email)) return { ok: false, error: "Owner already has access." };
  await env.DB.prepare(
    "INSERT OR IGNORE INTO allowed_users (email, added_by, added_at) VALUES (?, ?, ?)",
  )
    .bind(email, norm(addedBy), Date.now())
    .run();
  return { ok: true, email };
}

/** Remove a user from the allowlist and revoke all their passkeys. */
export async function removeAllowed(env: Env, rawEmail: string): Promise<void> {
  const email = norm(rawEmail);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM allowed_users WHERE email = ?").bind(email),
    env.DB.prepare("DELETE FROM credentials WHERE user_email = ?").bind(email),
  ]);
}
