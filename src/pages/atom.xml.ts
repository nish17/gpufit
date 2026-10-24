import type { APIRoute } from "astro";
import { freshModels, modelPath } from "../lib/catalog";
import { formatParams } from "../lib/estimator";
import { atomDocument } from "../lib/rss";
import { DEFAULT_SITE } from "../lib/site";

export function GET({ site }: Parameters<APIRoute>[0]) {
  const origin = site?.toString().replace(/\/$/, "") || DEFAULT_SITE;
  const items = freshModels(21).slice(0, 30).map((model) => ({
    title: model.name,
    link: `${origin}${modelPath(model)}`,
    date: model.createdAt,
    description: `${formatParams(model.paramsB)} ${model.architecture}. ${model.description || ""}`,
  }));
  return new Response(atomDocument({ title: "GPUfit — new models", link: `${origin}/new/`, description: "Newly tracked open models.", items }), {
    headers: { "Content-Type": "application/atom+xml; charset=utf-8" },
  });
}
