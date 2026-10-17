import type { APIRoute } from "astro";
import { confirmAlert, loadAlertEnv } from "../../../lib/alerts/server";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get("token") || "";
  const result = await confirmAlert(token, await loadAlertEnv());
  return Response.json(result, { status: result.ok ? 200 : 400 });
};
