export interface Env {
  DB: D1Database;
  LINKS_CACHE: KVNamespace;
  AUTH: KVNamespace; // sessions + short-lived WebAuthn/OAuth challenges

  BASE_URL: string; // e.g. https://cq.fyi
  OWNER_EMAIL: string; // only this Google account may sign in

  // Google OAuth (client id is public; secret is a wrangler secret).
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

export interface LinkRow {
  slug: string;
  url: string;
  clicks: number;
  created_at: number;
  expires_at: number | null;
  owner_email: string | null;
  team_id: string | null;
}

export interface TeamRow {
  id: string;
  name: string;
  created_by: string;
  created_at: number;
}

export interface TeamMemberRow {
  team_id: string;
  email: string;
  added_at: number;
}

export interface ClickEventRow {
  slug: string;
  ts: number;
  country: string | null;
  referrer: string | null;
}

export interface LinkStats {
  total: number;
  daily: { day: string; count: number }[]; // last 30 days
  countries: { country: string; count: number }[];
  referrers: { referrer: string; count: number }[];
}

export interface CredentialRow {
  id: string;
  user_email: string;
  public_key: string;
  counter: number;
  transports: string | null;
  label: string | null;
  created_at: number;
}

export interface AllowedUserRow {
  email: string;
  added_by: string | null;
  added_at: number;
}
