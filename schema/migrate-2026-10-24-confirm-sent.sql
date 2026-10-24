-- Add the per-email confirmation cooldown column. Run once on a database
-- created before this column existed. Fresh installs use schema/subscribers.sql
-- and should not run this file (SQLite rejects a duplicate column).
--
--   npx wrangler d1 execute gpufit --remote --file=schema/migrate-2026-10-24-confirm-sent.sql

ALTER TABLE subscribers ADD COLUMN confirm_sent_at TEXT;
