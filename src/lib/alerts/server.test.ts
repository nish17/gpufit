import { describe, expect, it, vi } from "vitest";
import { readAlert } from "./token";
import {
  CONFIRM_COOLDOWN_MS,
  CONFIRM_PENDING_MESSAGE,
  CONFIRMED_MESSAGE,
  DEV_TOKEN_SECRET,
  GENERIC_ALERT_ERROR,
  MAX_ALERT_BODY_BYTES,
  MAX_DEVICE_ID_LENGTH,
  UNSUBSCRIBED_MESSAGE,
  alertOrigin,
  confirmAlert,
  handleAlertSignup,
  readLimitedText,
  readSignupBody,
  requestAlert,
  resolveTokenSecret,
  unsubscribeAlert,
  validateSignup,
  type AlertEnv,
  type AlertSignup,
} from "./server";

const signup: AlertSignup = {
  email: "ada@example.com",
  deviceId: "rtx-4060-ti-16gb",
  memoryGb: 16,
  systemRamGb: 32,
  ramBandwidthGBps: 89.6,
  drivesDisplay: true,
  weeklyDigest: true,
};

function mockDb(options?: { confirmedIds?: string[] }) {
  const confirmedIds = new Set(options?.confirmedIds ?? []);
  let confirmSentAt: string | null = null;
  const writes: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes("SELECT") && sql.includes("WHERE id")) {
                const id = String(values[0] ?? "");
                return (confirmedIds.has(id) ? { confirmed: 1 } : null) as T | null;
              }
              if (sql.includes("SELECT") && sql.includes("confirm_sent_at")) {
                return (confirmSentAt ? { confirm_sent_at: confirmSentAt } : null) as T | null;
              }
              return null;
            },
            async run() {
              writes.push(sql);
              if (sql.includes("INSERT")) confirmSentAt = String(values.at(-1));
              return {};
            },
            async all<T>() {
              return { results: [] as T[] };
            },
          };
        },
      };
    },
  };
  return { db, writes };
}

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 500, headers: { "content-type": "application/json" } });
}

describe("alert token secret", () => {
  it("fails closed outside DEV when the secret is missing or the fallback", () => {
    expect(resolveTokenSecret({}, false)).toBeNull();
    expect(resolveTokenSecret({ ALERT_TOKEN_SECRET: DEV_TOKEN_SECRET }, false)).toBeNull();
    expect(resolveTokenSecret({ ALERT_TOKEN_SECRET: "  " }, false)).toBeNull();
    expect(resolveTokenSecret({ ALERT_TOKEN_SECRET: "production-secret" }, false)).toBe("production-secret");
    expect(resolveTokenSecret({}, true)).toBe(DEV_TOKEN_SECRET);
  });

  it("builds email links from SITE_URL, not a caller-supplied host", () => {
    expect(alertOrigin({})).toBe("https://gpufit.tech");
    expect(alertOrigin({ SITE_URL: "https://gpufit.tech/ignored" })).toBe("https://gpufit.tech");
    expect(alertOrigin({ SITE_URL: "not a url" })).toBe("https://gpufit.tech");
  });
});

