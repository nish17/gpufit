/**
 * Match confirmed subscribers to newly tracked models that fit their machine.
 *
 * Dry run (default) reads data/subscribers.json and prints the mail. Nothing is sent.
 *
 *   npm run alerts:match
 *   npm run alerts:match -- --send
 *
 * `--send` delivers through Resend and records each pair so the next run skips it.
 * Set ALERTS_SOURCE=d1 to read and write Cloudflare D1 (needs wrangler auth).
 * Otherwise the local files data/subscribers.json and data/alert-sends.json are used.
 *
 * Required for --send: RESEND_API_KEY, ALERT_FROM, ALERT_TOKEN_SECRET.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planAlertMails, renderFitMail, type AlertSubscriber, type SentAlert } from "../src/lib/alerts/match.ts";
import { signAlert } from "../src/lib/alerts/token.ts";
import { DEFAULT_SITE } from "../src/lib/site.ts";
import type { DeviceSpec, ModelSpec } from "../src/lib/estimator/types.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const subscribersPath = path.join(root, "data", "subscribers.json");
const sendsPath = path.join(root, "data", "alert-sends.json");
const send = process.argv.includes("--send");
const remote = process.env.ALERTS_SOURCE === "d1";

const models = JSON.parse(readFileSync(path.join(root, "src/data/models.json"), "utf8")) as ModelSpec[];
const devices = JSON.parse(readFileSync(path.join(root, "src/data/hardware.json"), "utf8")) as DeviceSpec[];

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function parseD1(stdout: string): Record<string, unknown>[] {
  const trimmed = stdout.trim();
  const start = Math.min(
    ...["[", "{"].map((char) => {
      const index = trimmed.indexOf(char);
      return index === -1 ? Number.POSITIVE_INFINITY : index;
    }),
  );
  if (!Number.isFinite(start)) throw new Error("D1 did not return JSON.");
  const parsed = JSON.parse(trimmed.slice(start)) as { results?: Record<string, unknown>[] } | { results?: Record<string, unknown>[] }[];
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  return blocks.flatMap((block) => (Array.isArray(block.results) ? block.results : []));
}

function d1(sql: string): Record<string, unknown>[] {
  const stdout = execFileSync("npx", ["wrangler", "d1", "execute", "gpufit", "--remote", "--json", "--command", sql], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return parseD1(stdout);
}

function fromRow(row: Record<string, unknown>): AlertSubscriber {
  const email = String(row.email || "").trim().toLowerCase();
  const deviceId = String(row.device_id || row.deviceId || "");
  return {
    id: String(row.id || `${email}::${deviceId}`),
    email,
    deviceId,
    memoryGb: Number(row.memory_gb ?? row.memoryGb),
    systemRamGb: Number(row.system_ram_gb ?? row.systemRamGb),
    ramBandwidthGBps: Number(row.ram_bandwidth_gbps ?? row.ramBandwidthGBps),
    drivesDisplay: Boolean(row.drives_display ?? row.drivesDisplay),
    weeklyDigest: (row.weekly_digest ?? row.weeklyDigest) !== 0 && (row.weekly_digest ?? row.weeklyDigest) !== false,
    confirmed: row.confirmed === 1 || row.confirmed === true,
  };
}

function loadLocal(): { subscribers: AlertSubscriber[]; sent: SentAlert[] } {
  if (!existsSync(subscribersPath)) return { subscribers: [], sent: [] };
  const subscribers = (JSON.parse(readFileSync(subscribersPath, "utf8")) as Record<string, unknown>[]).map(fromRow);
  const sent = existsSync(sendsPath) ? (JSON.parse(readFileSync(sendsPath, "utf8")) as SentAlert[]) : [];
  return { subscribers, sent };
}

function loadRemote(): { subscribers: AlertSubscriber[]; sent: SentAlert[] } {
  const subscribers = d1(
    "SELECT id, email, device_id, memory_gb, system_ram_gb, drives_display, ram_bandwidth_gbps, weekly_digest, confirmed FROM subscribers WHERE confirmed = 1",
  ).map(fromRow);
  const sent = d1("SELECT subscriber_id, model_id FROM alert_sends").map((row) => ({
    subscriberId: String(row.subscriber_id),
    modelId: String(row.model_id),
  }));
  return { subscribers, sent };
}

function recordLocal(rows: SentAlert[]) {
  mkdirSync(path.dirname(sendsPath), { recursive: true });
  const existing = existsSync(sendsPath) ? (JSON.parse(readFileSync(sendsPath, "utf8")) as SentAlert[]) : [];
  const seen = new Set(existing.map((item) => `${item.subscriberId}::${item.modelId}`));
  const next = existing.slice();
  for (const row of rows) {
    const key = `${row.subscriberId}::${row.modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(row);
  }
  writeFileSync(sendsPath, JSON.stringify(next, null, 2));
}

function recordRemote(rows: SentAlert[]) {
  if (!rows.length) return;
  const sentAt = sqlString(new Date().toISOString());
  const values = rows.map((row) => `(${sqlString(row.subscriberId)}, ${sqlString(row.modelId)}, ${sentAt})`).join(", ");
  d1(`INSERT OR IGNORE INTO alert_sends (subscriber_id, model_id, sent_at) VALUES ${values}`);
}

async function postResend(input: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  unsubscribeUrl: string;
  idempotencyKey: string;
}) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      headers: { "List-Unsubscribe": `<${input.unsubscribeUrl}>` },
      text: input.text,
      html: input.html,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend returned ${response.status}: ${body.slice(0, 300)}`);
  }
}

const loaded = remote ? loadRemote() : loadLocal();
if (!remote && !existsSync(subscribersPath)) {
  console.log("No data/subscribers.json yet. Nothing to match.");
  process.exit(0);
}

const mails = planAlertMails({
  subscribers: loaded.subscribers,
  models,
  devices,
  alreadySent: loaded.sent,
});

if (!mails.length) {
  console.log(remote ? "No new fits to mail." : "No new fits to mail. Confirmed local subscribers only; unconfirmed rows are skipped.");
  process.exit(0);
}

const origin = (process.env.SITE_URL || DEFAULT_SITE).replace(/\/$/, "");

if (!send) {
  for (const mail of mails) {
    console.log(`\n${mail.subscriber.email} · ${mail.deviceName}`);
    for (const hit of mail.hits) {
      console.log(`  would mention ${hit.model.name}: ${hit.label} (${hit.quantId ?? "no quant"})`);
    }
  }
  console.log("\nDry run. Pass --send to deliver, once RESEND_API_KEY, ALERT_FROM, and ALERT_TOKEN_SECRET are set.");
  process.exit(0);
}

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.ALERT_FROM;
const secret = process.env.ALERT_TOKEN_SECRET;
if (!apiKey || !from || !secret || secret === "dev-only-change-me") {
  console.error("Refusing to send. Set RESEND_API_KEY, ALERT_FROM, and a real ALERT_TOKEN_SECRET.");
  process.exit(1);
}

let failed = 0;
for (const mail of mails) {
  const token = await signAlert(
    {
      email: mail.subscriber.email,
      deviceId: mail.subscriber.deviceId,
      memoryGb: mail.subscriber.memoryGb,
      systemRamGb: mail.subscriber.systemRamGb,
      ramBandwidthGBps: mail.subscriber.ramBandwidthGBps,
      drivesDisplay: mail.subscriber.drivesDisplay,
      weeklyDigest: mail.subscriber.weeklyDigest,
      purpose: "unsubscribe",
      exp: Date.now() + 400 * 86_400_000,
    },
    secret,
  );
  const unsubscribeUrl = `${origin}/alerts/unsubscribe?token=${encodeURIComponent(token)}`;
  const rendered = renderFitMail(mail, origin, unsubscribeUrl);
  const idempotencyKey = createHash("sha256")
    .update(`${mail.subscriber.id}:${mail.hits.map((hit) => hit.model.id).sort().join(",")}`)
    .digest("hex");
  try {
    await postResend({
      apiKey,
      from,
      to: mail.subscriber.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      unsubscribeUrl,
      idempotencyKey,
    });
  } catch (error) {
    failed += 1;
    console.error(`${mail.subscriber.email}: ${error instanceof Error ? error.message : "send failed"}`);
    continue;
  }
  const rows = mail.hits.map((hit) => ({ subscriberId: mail.subscriber.id, modelId: hit.model.id }));
  if (remote) recordRemote(rows);
  else recordLocal(rows);
  console.log(`Sent ${mail.hits.length} model${mail.hits.length === 1 ? "" : "s"} to ${mail.subscriber.email}`);
}

if (failed) process.exit(1);
