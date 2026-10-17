import { describe, expect, it } from "vitest";
import { readAlert, signAlert, type AlertPayload } from "./token";

const secret = "test-secret";

const payload: AlertPayload = {
  email: "ada@example.com",
  deviceId: "rtx-4060-ti-16gb",
  memoryGb: 16,
  systemRamGb: 32,
  ramBandwidthGBps: 89.6,
  drivesDisplay: true,
  weeklyDigest: true,
  purpose: "confirm",
  exp: Date.now() + 60_000,
};

describe("alert tokens", () => {
  it("round-trips a signed payload and rejects tampering", async () => {
    const token = await signAlert(payload, secret);
    const read = await readAlert(token, secret);
    expect(read?.email).toBe(payload.email);
    expect(read?.deviceId).toBe(payload.deviceId);
    const [body, sig] = token.split(".");
    const forged = `${body}.${sig.slice(0, -1)}${sig.endsWith("a") ? "b" : "a"}`;
    expect(await readAlert(forged, secret)).toBeNull();
    expect(await readAlert(token, "other-secret")).toBeNull();
  });
});
