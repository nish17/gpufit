import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readAlert, signAlert, type AlertPayload } from "./token";

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
  DB?: D1Like;
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

function secretOf(env: AlertEnv): string {
  return env.ALERT_TOKEN_SECRET || "dev-only-change-me";
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
  if (!input.deviceId || typeof input.deviceId !== "string") return "Pick a machine before signing up.";
  const memoryGb = Number(input.memoryGb);
  const systemRamGb = Number(input.systemRamGb);
  const ramBandwidthGBps = Number(input.ramBandwidthGBps);
  if (!Number.isFinite(memoryGb) || memoryGb <= 0) return "Memory size is missing.";
  return {
    email,
    deviceId: input.deviceId,
    memoryGb,
    systemRamGb: Number.isFinite(systemRamGb) ? systemRamGb : memoryGb,
    ramBandwidthGBps: Number.isFinite(ramBandwidthGBps) ? ramBandwidthGBps : 89.6,
    drivesDisplay: Boolean(input.drivesDisplay),
    weeklyDigest: input.weeklyDigest !== false,
  };
}

async function confirmationEmail(env: AlertEnv, signup: AlertSignup, confirmUrl: string, unsubUrl: string) {
  const from = env.ALERT_FROM || "GPUfit <alerts@gpufit.tech>";
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [signup.email],
      subject: "Confirm GPUfit alerts",
      headers: { "List-Unsubscribe": `<${unsubUrl}>` },
      text: `Confirm alerts for this machine:\n${confirmUrl}\n\nUnsubscribe:\n${unsubUrl}\n`,
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend returned ${response.status}`);
  }
}

export async function requestAlert(signup: AlertSignup, env: AlertEnv, origin: string) {
  const payload: AlertPayload = {
    ...signup,
    purpose: "confirm",
    exp: Date.now() + 7 * 86_400_000,
  };
  const token = await signAlert(payload, secretOf(env));
  const confirmUrl = `${origin}/alerts/confirm?token=${encodeURIComponent(token)}`;
  const unsubUrl = `${origin}/alerts/unsubscribe?token=${encodeURIComponent(token)}`;
  const row: StoredAlert = {
    ...signup,
    id: idFor(signup.email, signup.deviceId),
    confirmed: false,
    createdAt: new Date().toISOString(),
  };

  if (env.DB && env.RESEND_API_KEY) {
    await env.DB.prepare(
      `INSERT INTO subscribers (id, email, device_id, memory_gb, system_ram_gb, drives_display, ram_bandwidth_gbps, weekly_digest, confirmed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         memory_gb = excluded.memory_gb,
         system_ram_gb = excluded.system_ram_gb,
         drives_display = excluded.drives_display,
         ram_bandwidth_gbps = excluded.ram_bandwidth_gbps,
         weekly_digest = excluded.weekly_digest`,
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
      )
      .run();
    await confirmationEmail(env, signup, confirmUrl, unsubUrl);
    return {
      ok: true as const,
      provider: "resend" as const,
      message: "Check your email to confirm. Nothing is sent until you click the link.",
    };
  }

  if (import.meta.env.DEV) {
    // `astro dev` runs this route in workerd. That filesystem does not keep
    // writes across requests, so the browser holds the signup instead.
    if (workerSandbox()) {
      return {
        ok: true as const,
        provider: "browser" as const,
        message: "Saved in this browser. Email is not switched on for this site yet, so nothing was sent.",
        devConfirmUrl: confirmUrl,
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
      devConfirmUrl: confirmUrl,
    };
  }

  return {
    ok: false as const,
    provider: "unconfigured" as const,
    message: "Email alerts are not switched on for this site yet. The signup stayed in this browser.",
  };
}

export async function confirmAlert(token: string, env: AlertEnv) {
  const payload = await readAlert(token, secretOf(env));
  if (!payload) return { ok: false as const, message: "This confirmation link is invalid or expired." };
  if (env.DB) {
    const result = await env.DB.prepare(`UPDATE subscribers SET confirmed = 1 WHERE id = ?`).bind(idFor(payload.email, payload.deviceId)).run();
    void result;
    return { ok: true as const, message: `Alerts confirmed for ${payload.email}.` };
  }
  if (!import.meta.env.DEV) {
    return { ok: false as const, message: "Email alerts are not switched on for this site yet." };
  }
  const { rows } = await readDevStore();
  const row = rows.find((item) => item.id === idFor(payload.email, payload.deviceId));
  if (!row) {
    return {
      ok: true as const,
      message: `Link verified for ${payload.email}. Local dev keeps the signup in this browser, so nothing was written on the server.`,
    };
  }
  row.confirmed = true;
  await writeDevStore(rows);
  return { ok: true as const, message: `Alerts confirmed for ${payload.email}.` };
}

export async function unsubscribeAlert(token: string, env: AlertEnv) {
  const payload = await readAlert(token, secretOf(env));
  if (!payload) return { ok: false as const, message: "This unsubscribe link is invalid or expired." };
  if (env.DB) {
    await env.DB.prepare(`DELETE FROM subscribers WHERE id = ?`).bind(idFor(payload.email, payload.deviceId)).run();
    return { ok: true as const, message: `${payload.email} will not get further alerts for that machine.` };
  }
  if (!import.meta.env.DEV) {
    return { ok: false as const, message: "Email alerts are not switched on for this site yet." };
  }
  const { rows } = await readDevStore();
  await writeDevStore(rows.filter((item) => item.id !== idFor(payload.email, payload.deviceId)));
  return { ok: true as const, message: `${payload.email} will not get further alerts for that machine.` };
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
