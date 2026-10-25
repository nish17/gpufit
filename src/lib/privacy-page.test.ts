import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("privacy page", () => {
  const page = readFileSync(new URL("../pages/privacy.astro", import.meta.url), "utf8");

  it("matches signup storage, retention, processors, and the deletion contact", () => {
    expect(page).toContain("nimesh3536@gmail.com");
    expect(page).toContain("Resend");
    expect(page).toContain("Cloudflare D1");
    expect(page).toContain("Cloudflare Turnstile");
    expect(page).toContain("7 days");
    expect(page).toContain("before you confirm");
    expect(page).not.toContain("subscribers.json");
    expect(page).not.toContain("Only after you confirm");
  });
});
