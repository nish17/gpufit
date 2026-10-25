import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import hardwareJson from "../../data/hardware.json";
import { DEFAULT_SITE } from "../site";
import { listUnsubscribeHeaders, oneClickUnsubscribeUrl, renderConfirmMail } from "./email";

const deviceNameBySlug = new Map(
  (hardwareJson as { slug: string; name: string }[]).map((device) => [device.slug, device.name]),
);
import { redactLogText } from "./redact";
import { readAlert, signAlert, type AlertPayload } from "./token";

/** Public fallback. Production must not sign or accept tokens with this value. */
export const DEV_TOKEN_SECRET = "dev-only-change-me";
/** Do not send another confirmation to the same address inside this window. */
export const CONFIRM_COOLDOWN_MS = 10 * 60 * 1000;
export const CONFIRM_PENDING_MESSAGE = "Check your email to confirm. Nothing is sent until you click the link.";
export const ALREADY_SUBSCRIBED_MESSAGE = "You're already subscribed. Fit alerts for that machine are on.";
export const CONFIRMED_MESSAGE = "You're confirmed. Fit alerts for that machine are on.";
export const UNSUBSCRIBED_MESSAGE = "You're unsubscribed. No further alerts will be sent for that machine.";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const HONEYPOT_FIELD = "company_website";
export const GENERIC_ALERT_ERROR = "Check the form and try again.";
export const MAX_ALERT_BODY_BYTES = 16 * 1024;
export const MAX_DEVICE_ID_LENGTH = 64;
const MIN_ALERT_GB = 1;
const MAX_ALERT_GB = 1024;
const MIN_ALERT_BANDWIDTH_GBPS = 1;
const MAX_ALERT_BANDWIDTH_GBPS = 20_000;
const DEVICE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface AlertSignup {
  email: string;
  deviceId: string;
  memoryGb: number;
  systemRamGb: number;
  ramBandwidthGBps: number;
  drivesDisplay: boolean;
  weeklyDigest: boolean;
}

export interface StoredAlert extends AlertSignup {
  id: string;
  confirmed: boolean;
  createdAt: string;
}

export interface AlertEnv {
  RESEND_API_KEY?: string;
  ALERT_FROM?: string;
  ALERT_TOKEN_SECRET?: string;
  SITE_URL?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  DB?: D1Like;
}

export interface AlertCallOptions {
  /** Defaults to Astro's DEV flag. Tests pass false to exercise the production path. */
  dev?: boolean;
  now?: number;
  fetch?: typeof fetch;
  /** Browser-only dev link. Outbound email never uses this. */
  devLinkOrigin?: string;
}

interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
}

const FILE = path.join(process.cwd(), "data", "subscribers.json");
const MEMORY_KEY = "__gpufitAlertSubscribers";

function workerSandbox(): boolean {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /cloudflare/i.test(agent);
}

function memoryRows(): StoredAlert[] {
  const host = globalThis as typeof globalThis & { [MEMORY_KEY]?: StoredAlert[] };
  if (!host[MEMORY_KEY]) host[MEMORY_KEY] = [];
  return host[MEMORY_KEY];
}

let turnstileWarningLogged = false;

/** HMAC secret. Outside DEV, a missing or fallback secret fails closed (returns null). */
export function resolveTokenSecret(env: AlertEnv, dev = import.meta.env.DEV): string | null {
  const secret = env.ALERT_TOKEN_SECRET?.trim() ?? "";
  if (dev) return secret && secret !== DEV_TOKEN_SECRET ? secret : DEV_TOKEN_SECRET;
  if (!secret || secret === DEV_TOKEN_SECRET) return null;
  return secret;
}

/** Email links always use SITE_URL, never the Host header of the incoming request. */
export function alertOrigin(env: AlertEnv): string {
  const configured = (env.SITE_URL || DEFAULT_SITE).trim();
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.protocol !== "http:") return DEFAULT_SITE;
    return url.origin;
  } catch {
    return DEFAULT_SITE;
  }
}

function alertLink(origin: string, purpose: "confirm" | "unsubscribe", token: string): string {
  return `${origin}/alerts/${purpose}/?token=${encodeURIComponent(token)}`;
}

