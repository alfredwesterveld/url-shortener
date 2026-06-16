-- D1 schema for the URL shortener (source of truth).
CREATE TABLE IF NOT EXISTS links (
  slug        TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  clicks      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,        -- unix epoch ms
  expires_at  INTEGER,                 -- unix epoch ms; NULL = never expires
  owner_email TEXT,                    -- creator; NULL only for legacy pre-ownership rows
  team_id     TEXT                     -- owning team; NULL = private to owner_email
);

CREATE INDEX IF NOT EXISTS idx_links_created_at ON links (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_links_owner ON links (owner_email);
CREATE INDEX IF NOT EXISTS idx_links_team ON links (team_id);

-- Teams: a named group whose members all see the team's links.
CREATE TABLE IF NOT EXISTS teams (
  id         TEXT PRIMARY KEY,         -- random id
  name       TEXT NOT NULL,
  created_by TEXT NOT NULL,            -- owner email that created it
  created_at INTEGER NOT NULL
);

-- Team membership. A user sees a team's links iff they have a row here.
CREATE TABLE IF NOT EXISTS team_members (
  team_id  TEXT NOT NULL,
  email    TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, email)
);

CREATE INDEX IF NOT EXISTS idx_team_members_email ON team_members (email);

-- Per-click events for analytics (timeseries, country, referrer).
CREATE TABLE IF NOT EXISTS click_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  slug      TEXT NOT NULL,
  ts        INTEGER NOT NULL,          -- unix epoch ms
  country   TEXT,                      -- ISO country from request.cf.country
  referrer  TEXT                       -- Referer header host, may be null
);

CREATE INDEX IF NOT EXISTS idx_click_events_slug_ts ON click_events (slug, ts DESC);

-- Approved users. The OWNER_EMAIL is always allowed implicitly (super-admin)
-- and does not need a row here.
CREATE TABLE IF NOT EXISTS allowed_users (
  email     TEXT PRIMARY KEY,
  added_by  TEXT,
  added_at  INTEGER NOT NULL
);

-- Registered passkeys (WebAuthn credentials), each owned by a user email.
CREATE TABLE IF NOT EXISTS credentials (
  id          TEXT PRIMARY KEY,        -- base64url credential ID
  user_email  TEXT NOT NULL,           -- owner of this passkey
  public_key  TEXT NOT NULL,           -- base64url COSE public key
  counter     INTEGER NOT NULL DEFAULT 0,
  transports  TEXT,                    -- JSON array, may be null
  label       TEXT,                    -- human label (user agent hint)
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials (user_email);
