-- Cloudflare D1 schema for GPUfit alert signups.
-- Fresh database:
--   npx wrangler d1 execute gpufit --remote --file=schema/subscribers.sql
-- Existing database created before confirm_sent_at (run once):
--   npx wrangler d1 execute gpufit --remote --file=schema/migrate-2026-10-24-confirm-sent.sql

CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  device_id TEXT NOT NULL,
  memory_gb REAL NOT NULL,
  system_ram_gb REAL NOT NULL,
  drives_display INTEGER NOT NULL,
  ram_bandwidth_gbps REAL NOT NULL,
  weekly_digest INTEGER NOT NULL DEFAULT 1,
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  confirm_sent_at TEXT
);

CREATE INDEX IF NOT EXISTS subscribers_confirmed ON subscribers (confirmed);

-- scripts/purge-unconfirmed.ts deletes confirmed = 0 rows whose latest
-- confirmation attempt (confirm_sent_at, else created_at) is older than 7 days.
-- The model watcher runs that script. It also deletes matching alert_sends rows.

-- One row per subscriber and model after a fit email is accepted.
-- The matcher uses this to avoid sending the same model twice.
CREATE TABLE IF NOT EXISTS alert_sends (
  subscriber_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (subscriber_id, model_id)
);
