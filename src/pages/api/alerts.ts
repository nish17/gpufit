import type { APIRoute } from "astro";
import { loadAlertEnv, requestAlert, validateSignup } from "../../lib/alerts/server";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Expected JSON." }, { status: 400 });
  }
  const parsed = validateSignup((body ?? {}) as Record<string, unknown>);
  if (typeof parsed === "string") {
    return Response.json({ ok: false, message: parsed }, { status: 400 });
  }
  const result = await requestAlert(parsed, await loadAlertEnv(), new URL(request.url).origin);
  return Response.json(result, { status: result.ok ? 200 : 503 });
};
