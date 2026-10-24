import { describe, expect, it, vi } from "vitest";
import { readAlert } from "./token";
import {
  CONFIRM_COOLDOWN_MS,
  CONFIRM_PENDING_MESSAGE,
  CONFIRMED_MESSAGE,
  DEV_TOKEN_SECRET,
  UNSUBSCRIBED_MESSAGE,
  alertOrigin,
  confirmAlert,
  handleAlertSignup,
  requestAlert,
  resolveTokenSecret,
  unsubscribeAlert,
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

function mockDb() {
  let confirmSentAt: string | null = null;
  const writes: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
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
    const { db } = mockDb();
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
    const mailed = JSON.parse(bodies[0]) as { html: string; text: string };
    expect(mailed.html).toContain("https://gpufit.tech/alerts/confirm/?token=");
    expect(mailed.html).toContain("https://gpufit.tech/alerts/unsubscribe/?token=");
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

  it("drops a filled honeypot and requires Turnstile only when the secret is set", async () => {
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
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const open = await handleAlertSignup({ ...signup }, { ...env, TURNSTILE_SECRET_KEY: undefined, DB: mockDb().db }, {
      dev: false,
      fetch: fetchImpl as typeof fetch,
    });
    expect(open.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("TURNSTILE_SECRET_KEY is not set"));
    warn.mockRestore();
  });
});