describe("alert signup mail", () => {
  it("refuses to send when production has no real secret", async () => {
    const fetchImpl = vi.fn();
    const { db } = mockDb();
    const env: AlertEnv = { DB: db, RESEND_API_KEY: "re_test", ALERT_TOKEN_SECRET: DEV_TOKEN_SECRET };
    const result = await requestAlert(signup, env, { dev: false, fetch: fetchImpl });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(signup.email);
  });

  it("mails separate confirm and unsubscribe links on the configured origin", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return jsonResponse({ id: "email" });
    });
    const { db, writes } = mockDb();
    const env: AlertEnv = {
      DB: db,
      RESEND_API_KEY: "re_test",
      ALERT_TOKEN_SECRET: "production-secret",
      SITE_URL: "https://gpufit.tech",
    };
    const result = await requestAlert(signup, env, { dev: false, now: Date.now(), fetch: fetchImpl as typeof fetch });
    expect(result.ok).toBe(true);
    expect(result.message).toBe(CONFIRM_PENDING_MESSAGE);
    expect(result.message).not.toContain(signup.email);
    const mailed = JSON.parse(bodies[0]) as {
      html: string;
      text: string;
      headers: Record<string, string>;
    };
    expect(mailed.html).toContain("https://gpufit.tech/alerts/confirm/?token=");
    expect(mailed.html).toContain("https://gpufit.tech/alerts/unsubscribe/?token=");
    expect(mailed.html).toContain("Ahmedabad, Gujarat, India");
    expect(mailed.text).toContain("hi@gpufit.tech");
    expect(mailed.text).toContain("Confirm alerts for your GeForce RTX 4060 Ti 16GB");
    expect(mailed.text).toContain("gpufit.tech will send alerts for your GeForce RTX 4060 Ti 16GB.");
    expect(mailed.text).not.toContain("nimesh3536@gmail.com");
    expect(mailed.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/gpufit\.tech\/api\/alerts\/unsubscribe\/\?token=[^>]+>$/);
    expect(mailed.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mailed.html).not.toContain("evil.example");
    const confirmToken = decodeURIComponent(mailed.html.split("/alerts/confirm/?token=")[1].split('"')[0]);
    const unsubToken = decodeURIComponent(mailed.html.split("/alerts/unsubscribe/?token=")[1].split("&")[0].split('"')[0]);
    expect((await readAlert(confirmToken, "production-secret"))?.purpose).toBe("confirm");
    expect((await readAlert(unsubToken, "production-secret"))?.purpose).toBe("unsubscribe");

    const confirmed = await confirmAlert(confirmToken, env, { dev: false });
    expect(confirmed).toEqual({ ok: true, message: CONFIRMED_MESSAGE });
    expect(confirmed.message).not.toContain(signup.email);
    expect(await unsubscribeAlert(confirmToken, env, { dev: false })).toEqual({
      ok: false,
      message: "This unsubscribe link is invalid or expired.",
    });
    const removed = await unsubscribeAlert(unsubToken, env, { dev: false });
    expect(removed).toEqual({ ok: true, message: UNSUBSCRIBED_MESSAGE });
    expect(writes.some((sql) => sql.includes("DELETE FROM alert_sends"))).toBe(true);
    expect(writes.some((sql) => sql.includes("DELETE FROM subscribers"))).toBe(true);
    expect(removed.message).not.toContain(signup.email);
    expect(await confirmAlert(unsubToken, env, { dev: false })).toEqual({
      ok: false,
      message: "This confirmation link is invalid or expired.",
    });
  });

  it("shows a local confirmation link without changing the email origin", async () => {
    const result = await requestAlert(signup, { SITE_URL: "https://gpufit.tech", ALERT_TOKEN_SECRET: "production-secret" }, {
      dev: true,
      devLinkOrigin: "http://127.0.0.1:47321",
    });
    expect(result.ok).toBe(true);
    expect(result.devConfirmUrl).toContain("http://127.0.0.1:47321/alerts/confirm/?token=");
    expect(result.devConfirmUrl).not.toContain("gpufit.tech");
  });

  it("does not re-send confirmation mail inside the cooldown", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "email" }));
    const { db } = mockDb();
    const env: AlertEnv = { DB: db, RESEND_API_KEY: "re_test", ALERT_TOKEN_SECRET: "production-secret" };
    const now = 1_700_000_000_000;
    await requestAlert(signup, env, { dev: false, now, fetch: fetchImpl as typeof fetch });
    const second = await requestAlert(signup, env, { dev: false, now: now + CONFIRM_COOLDOWN_MS - 1, fetch: fetchImpl as typeof fetch });
    expect(second.ok).toBe(true);
    expect(second.message).toBe(CONFIRM_PENDING_MESSAGE);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const third = await requestAlert(signup, env, { dev: false, now: now + CONFIRM_COOLDOWN_MS, fetch: fetchImpl as typeof fetch });
    expect(third.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("tells a confirmed subscriber they are already subscribed and does not send mail", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "email" }));
    const id = `${signup.email}::${signup.deviceId}`;
    const { db, writes } = mockDb({ confirmedIds: [id] });
    const env: AlertEnv = { DB: db, RESEND_API_KEY: "re_test", ALERT_TOKEN_SECRET: "production-secret" };
    const result = await requestAlert({ ...signup, weeklyDigest: false }, env, {
      dev: false,
      now: Date.now(),
      fetch: fetchImpl as typeof fetch,
    });
    expect(result).toEqual({
      ok: true,
      provider: "resend",
      message: "You're already subscribed. Fit alerts for that machine are on.",
      alreadySubscribed: true,
    });
    expect(result.message).not.toContain(signup.email);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(writes.some((sql) => sql.includes("INSERT"))).toBe(false);
    expect(writes.some((sql) => sql.includes("UPDATE") && sql.includes("weekly_digest"))).toBe(true);
  });

  it("still asks a confirmed address to confirm a different machine", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "email" }));
    const { db } = mockDb({ confirmedIds: [`${signup.email}::other-gpu`] });
    const env: AlertEnv = { DB: db, RESEND_API_KEY: "re_test", ALERT_TOKEN_SECRET: "production-secret" };
    const result = await requestAlert(signup, env, { dev: false, now: Date.now(), fetch: fetchImpl as typeof fetch });
    expect(result.ok).toBe(true);
    expect(result.message).toBe(CONFIRM_PENDING_MESSAGE);
    expect("alreadySubscribed" in result && result.alreadySubscribed).toBeFalsy();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("confirms a local link without touching an unconfigured D1 binding", async () => {
    const db = {
      prepare() {
        return {
          bind() {
            return {
              async run() {
                throw new Error("D1_ERROR: no such table: subscribers: SQLITE_ERROR");
              },
              async first() {
                return null;
              },
              async all() {
                return { results: [] };
              },
            };
          },
        };
      },
    };
    const issued = await requestAlert(signup, { ALERT_TOKEN_SECRET: "production-secret" }, { dev: true, now: Date.now() });
    const token = issued.devConfirmUrl?.split("token=")[1] || "";
    const confirmed = await confirmAlert(token, { DB: db, ALERT_TOKEN_SECRET: "production-secret" }, { dev: true });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.message).not.toContain(signup.email);
    expect(confirmed.message).not.toContain("D1_ERROR");
    expect(confirmed.message).not.toContain("subscribers");

    const broken = await confirmAlert(token, { DB: db, RESEND_API_KEY: "re_test", ALERT_TOKEN_SECRET: "production-secret" }, { dev: false });
    expect(broken.ok).toBe(false);
    expect(broken.message).not.toContain("D1_ERROR");
    expect(broken.message).not.toContain(signup.email);
  });

  it("drops a filled honeypot, checks Turnstile, and fails closed in production when the secret is missing", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("siteverify")) return jsonResponse({ success: true });
      return jsonResponse({ id: "email" });
    });
    const env: AlertEnv = {
      DB: mockDb().db,
      RESEND_API_KEY: "re_test",
      ALERT_TOKEN_SECRET: "production-secret",
      TURNSTILE_SECRET_KEY: "turnstile-secret",
    };
    const honey = await handleAlertSignup({ ...signup, company_website: "https://spam.example" }, env, {
      dev: false,
      fetch: fetchImpl as typeof fetch,
    });
    expect(honey.status).toBe(200);
    expect(honey.result.message).toBe(CONFIRM_PENDING_MESSAGE);
    expect(fetchImpl).not.toHaveBeenCalled();

    const missing = await handleAlertSignup({ ...signup }, env, { dev: false, fetch: fetchImpl as typeof fetch });
    expect(missing.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();

    const passed = await handleAlertSignup({ ...signup, turnstileToken: "token" }, env, {
      dev: false,
      fetch: fetchImpl as typeof fetch,
    });
    expect(passed.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalled();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db: closedDb, writes: closedWrites } = mockDb();
    const open = await handleAlertSignup(
      { ...signup },
      { ...env, TURNSTILE_SECRET_KEY: "   ", DB: closedDb, RESEND_API_KEY: "re_test" },
      { dev: false, fetch: fetchImpl as typeof fetch },
    );
    expect(open.status).toBe(503);
    expect(open.result.ok).toBe(false);
    expect(closedWrites).toEqual([]);
    expect(JSON.stringify(open.result)).not.toContain("TURNSTILE");
    expect(JSON.stringify(open.result)).not.toContain(signup.email);
    expect(logged).toHaveBeenCalledWith(
      "TURNSTILE_SECRET_KEY is not set. Refusing POST /api/alerts until the Worker secret is configured.",
    );
    logged.mockRestore();

    const devChecked = await handleAlertSignup({ ...signup }, env, { dev: true, fetch: fetchImpl as typeof fetch });
    expect(devChecked.status).toBe(400);

    const devSignup = await handleAlertSignup({ ...signup }, { ALERT_TOKEN_SECRET: "production-secret" }, { dev: true });
    expect(devSignup.status).toBe(200);
    expect(devSignup.result.ok).toBe(true);
  });
});

