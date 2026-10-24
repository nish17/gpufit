import type { VerdictId } from "../estimator/types";

/** Six-digit hex only. Email clients drop rgba() and CSS variables. */
const PAPER = "#f4f1ea";
const CARD = "#fffcf7";
const INK = "#1c1915";
const MUTED = "#5f594f";
const LINE = "#e3dcd0";
const ACCENT = "#0d6b4c";
const ACCENT_INK = "#f3fff8";

const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "'Segoe UI',Helvetica,Arial,sans-serif";

const TONE: Record<VerdictId, { color: string; bg: string }> = {
  great: { color: "#0d6b4c", bg: "#e5f6ee" },
  runs: { color: "#1d5c4a", bg: "#e7f3ee" },
  tight: { color: "#8a5a12", bg: "#fff1d6" },
  cpu: { color: "#8a5a12", bg: "#fff1d6" },
  raise_limit: { color: "#8a3d12", bg: "#ffe8d8" },
  moe_offload: { color: "#8a3d12", bg: "#ffe8d8" },
  offload: { color: "#8a3d12", bg: "#ffe8d8" },
  wont_fit: { color: "#8d2f2f", bg: "#fde8e6" },
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function verdictTone(verdict: VerdictId): { color: string; bg: string } {
  return TONE[verdict];
}

function button(href: string, label: string): string {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  const width = Math.min(280, Math.max(168, label.length * 9 + 48));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td align="center" bgcolor="${ACCENT}" style="background:${ACCENT};border-radius:10px;">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" style="height:44px;v-text-anchor:middle;width:${width}px;" arcsize="18%" strokecolor="${ACCENT}" fillcolor="${ACCENT}">
<w:anchorlock/>
<center style="color:${ACCENT_INK};font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;">${safeLabel}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a href="${safeHref}" style="display:inline-block;padding:12px 22px;color:${ACCENT_INK};background:${ACCENT};border-radius:10px;font-family:${SANS};font-size:15px;font-weight:600;line-height:20px;text-decoration:none;">${safeLabel}</a>
<!--<![endif]-->
</td>
</tr>
</table>`;
}

function pill(label: string, verdict: VerdictId): string {
  const tone = verdictTone(verdict);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${tone.bg}" style="background:${tone.bg};color:${tone.color};font-family:${SANS};font-size:12px;font-weight:600;line-height:16px;padding:4px 8px;border-radius:999px;">${escapeHtml(label)}</td></tr></table>`;
}

export function emailShell(input: {
  origin: string;
  preheader: string;
  headline: string;
  intro: string;
  bodyHtml: string;
  unsubscribeUrl: string;
}): string {
  const origin = input.origin.replace(/\/$/, "");
  const home = escapeHtml(origin);
  const privacy = escapeHtml(`${origin}/privacy`);
  const unsubscribe = escapeHtml(input.unsubscribeUrl);
  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(input.headline)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
</head>
<body style="margin:0;padding:0;background:${PAPER};color:${INK};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${PAPER};">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="background:${PAPER};">
<tr>
<td align="center" style="padding:28px 16px;">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
<tr>
<td style="padding:0 4px 18px;">
<a href="${home}" style="text-decoration:none;"><img src="${home}/logo-small-24@2x.png" width="86" height="24" alt="GPUfit" style="display:block;border:0;height:24px;width:86px;"></a>
</td>
</tr>
<tr>
<td bgcolor="${CARD}" style="background:${CARD};border:1px solid ${LINE};border-radius:18px;padding:28px 28px 24px;">
<h1 style="margin:0;font-family:${SERIF};font-size:28px;line-height:34px;font-weight:500;letter-spacing:-0.03em;color:${INK};">${escapeHtml(input.headline)}</h1>
<p style="margin:12px 0 0;font-family:${SANS};font-size:16px;line-height:24px;color:${MUTED};">${escapeHtml(input.intro)}</p>
${input.bodyHtml}
</td>
</tr>
<tr>
<td style="padding:18px 8px 0;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED};">
GPUfit estimates local LLM fit. It is not a benchmark.<br>
<a href="${unsubscribe}" style="color:${MUTED};">Unsubscribe</a>
&nbsp;&middot;&nbsp;
<a href="${privacy}" style="color:${MUTED};">Privacy</a>
</td>
</tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr>
</table>
</body>
</html>`;
}

export function renderConfirmMail(input: { origin: string; confirmUrl: string; unsubscribeUrl: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = "Confirm GPUfit alerts";
  const text = [
    "Confirm alerts for this machine:",
    input.confirmUrl,
    "",
    "Nothing is mailed until you open that link.",
    "",
    "Unsubscribe:",
    input.unsubscribeUrl,
    "",
  ].join("\n");
  const html = emailShell({
    origin: input.origin,
    preheader: "Confirm alerts for this machine. Nothing is mailed until you do.",
    headline: "Confirm alerts for this machine",
    intro: "Nothing is mailed until you confirm. After that, a note arrives when a newly tracked model fits.",
    bodyHtml: `<div style="height:22px;line-height:22px;font-size:22px;">&nbsp;</div>
${button(input.confirmUrl, "Confirm alerts")}
<p style="margin:16px 0 0;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED};">Or open this link:<br><a href="${escapeHtml(input.confirmUrl)}" style="color:${ACCENT};word-break:break-all;">${escapeHtml(input.confirmUrl)}</a></p>`,
    unsubscribeUrl: input.unsubscribeUrl,
  });
  return { subject, text, html };
}

export function fitRowsHtml(
  rows: { name: string; href: string; label: string; verdict: VerdictId; detail: string }[],
): string {
  return rows
    .map((row, index) => {
      const gap = index === 0 ? 22 : 12;
      return `<div style="height:${gap}px;line-height:${gap}px;font-size:${gap}px;">&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="background:${PAPER};border-radius:14px;">
<tr>
<td style="padding:14px 16px;">
<a href="${escapeHtml(row.href)}" style="font-family:${SERIF};font-size:20px;line-height:26px;color:${INK};text-decoration:underline;">${escapeHtml(row.name)}</a>
<div style="height:8px;line-height:8px;font-size:8px;">&nbsp;</div>
${pill(row.label, row.verdict)}
<p style="margin:8px 0 0;font-family:${SANS};font-size:14px;line-height:20px;color:${MUTED};">${escapeHtml(row.detail)}</p>
</td>
</tr>
</table>`;
    })
    .join("");
}
