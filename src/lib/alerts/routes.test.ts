import { describe, expect, it } from "vitest";
import { POST as signupPost } from "../../pages/api/alerts.ts";
import { GET as confirmGet } from "../../pages/api/alerts/confirm.ts";
import { GET, POST } from "../../pages/api/alerts/unsubscribe.ts";
import { GENERIC_ALERT_ERROR, MAX_ALERT_BODY_BYTES } from "./server";
import { signAlert, type AlertPayload } from "./token";

const secret = "production-secret";

function payload(purpose: AlertPayload["purpose"]): AlertPayload {
  return {
    email: "ada@example.com",
    deviceId: "rtx-4060-ti-16gb",
    memoryGb: 16,
    systemRamGb: 32,
    ramBandwidthGBps: 89.6,
    drivesDisplay: true,
    weeklyDigest: true,
    purpose,
    exp: Date.now() + 86_400_000,
  };
}

describe("alert http routes", () => {
  it("rejects an oversized or invalid signup body without echoing it", async () => {
    const oversized = await signupPost({
      request: new Request("https://gpufit.tech/api/alerts/", {
        method: "POST",
        body: `{"email":"ada@example.com","pad":"${"a".repeat(MAX_ALERT_BODY_BYTES)}"}`,
      }),
    } as never);
    expect(oversized.status).toBe(400);
    const big = await oversized.json();
    expect(big).toEqual({ ok: false, message: GENERIC_ALERT_ERROR });
    expect(JSON.stringify(big)).not.toContain("ada@example.com");

    const junk = await signupPost({
      request: new Request("https://gpufit.tech/api/alerts/", { method: "POST", body: "not-json <script>" }),
    } as never);
    expect(junk.status).toBe(400);
    expect(await junk.json()).toEqual({ ok: false, message: GENERIC_ALERT_ERROR });
  });

  it("unsubscribes on GET and POST and still confirms on GET", async () => {
    process.env.ALERT_TOKEN_SECRET = secret;
    const token = await signAlert(payload("unsubscribe"), secret);
    const url = new URL(`https://gpufit.tech/api/alerts/unsubscribe/?token=${encodeURIComponent(token)}`);
    const posted = await POST({
      request: new Request(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
      url,
    } as never);
    expect(posted.status).toBe(200);
    const postedBody = await posted.json();
    expect(postedBody.ok).toBe(true);
    expect(JSON.stringify(postedBody)).not.toContain("ada@example.com");

    const gotten = await GET({ request: new Request(url), url } as never);
    expect(gotten.status).toBe(200);
    expect((await gotten.json()).ok).toBe(true);

    const missing = await POST({
      request: new Request("https://gpufit.tech/api/alerts/unsubscribe/", { method: "POST", body: "List-Unsubscribe=One-Click" }),
      url: new URL("https://gpufit.tech/api/alerts/unsubscribe/"),
    } as never);
    expect(missing.status).toBe(400);

    const hugeUrl = new URL(`https://gpufit.tech/api/alerts/unsubscribe/?token=${encodeURIComponent(token)}`);
    const huge = await POST({
      request: new Request(hugeUrl, { method: "POST", body: "x".repeat(5000) }),
      url: hugeUrl,
    } as never);
    expect(huge.status).toBe(400);
    expect(await huge.json()).toEqual({ ok: false, message: "Could not unsubscribe." });

    const confirmToken = await signAlert(payload("confirm"), secret);
    const confirmUrl = new URL(`https://gpufit.tech/api/alerts/confirm/?token=${encodeURIComponent(confirmToken)}`);
    const confirmed = await confirmGet({ request: new Request(confirmUrl), url: confirmUrl } as never);
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json()).ok).toBe(true);
  });
});
