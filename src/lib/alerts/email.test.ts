import { describe, expect, it } from "vitest";
import { ALERT_SENDER_LINE, listUnsubscribeHeaders, oneClickUnsubscribeUrl, renderConfirmMail } from "./email";

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
    expect(mail.text).toContain(ALERT_SENDER_LINE);
    expect(mail.html).toContain("Ahmedabad, Gujarat, India");
    expect(mail.html).toContain("nimesh3536@gmail.com");
    expect(mail.html).toContain("Unsubscribe");
    expect(mail.text).toContain("https://gpufit.tech/alerts/unsubscribe?token=abc");
  });

  it("builds RFC 8058 headers aimed at the POST unsubscribe route", () => {
    const url = oneClickUnsubscribeUrl("https://gpufit.tech", "tok/en");
    expect(url).toBe("https://gpufit.tech/api/alerts/unsubscribe/?token=tok%2Fen");
    expect(listUnsubscribeHeaders(url)).toEqual({
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});