function devConfirmLink(options: AlertCallOptions, emailConfirmUrl: string): string {
  const raw = options.devLinkOrigin?.trim();
  if (!raw) return emailConfirmUrl;
  try {
    const url = new URL(emailConfirmUrl);
    const token = url.searchParams.get("token") || "";
    return alertLink(new URL(raw).origin, "confirm", token);
  } catch {
    return emailConfirmUrl;
  }
}

function logSecretRefusal(): void {
  console.error("ALERT_TOKEN_SECRET is missing or still the dev fallback. Refusing to sign or accept alert tokens.");
}

function logTurnstileUnset(): void {
  if (turnstileWarningLogged) return;
  turnstileWarningLogged = true;
  console.error("TURNSTILE_SECRET_KEY is not set. Refusing POST /api/alerts until the Worker secret is configured.");
}

function logFailure(message: string, error?: unknown): void {
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  console.error(detail ? `${message} ${redactLogText(detail)}` : message);
}

export function honeypotFilled(body: Record<string, unknown>): boolean {
  return String(body[HONEYPOT_FIELD] ?? "").trim().length > 0;
}

export async function verifyTurnstileToken(token: string, secret: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!token || !secret) return false;
  try {
    const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

function idFor(email: string, deviceId: string): string {
  return `${email.trim().toLowerCase()}::${deviceId}`;
}

async function readDevStore(): Promise<{ rows: StoredAlert[]; backend: "file" | "memory" }> {
  try {
    return { rows: JSON.parse(await readFile(FILE, "utf8")) as StoredAlert[], backend: "file" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { rows: [], backend: "file" };
    return { rows: memoryRows().slice(), backend: "memory" };
  }
}

async function writeDevStore(rows: StoredAlert[]): Promise<"file" | "memory"> {
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(rows, null, 2));
    return "file";
  } catch {
    const mem = memoryRows();
    mem.splice(0, mem.length, ...rows);
    return "memory";
  }
}

function readRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}

/** Stop reading once the cap is passed so a large body is not parsed or logged. */
export async function readLimitedText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!Number.isFinite(Number(declared)) || Number(declared) > maxBytes)) return null;
  const body = request.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function readSignupBody(raw: string): Record<string, unknown> | string {
  if (new TextEncoder().encode(raw).byteLength > MAX_ALERT_BODY_BYTES) return GENERIC_ALERT_ERROR;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return GENERIC_ALERT_ERROR;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return GENERIC_ALERT_ERROR;
  return body as Record<string, unknown>;
}

