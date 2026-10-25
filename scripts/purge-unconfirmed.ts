/**
 * Delete unconfirmed alert signups older than 7 days, and their send-log rows.
 *
 *   ALERTS_SOURCE=d1 npx tsx scripts/purge-unconfirmed.ts
 *
 * Without ALERTS_SOURCE=d1 this updates the local dev files. The model watcher
 * sets ALERTS_SOURCE=d1. Safe to run repeatedly.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { purgeUnconfirmedRecords, unconfirmedPurgeStatements, type PurgeSend, type PurgeSubscriber } from "../src/lib/alerts/retention.ts";
import { redactLogText } from "../src/lib/alerts/redact.ts";
import { d1Execute } from "./d1.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const subscribersPath = path.join(root, "data", "subscribers.json");
const sendsPath = path.join(root, "data", "alert-sends.json");
const remote = process.env.ALERTS_SOURCE === "d1";

function purgeRemote(now: number) {
  const statements = unconfirmedPurgeStatements(now);
  d1Execute(root, statements.sends);
  const subscribers = d1Execute(root, statements.subscribers);
  console.log(`Purged ${subscribers.changes} unconfirmed subscriber(s).`);
}

function purgeLocal(now: number) {
  if (!existsSync(subscribersPath)) {
    console.log("Purged 0 unconfirmed subscriber(s).");
    return;
  }
  const subscribers = JSON.parse(readFileSync(subscribersPath, "utf8")) as PurgeSubscriber[];
  const sends = existsSync(sendsPath) ? (JSON.parse(readFileSync(sendsPath, "utf8")) as PurgeSend[]) : [];
  const next = purgeUnconfirmedRecords(subscribers, sends, now);
  mkdirSync(path.dirname(subscribersPath), { recursive: true });
  writeFileSync(subscribersPath, JSON.stringify(next.subscribers, null, 2));
  if (existsSync(sendsPath) || next.sends.length) writeFileSync(sendsPath, JSON.stringify(next.sends, null, 2));
  console.log(`Purged ${next.removed} unconfirmed subscriber(s).`);
}

try {
  if (remote) purgeRemote(Date.now());
  else purgeLocal(Date.now());
} catch (error) {
  console.error(redactLogText(error instanceof Error ? error.message : "Unconfirmed purge failed."));
  console.error("Unconfirmed purge failed. If D1 is missing confirm_sent_at, apply schema/migrate-2026-10-24-confirm-sent.sql.");
  process.exit(1);
}
