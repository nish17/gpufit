import type { APIRoute } from "astro";
import { loadAlertEnv, readLimitedText, unsubscribeAlert } from "../../../lib/alerts/server";

export const prerender = false;

const MAX_UNSUBSCRIBE_BODY_BYTES = 4 * 1024;

async function limitedBody(request: Request): Promise<boolean> {
  return (await readLimitedText(request, MAX_UNSUBSCRIBE_BODY_BYTES)) !== null;
}

async function run(token: string) {
  const result = await unsubscribeAlert(token, await loadAlertEnv());
  return Response.json(result, { status: result.ok ? 200 : 400 });
}

/** Existing mail uses this GET, via the HTML page and directly. */
export const GET: APIRoute = async ({ url }) => {
  return run(url.searchParams.get("token") || "");
};

/**
 * RFC 8058 one-click. Mail clients POST List-Unsubscribe=One-Click to the
 * List-Unsubscribe HTTPS URI. The token is the authorization; GET links in
 * mail that was already sent keep working.
 */
export const POST: APIRoute = async ({ request, url }) => {
  if (!(await limitedBody(request))) {
    return Response.json({ ok: false, message: "Could not unsubscribe." }, { status: 400 });
  }
  return run(url.searchParams.get("token") || "");
};
