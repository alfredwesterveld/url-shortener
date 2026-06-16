-- Migration: per-user ownership + teams.
-- Apply with:  bun run db:migrate:remote   (tracks applied state, idempotent)
-- (SQLite has no "ADD COLUMN IF NOT EXISTS"; the migration runner applies it
--  exactly once.)

ALTER TABLE links ADD COLUMN owner_email TEXT;
ALTER TABLE links ADD COLUMN team_id TEXT;

CREATE INDEX IF NOT EXISTS idx_links_owner ON links (owner_email);
CREATE INDEX IF NOT EXISTS idx_links_team ON links (team_id);

CREATE TABLE IF NOT EXISTS teams (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id  TEXT NOT NULL,
  email    TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, email)
);

CREATE INDEX IF NOT EXISTS idx_team_members_email ON team_members (email);

-- Backfill: adopt all legacy links as the owner's private links.
-- Replace the email below with your OWNER_EMAIL before running.
UPDATE links SET owner_email = 'alfredwesterveld@gmail.com' WHERE owner_email IS NULL;
