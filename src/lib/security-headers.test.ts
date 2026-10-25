import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, CONTENT_SECURITY_POLICY_REPORT_ONLY, SECURITY_HEADERS } from "./security-headers";

describe("security headers", () => {
  it("sets HSTS, framing, and a CSP that allows Turnstile", () => {
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(SECURITY_HEADERS["Permissions-Policy"]).toContain("camera=()");
    expect(SECURITY_HEADERS["Permissions-Policy"]).toContain("microphone=()");
    expect(SECURITY_HEADERS["Permissions-Policy"]).toContain("geolocation=()");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("https://challenges.cloudflare.com");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com");
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self' https://challenges.cloudflare.com https://cloudflareinsights.com");
    expect(CONTENT_SECURITY_POLICY).toContain("'unsafe-inline'");
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain("script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com");
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain("connect-src 'self' https://challenges.cloudflare.com https://cloudflareinsights.com");
  });

  it("keeps public/_headers in step with the Worker header map", () => {
    const file = readFileSync(new URL("../../public/_headers", import.meta.url), "utf8");
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(file).toContain(`${name}: ${value}`);
    }
  });
});
