-- Cloudflare D1 schema for GPUfit alert signups.
-- Apply with: wrangler d1 execute gpufit --file=schema/subscribers.sql

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
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS subscribers_confirmed ON subscribers (confirmed);

-- One row per subscriber and model after a fit email is accepted.
-- The matcher uses this to avoid sending the same model twice.
CREATE TABLE IF NOT EXISTS alert_sends (
  subscriber_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (subscriber_id, model_id)
);
