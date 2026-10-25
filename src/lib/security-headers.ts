/**
 * Headers sent on static assets (`public/_headers`) and on Worker responses
 * (Astro middleware). CSP allows the inline theme boot script, per-page
 * JSON-LD, and style attributes. A stricter script policy is report-only:
 * hashing every JSON-LD blob would not survive a catalog change, and
 * `'unsafe-inline'` is ignored by browsers once a hash or nonce is present.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://challenges.cloudflare.com https://cloudflareinsights.com",
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self'",
].join("; ");

/** Report-only twin that drops script 'unsafe-inline', so the console shows what a hash-only policy would block. */
export const CONTENT_SECURITY_POLICY_REPORT_ONLY = CONTENT_SECURITY_POLICY.replace(
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
);

export const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Content-Security-Policy-Report-Only": CONTENT_SECURITY_POLICY_REPORT_ONLY,
};

export function applySecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
}
