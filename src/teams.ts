import type { Env, TeamRow, TeamMemberRow } from "./types";
import { isOwner } from "./access";
import { randomToken } from "./util";

const norm = (email: string): string => email.trim().toLowerCase();
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** KV key holding a user's currently active team (the link-sharing context). */
const activeKey = (email: string): string => `team:active:${norm(email)}`;

export interface TeamResult {
  ok: boolean;
  error?: string;
  team?: TeamRow;
}

/** Create a team (owner only — caller enforces). Creator is auto-added as member. */
export async function createTeam(env: Env, name: string, createdBy: string): Promise<TeamResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Team name required." };
  if (trimmed.length > 80) return { ok: false, error: "Team name too long (max 80)." };
  const id = randomToken(8);
  const now = Date.now();
  const creator = norm(createdBy);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO teams (id, name, created_by, created_at) VALUES (?, ?, ?, ?)")
      .bind(id, trimmed, creator, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO team_members (team_id, email, added_at) VALUES (?, ?, ?)",
    ).bind(id, creator, now),
  ]);
  return { ok: true, team: { id, name: trimmed, created_by: creator, created_at: now } };
}

/** Delete a team, its membership, and detach its links (back to private). */
export async function deleteTeam(env: Env, teamId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("UPDATE links SET team_id = NULL WHERE team_id = ?").bind(teamId),
    env.DB.prepare("DELETE FROM team_members WHERE team_id = ?").bind(teamId),
    env.DB.prepare("DELETE FROM teams WHERE id = ?").bind(teamId),
  ]);
}

export async function getTeam(env: Env, teamId: string): Promise<TeamRow | null> {
  return env.DB.prepare("SELECT id, name, created_by, created_at FROM teams WHERE id = ?")
    .bind(teamId)
    .first<TeamRow>();
}

/** All teams (owner view). */
export async function listTeams(env: Env): Promise<TeamRow[]> {
  const res = await env.DB.prepare(
    "SELECT id, name, created_by, created_at FROM teams ORDER BY created_at DESC",
  ).all<TeamRow>();
  return res.results ?? [];
}

/** Teams a user belongs to (the ones they can switch into). */
export async function listTeamsForUser(env: Env, email: string): Promise<TeamRow[]> {
  if (isOwner(env, email)) return listTeams(env); // owner is in every team implicitly
  const res = await env.DB.prepare(
    `SELECT t.id, t.name, t.created_by, t.created_at
     FROM teams t JOIN team_members m ON m.team_id = t.id
     WHERE m.email = ? ORDER BY t.created_at DESC`,
  )
    .bind(norm(email))
    .all<TeamRow>();
  return res.results ?? [];
}

export async function isMember(env: Env, teamId: string, email: string): Promise<boolean> {
  if (isOwner(env, email)) return true; // owner sees everything
  const row = await env.DB.prepare(
    "SELECT 1 FROM team_members WHERE team_id = ? AND email = ?",
  )
    .bind(teamId, norm(email))
    .first();
  return Boolean(row);
}

export async function listMembers(env: Env, teamId: string): Promise<TeamMemberRow[]> {
  const res = await env.DB.prepare(
    "SELECT team_id, email, added_at FROM team_members WHERE team_id = ? ORDER BY added_at",
  )
    .bind(teamId)
    .all<TeamMemberRow>();
  return res.results ?? [];
}

export interface AddMemberResult {
  ok: boolean;
  error?: string;
  email?: string;
}

export async function addMember(env: Env, teamId: string, rawEmail: string): Promise<AddMemberResult> {
  const email = norm(rawEmail);
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Invalid email address." };
  if (!(await getTeam(env, teamId))) return { ok: false, error: "Team not found." };
  await env.DB.prepare(
    "INSERT OR IGNORE INTO team_members (team_id, email, added_at) VALUES (?, ?, ?)",
  )
    .bind(teamId, email, Date.now())
    .run();
  return { ok: true, email };
}

export async function removeMember(env: Env, teamId: string, rawEmail: string): Promise<void> {
  const email = norm(rawEmail);
  await env.DB.prepare("DELETE FROM team_members WHERE team_id = ? AND email = ?")
    .bind(teamId, email)
    .run();
  // If that user had this team active, drop them back to private.
  if ((await getActiveTeam(env, email)) === teamId) await setActiveTeam(env, email, null);
}

/** Read a user's active team, validating they are still a member. */
export async function getActiveTeam(env: Env, email: string): Promise<string | null> {
  const teamId = await env.AUTH.get(activeKey(email));
  if (!teamId) return null;
  if (await isMember(env, teamId, email)) return teamId;
  await env.AUTH.delete(activeKey(email)); // stale (team deleted or membership revoked)
  return null;
}

/** Set (or clear, with null) the active team. Returns false if not a member. */
export async function setActiveTeam(env: Env, email: string, teamId: string | null): Promise<boolean> {
  if (teamId === null) {
    await env.AUTH.delete(activeKey(email));
    return true;
  }
  if (!(await isMember(env, teamId, email))) return false;
  await env.AUTH.put(activeKey(email), teamId);
  return true;
}
