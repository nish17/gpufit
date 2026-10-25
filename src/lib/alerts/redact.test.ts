import { describe, expect, it } from "vitest";
import { alertLogId, deliveryFailureLine, deliveryLogLine, dryRunSubscriberLine } from "./log-id";
import { redactLogText } from "./redact";

const email = "ada@example.com";

describe("alert log redaction", () => {
  it("hashes an address to a short stable id and never prints it", () => {
    const id = alertLogId(email);
    expect(id).toMatch(/^[a-f0-9]{12}$/);
    expect(id).toBe(alertLogId("Ada@Example.com"));
    expect(id).not.toBe(alertLogId("grace@example.com"));
    expect(id).not.toContain("ada");
    expect(id).not.toContain("@");

    const sent = deliveryLogLine(2, email);
    const failed = deliveryFailureLine(email, `Resend returned 422: {"to":"${email}"} re_live_secret Bearer sk_live`);
    const dry = dryRunSubscriberLine(email, "GeForce RTX 3060 12GB");
    for (const line of [sent, failed, dry]) {
      expect(line).not.toContain(email);
      expect(line).not.toContain("ada");
      expect(line).toContain(id);
    }
    expect(sent).toBe(`Sent 2 models to subscriber ${id}`);
    expect(deliveryLogLine(1, email)).toBe(`Sent 1 model to subscriber ${id}`);
    expect(failed).not.toContain("re_live_secret");
    expect(failed).not.toContain("sk_live");
    expect(failed).toContain("[redacted]");
  });

  it("redacts addresses inside subscriber ids and credential-shaped tokens", () => {
    const line = redactLogText(`INSERT ('${email}::rtx-4060-ti-16gb') Authorization: Bearer re_abc123`);
    expect(line).not.toContain(email);
    expect(line).not.toContain("re_abc123");
    expect(line).toContain("Bearer [redacted]");
    expect(line).toContain("rtx-4060-ti-16gb");
  });
});
