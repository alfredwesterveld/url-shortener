-- D1 schema for the URL shortener (source of truth).
CREATE TABLE IF NOT EXISTS links (
  slug       TEXT PRIMARY KEY,
  url        TEXT NOT NULL,
  clicks     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL          -- unix epoch ms
);

CREATE INDEX IF NOT EXISTS idx_links_created_at ON links (created_at DESC);

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
