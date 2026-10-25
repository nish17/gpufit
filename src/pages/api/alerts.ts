import type { APIRoute } from "astro";
import { GENERIC_ALERT_ERROR, MAX_ALERT_BODY_BYTES, handleAlertSignup, loadAlertEnv, readLimitedText, readSignupBody } from "../../lib/alerts/server";

export const prerender = false;

export const GET: APIRoute = async () => {
  const env = await loadAlertEnv();
  return Response.json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY?.trim() || null });
};

export const POST: APIRoute = async ({ request }) => {
  const raw = await readLimitedText(request, MAX_ALERT_BODY_BYTES);
  if (raw === null) return Response.json({ ok: false, message: GENERIC_ALERT_ERROR }, { status: 400 });
  const body = readSignupBody(raw);
  if (typeof body === "string") return Response.json({ ok: false, message: body }, { status: 400 });
  const outcome = await handleAlertSignup(body, await loadAlertEnv(), {
    devLinkOrigin: new URL(request.url).origin,
  });
  return Response.json(outcome.result, { status: outcome.status });
};