describe("alert input limits", () => {
  it("caps the device id and numeric ranges without echoing the submitted values", () => {
    const hugeId = `rtx-${"a".repeat(MAX_DEVICE_ID_LENGTH)}`;
    const longId = validateSignup({ ...signup, deviceId: hugeId });
    expect(longId).toBe("Pick a machine before signing up.");
    expect(longId).not.toContain(hugeId);

    expect(validateSignup({ ...signup, deviceId: "rtx/4060" })).toBe("Pick a machine before signing up.");
    expect(validateSignup({ ...signup, deviceId: "RTX-4060" })).toBe("Pick a machine before signing up.");
    expect(validateSignup({ ...signup, memoryGb: 999999 })).toBe(GENERIC_ALERT_ERROR);
    expect(validateSignup({ ...signup, memoryGb: 0 })).toBe(GENERIC_ALERT_ERROR);
    expect(validateSignup({ ...signup, memoryGb: Number.POSITIVE_INFINITY })).toBe(GENERIC_ALERT_ERROR);
    expect(validateSignup({ ...signup, systemRamGb: -4 })).toBe(GENERIC_ALERT_ERROR);
    expect(validateSignup({ ...signup, ramBandwidthGBps: 1e12 })).toBe(GENERIC_ALERT_ERROR);
    expect(validateSignup({ ...signup, memoryGb: true })).toBe(GENERIC_ALERT_ERROR);
    expect(JSON.stringify(validateSignup({ ...signup, memoryGb: 999999 }))).not.toContain("999999");

    const edge = validateSignup({ ...signup, memoryGb: "1024", systemRamGb: 1, ramBandwidthGBps: 20000 });
    expect(typeof edge).not.toBe("string");
    if (typeof edge !== "string") {
      expect(edge.memoryGb).toBe(1024);
      expect(edge.systemRamGb).toBe(1);
      expect(edge.ramBandwidthGBps).toBe(20000);
    }
  });

  it("stops reading a body once it passes the cap", async () => {
    const small = await readLimitedText(new Request("https://gpufit.tech/api/alerts/", { method: "POST", body: "{\"ok\":true}" }), 100);
    expect(small).toBe('{"ok":true}');
    const big = await readLimitedText(
      new Request("https://gpufit.tech/api/alerts/", { method: "POST", body: "x".repeat(MAX_ALERT_BODY_BYTES + 20) }),
      MAX_ALERT_BODY_BYTES,
    );
    expect(big).toBeNull();
  });

  it("rejects an oversized or non-object body with a generic message", () => {
    const junk = "not-json <script>ada@example.com";
    expect(readSignupBody(junk)).toBe(GENERIC_ALERT_ERROR);
    expect(readSignupBody("[]")).toBe(GENERIC_ALERT_ERROR);
    expect(readSignupBody("null")).toBe(GENERIC_ALERT_ERROR);
    const oversized = readSignupBody(`{"email":"${"a".repeat(MAX_ALERT_BODY_BYTES)}"}`);
    expect(oversized).toBe(GENERIC_ALERT_ERROR);
    expect(oversized).not.toContain("ada@example.com");
    const ok = readSignupBody(JSON.stringify(signup));
    expect(typeof ok).toBe("object");
  });
});
