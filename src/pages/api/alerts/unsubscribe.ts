import type { APIRoute } from "astro";
import { loadAlertEnv, unsubscribeAlert } from "../../../lib/alerts/server";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get("token") || "";
  const result = await unsubscribeAlert(token, await loadAlertEnv());
  return Response.json(result, { status: result.ok ? 200 : 400 });
};