export function validateSignup(input: {
  email?: unknown;
  deviceId?: unknown;
  memoryGb?: unknown;
  systemRamGb?: unknown;
  ramBandwidthGBps?: unknown;
  drivesDisplay?: unknown;
  weeklyDigest?: unknown;
}): AlertSignup | string {
  const email = String(input.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return "Enter a valid email address.";
  if (typeof input.deviceId !== "string") return "Pick a machine before signing up.";
  const deviceId = input.deviceId.trim();
  if (!deviceId || deviceId.length > MAX_DEVICE_ID_LENGTH || !DEVICE_ID_PATTERN.test(deviceId)) return "Pick a machine before signing up.";
  const memoryGb = readRange(input.memoryGb, MIN_ALERT_GB, MAX_ALERT_GB);
  const systemRamGb = readRange(input.systemRamGb, MIN_ALERT_GB, MAX_ALERT_GB);
  const ramBandwidthGBps = readRange(input.ramBandwidthGBps, MIN_ALERT_BANDWIDTH_GBPS, MAX_ALERT_BANDWIDTH_GBPS);
  if (memoryGb === null || systemRamGb === null || ramBandwidthGBps === null) return GENERIC_ALERT_ERROR;
  return {
    email,
    deviceId,
    memoryGb,
    systemRamGb,
    ramBandwidthGBps,
    drivesDisplay: Boolean(input.drivesDisplay),
    weeklyDigest: input.weeklyDigest !== false,
  };
}

async function confirmationEmail(
  env: AlertEnv,
  signup: AlertSignup,
  confirmUrl: string,
  unsubUrl: string,
  oneClickUrl: string,
  origin: string,
  fetchImpl: typeof fetch,
) {
  const from = env.ALERT_FROM || "GPUfit <alerts@gpufit.tech>";
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return;
  const rendered = renderConfirmMail({
    origin,
    confirmUrl,
    unsubscribeUrl: unsubUrl,
    deviceName: deviceNameBySlug.get(signup.deviceId) ?? "this machine",
  });
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [signup.email],
      subject: rendered.subject,
      headers: listUnsubscribeHeaders(oneClickUrl),
      text: rendered.text,
      html: rendered.html,
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend returned ${response.status}`);
  }
}

/** Confirmed email+machine: keep the latest hardware and digest choices, and do not mail again. */
async function alreadySubscribed(
  env: AlertEnv & { DB: NonNullable<AlertEnv["DB"]> },
  row: StoredAlert,
): Promise<boolean | "lookup-failed"> {
  let existing: { confirmed: number } | null;
  try {
    existing = await env.DB.prepare(`SELECT confirmed FROM subscribers WHERE id = ?`)
      .bind(row.id)
      .first<{ confirmed: number }>();
  } catch (error) {
    logFailure("Alert subscriber lookup failed.", error);
    return "lookup-failed";
  }
  if (Number(existing?.confirmed) !== 1) return false;
  try {
    await env.DB.prepare(
      `UPDATE subscribers SET
         memory_gb = ?,
         system_ram_gb = ?,
         drives_display = ?,
         ram_bandwidth_gbps = ?,
         weekly_digest = ?
       WHERE id = ?`,
    )
      .bind(
        row.memoryGb,
        row.systemRamGb,
        row.drivesDisplay ? 1 : 0,
        row.ramBandwidthGBps,
        row.weeklyDigest ? 1 : 0,
        row.id,
      )
      .run();
  } catch (error) {
    logFailure("Alert subscriber update failed.", error);
    return "lookup-failed";
  }
  return true;
}

async function confirmationCoolingDown(env: AlertEnv, email: string, now: number): Promise<boolean> {
  if (!env.DB) return false;
  const row = await env.DB.prepare(
    `SELECT confirm_sent_at FROM subscribers WHERE email = ? AND confirm_sent_at IS NOT NULL ORDER BY confirm_sent_at DESC LIMIT 1`,
  )
    .bind(email)
    .first<{ confirm_sent_at: string }>();
  if (!row?.confirm_sent_at) return false;
  const sentAt = Date.parse(row.confirm_sent_at);
  return Number.isFinite(sentAt) && now - sentAt < CONFIRM_COOLDOWN_MS;
}

export async function requestAlert(signup: AlertSignup, env: AlertEnv, options: AlertCallOptions = {}) {
  const dev = options.dev ?? import.meta.env.DEV;
  const now = options.now ?? Date.now();
  const fetchImpl = options.fetch ?? fetch;
  const secret = resolveTokenSecret(env, dev);
  if (!secret) {
    logSecretRefusal();
    return {
      ok: false as const,
      provider: "unconfigured" as const,
      message: "Email alerts are not switched on for this site yet.",
    };
  }
  const origin = alertOrigin(env);
  const confirmPayload: AlertPayload = { ...signup, purpose: "confirm", exp: now + 7 * 86_400_000 };
  const unsubPayload: AlertPayload = { ...signup, purpose: "unsubscribe", exp: now + 400 * 86_400_000 };
  const confirmToken = await signAlert(confirmPayload, secret);
  const unsubToken = await signAlert(unsubPayload, secret);
  const confirmUrl = alertLink(origin, "confirm", confirmToken);
  const unsubUrl = alertLink(origin, "unsubscribe", unsubToken);
  const sentAt = new Date(now).toISOString();
  const row: StoredAlert = {
    ...signup,
    id: idFor(signup.email, signup.deviceId),
    confirmed: false,
    createdAt: sentAt,
  };

  if (env.DB && env.RESEND_API_KEY) {
    const subscribed = await alreadySubscribed({ ...env, DB: env.DB }, row);
    if (subscribed === "lookup-failed") {
      return {
        ok: false as const,
        provider: "unconfigured" as const,
        message: "Email alerts are not switched on for this site yet.",
      };
    }
    if (subscribed) {
      return {
        ok: true as const,
        provider: "resend" as const,
        message: ALREADY_SUBSCRIBED_MESSAGE,
        alreadySubscribed: true as const,
      };
    }
    let cooling = false;
    try {
      cooling = await confirmationCoolingDown(env, signup.email, now);
    } catch (error) {
      logFailure(
        "Alert cooldown query failed. If D1 is missing confirm_sent_at, apply schema/migrate-2026-10-24-confirm-sent.sql.",
        error,
      );
      return {
        ok: false as const,
        provider: "unconfigured" as const,
        message: "Email alerts are not switched on for this site yet.",
      };
    }
    if (cooling) {
      return { ok: true as const, provider: "resend" as const, message: CONFIRM_PENDING_MESSAGE };
    }
    await env.DB.prepare(
      `INSERT INTO subscribers (id, email, device_id, memory_gb, system_ram_gb, drives_display, ram_bandwidth_gbps, weekly_digest, confirmed, created_at, confirm_sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         memory_gb = excluded.memory_gb,
         system_ram_gb = excluded.system_ram_gb,
         drives_display = excluded.drives_display,
         ram_bandwidth_gbps = excluded.ram_bandwidth_gbps,
         weekly_digest = excluded.weekly_digest,
         confirm_sent_at = excluded.confirm_sent_at,
         created_at = CASE WHEN subscribers.confirmed = 0 THEN excluded.created_at ELSE subscribers.created_at END`,
    )
      .bind(
        row.id,
        row.email,
        row.deviceId,
        row.memoryGb,
        row.systemRamGb,
        row.drivesDisplay ? 1 : 0,
        row.ramBandwidthGBps,
        row.weeklyDigest ? 1 : 0,
        row.createdAt,
        sentAt,
      )
      .run();
    await confirmationEmail(env, signup, confirmUrl, unsubUrl, oneClickUnsubscribeUrl(origin, unsubToken), origin, fetchImpl);
    return {
      ok: true as const,
      provider: "resend" as const,
      message: CONFIRM_PENDING_MESSAGE,
    };
  }

  if (dev) {
    // `astro dev` runs this route in workerd. That filesystem does not keep
    // writes across requests, so the browser holds the signup instead.
    if (workerSandbox()) {
      return {
        ok: true as const,
        provider: "browser" as const,
        message: "Saved in this browser. Email is not switched on for this site yet, so nothing was sent.",
        devConfirmUrl: devConfirmLink(options, confirmUrl),
      };
    }
    const { rows } = await readDevStore();
    const next = rows.filter((item) => item.id !== row.id);
    next.push(row);
    const backend = await writeDevStore(next);
    return {
      ok: true as const,
      provider: backend,
      message:
        backend === "file"
          ? "Saved on this computer. No email was sent."
          : "Saved for this session. No email was sent, and a restart clears it.",
      devConfirmUrl: devConfirmLink(options, confirmUrl),
    };
  }

  return {
    ok: false as const,
    provider: "unconfigured" as const,
    message: "Email alerts are not switched on for this site yet. The signup stayed in this browser.",
  };
}

async function payloadFor(
  token: string,
  env: AlertEnv,
  purpose: AlertPayload["purpose"],
  dev: boolean,
): Promise<AlertPayload | null> {
  const secret = resolveTokenSecret(env, dev);
  if (!secret) {
    logSecretRefusal();
    return null;
  }
  const payload = await readAlert(token, secret);
  if (!payload || payload.purpose !== purpose) return null;
  return payload;
}

const LOCAL_CONFIRM_MESSAGE = "You're confirmed. This local session does not keep the signup on the server.";
const STORE_UNAVAILABLE = "Email alerts are not switched on for this site yet.";

function mailConfigured(env: AlertEnv): env is AlertEnv & { DB: NonNullable<AlertEnv["DB"]> } {
  return Boolean(env.DB && env.RESEND_API_KEY);
}

export async function confirmAlert(token: string, env: AlertEnv, options: AlertCallOptions = {}) {
  const dev = options.dev ?? import.meta.env.DEV;
  const payload = await payloadFor(token, env, "confirm", dev);
  if (!payload) return { ok: false as const, message: "This confirmation link is invalid or expired." };
  if (mailConfigured(env)) {
    try {
      await env.DB.prepare(`UPDATE subscribers SET confirmed = 1 WHERE id = ?`).bind(idFor(payload.email, payload.deviceId)).run();
      return { ok: true as const, message: CONFIRMED_MESSAGE };
    } catch (error) {
      logFailure("Alert confirm failed.", error);
      if (!dev) return { ok: false as const, message: STORE_UNAVAILABLE };
    }
  }
  if (!dev) {
    return { ok: false as const, message: STORE_UNAVAILABLE };
  }
  const { rows } = await readDevStore();
  const row = rows.find((item) => item.id === idFor(payload.email, payload.deviceId));
  if (!row) {
    return { ok: true as const, message: LOCAL_CONFIRM_MESSAGE };
  }
  row.confirmed = true;
  await writeDevStore(rows);
  return { ok: true as const, message: CONFIRMED_MESSAGE };
}

export async function unsubscribeAlert(token: string, env: AlertEnv, options: AlertCallOptions = {}) {
  const dev = options.dev ?? import.meta.env.DEV;
  const payload = await payloadFor(token, env, "unsubscribe", dev);
  if (!payload) return { ok: false as const, message: "This unsubscribe link is invalid or expired." };
  if (mailConfigured(env)) {
    const id = idFor(payload.email, payload.deviceId);
    try {
      await env.DB.prepare(`DELETE FROM alert_sends WHERE subscriber_id = ?`).bind(id).run();
    } catch (error) {
      logFailure("Alert send-log delete failed.", error);
    }
    try {
      await env.DB.prepare(`DELETE FROM subscribers WHERE id = ?`).bind(id).run();
      return { ok: true as const, message: UNSUBSCRIBED_MESSAGE };
    } catch (error) {
      logFailure("Alert unsubscribe failed.", error);
      if (!dev) return { ok: false as const, message: STORE_UNAVAILABLE };
    }
  }
  if (!dev) {
    return { ok: false as const, message: STORE_UNAVAILABLE };
  }
  const { rows } = await readDevStore();
  await writeDevStore(rows.filter((item) => item.id !== idFor(payload.email, payload.deviceId)));
  return { ok: true as const, message: UNSUBSCRIBED_MESSAGE };
}

export interface AlertSignupResult {
  ok: boolean;
  message: string;
  provider?: string;
  devConfirmUrl?: string;
  /** True when this email is already confirmed for the submitted machine. */
  alreadySubscribed?: boolean;
}

/** Honeypot, Turnstile, then the signup. Email links ignore the request host. */
export async function handleAlertSignup(
  body: Record<string, unknown>,
  env: AlertEnv,
  options: AlertCallOptions = {},
): Promise<{ status: number; result: AlertSignupResult }> {
  const dev = options.dev ?? import.meta.env.DEV;
  if (honeypotFilled(body)) {
    return { status: 200, result: { ok: true, message: CONFIRM_PENDING_MESSAGE } };
  }
  const turnstileSecret = env.TURNSTILE_SECRET_KEY?.trim() ?? "";
  if (!turnstileSecret) {
    if (!dev) {
      logTurnstileUnset();
      return {
        status: 503,
        result: { ok: false, message: "Email alerts are not switched on for this site yet." },
      };
    }
  } else {
    const token = String(body.turnstileToken ?? "");
    const passed = await verifyTurnstileToken(token, turnstileSecret, options.fetch ?? fetch);
    if (!passed) {
      return { status: 400, result: { ok: false, message: "Complete the human check and try again." } };
    }
  }
  const parsed = validateSignup(body);
  if (typeof parsed === "string") return { status: 400, result: { ok: false, message: parsed } };
  const result = await requestAlert(parsed, env, { ...options, dev });
  return { status: result.ok ? 200 : 503, result };
}

export function envFrom(source: Record<string, unknown> | undefined): AlertEnv {
  const read = (key: string) => {
    const value = source?.[key] ?? process.env[key];
    return typeof value === "string" ? value : undefined;
  };
  return {
    RESEND_API_KEY: read("RESEND_API_KEY"),
    ALERT_FROM: read("ALERT_FROM"),
    ALERT_TOKEN_SECRET: read("ALERT_TOKEN_SECRET"),
    SITE_URL: read("SITE_URL"),
    TURNSTILE_SITE_KEY: read("TURNSTILE_SITE_KEY"),
    TURNSTILE_SECRET_KEY: read("TURNSTILE_SECRET_KEY"),
    DB: source?.DB as D1Like | undefined,
  };
}

/**
 * Worker bindings live on `cloudflare:workers` `env` (D1 is `DB`).
 * Astro 6+ throws if you read `locals.runtime.env`. A dynamic import keeps
 * the Node prerender build working when that module is absent.
 */
export async function loadAlertEnv(): Promise<AlertEnv> {
  try {
    const workers = (await import("cloudflare:workers")) as { env?: Record<string, unknown> };
    if (workers.env && typeof workers.env === "object") return envFrom(workers.env);
  } catch {
    // Local Node, tests, and prerender have no worker binding.
  }
  return envFrom(undefined);
}
