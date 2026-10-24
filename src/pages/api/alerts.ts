import type { APIRoute } from "astro";
import { handleAlertSignup, loadAlertEnv } from "../../lib/alerts/server";

export const prerender = false;

export const GET: APIRoute = async () => {
  const env = await loadAlertEnv();
  return Response.json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY?.trim() || null });
};

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Expected JSON." }, { status: 400 });
  }
  const outcome = await handleAlertSignup((body ?? {}) as Record<string, unknown>, await loadAlertEnv(), {
    devLinkOrigin: new URL(request.url).origin,
  });
  return Response.json(outcome.result, { status: outcome.status });
};
