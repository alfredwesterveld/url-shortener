-- Migration: add link expiry + per-click analytics events.
-- Apply once to an existing DB (schema.sql covers fresh DBs):
--   wrangler d1 execute url-shortener --remote --file=./migrations/001_analytics_expiry.sql

ALTER TABLE links ADD COLUMN expires_at INTEGER;

CREATE TABLE IF NOT EXISTS click_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  slug      TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  country   TEXT,
  referrer  TEXT
);

CREATE INDEX IF NOT EXISTS idx_click_events_slug_ts ON click_events (slug, ts DESC);
