import { describe, expect, it } from "vitest";
import { renderConfirmMail } from "./email";

describe("renderConfirmMail", () => {
  it("uses the site palette, a table layout, and a plain-text link", () => {
    const mail = renderConfirmMail({
      origin: "https://gpufit.tech",
      confirmUrl: "https://gpufit.tech/alerts/confirm?token=abc",
      unsubscribeUrl: "https://gpufit.tech/alerts/unsubscribe?token=abc",
    });
    expect(mail.subject).toBe("Confirm GPUfit alerts");
    expect(mail.text).toContain("https://gpufit.tech/alerts/confirm?token=abc");
    expect(mail.html).toContain("#f4f1ea");
    expect(mail.html).toContain("#fffcf7");
    expect(mail.html).toContain("#0d6b4c");
    expect(mail.html).toContain("https://gpufit.tech/logo-small-24@2x.png");
    expect(mail.html).toContain('alt="GPUfit"');
    expect(mail.html).toContain("Confirm alerts");
    expect(mail.html).toContain("<table");
    expect(mail.html).not.toContain("display:flex");
    expect(mail.html).not.toContain("rgba(");
  });
});
