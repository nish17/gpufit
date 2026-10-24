import type { APIRoute } from "astro";
import { deviceKindPath, devices, fitDevice, freshModels, getDevice } from "../../../lib/catalog";
import { formatTokRange } from "../../../lib/estimator";
import { rssDocument } from "../../../lib/rss";
import { DEFAULT_SITE } from "../../../lib/site";

export function getStaticPaths() {
  return devices.map((device) => ({
    params: { kind: deviceKindPath(device), slug: device.slug },
  }));
}

export const GET: APIRoute = ({ site, params }) => {
  const device = getDevice(params.slug || "");
  if (!device || deviceKindPath(device) !== params.kind) {
    return new Response("Not found", { status: 404 });
  }
  const origin = site?.toString().replace(/\/$/, "") || DEFAULT_SITE;
  const items = freshModels(30).slice(0, 15).map((model) => {
    const fit = fitDevice(model, device);
    return {
      title: `${model.name} on ${device.name}: ${fit.label}`,
      link: `${origin}/models/${model.slug}`,
      date: model.createdAt,
      description: `${fit.summary} ${fit.tokPerSec ? formatTokRange(fit.tokPerSec) + " tok/s." : ""}`.trim(),
    };
  });
  return new Response(
    rssDocument({
      title: `GPUfit — ${device.name}`,
      link: `${origin}/${params.kind}/${device.slug}`,
      description: `New catalog models scored against ${device.name}.`,
      items,
    }),
    { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } },
  );
};
