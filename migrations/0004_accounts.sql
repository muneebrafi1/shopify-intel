-- 0004_accounts.sql — accounts, sessions and Pro through Whop (code only until the owner sets up
-- a Whop app and product; nothing here talks to Whop on its own).
--
-- Sign-in is "Sign in with Whop" (OAuth 2.1 + PKCE, OpenID Connect). A user row is keyed by the
-- Whop user id (`sub`, 'user_…'); the email is the one Whop shares with the `email` scope.
-- Plans come from Whop memberships, delivered by signed webhooks (src/server/whop/webhook.ts).
ALTER TABLE users ADD COLUMN whop_user_id TEXT;        -- 'user_…' (OAuth sub); NULL for none
ALTER TABLE users ADD COLUMN name TEXT;                -- display name from Whop (profile scope)
ALTER TABLE users ADD COLUMN last_sign_in_at TEXT;
CREATE UNIQUE INDEX idx_users_whop_user ON users (whop_user_id);

-- Server-side sessions: the cookie carries a random token, the table only its SHA-256.
CREATE TABLE user_sessions (
  token_hash TEXT PRIMARY KEY,           -- hex SHA-256 of the cookie token
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_user_sessions_user ON user_sessions (user_id);
CREATE INDEX idx_user_sessions_expires ON user_sessions (expires_at);

-- Whop memberships as last reported by a webhook. A membership may arrive before its user ever
-- signs in; it is matched by whop_user_id at sign-in. users.plan is derived from these rows.
CREATE TABLE whop_memberships (
  id TEXT PRIMARY KEY,                   -- 'mem_…'
  whop_user_id TEXT,                     -- 'user_…'
  product_id TEXT NOT NULL,              -- 'prod_…'
  variant_id TEXT,                       -- the plan/variant bought (monthly, yearly…)
  status TEXT NOT NULL,                  -- Whop MembershipStatus as sent
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
  current_period_end TEXT,
  manage_url TEXT,
  event_at TEXT NOT NULL,                -- envelope timestamp of the event that wrote this row
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_whop_memberships_user ON whop_memberships (whop_user_id);

-- Every accepted webhook id, so a redelivery is acknowledged without being applied twice.
CREATE TABLE whop_webhook_events (
  id TEXT PRIMARY KEY,                   -- webhook-id header ('msg_…')
  type TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE INDEX idx_whop_webhook_events_received ON whop_webhook_events (received_at);
