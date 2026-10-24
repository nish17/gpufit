import { freshModels, modelPath, updatedLabel } from "../lib/catalog";
import { formatParams } from "../lib/estimator";
import { rssDocument } from "../lib/rss";
import { DEFAULT_SITE } from "../lib/site";

export function GET({ site }) {
  const origin = site?.toString().replace(/\/$/, "") || DEFAULT_SITE;
  const items = freshModels(21).slice(0, 30).map((model) => ({
    title: model.name,
    link: `${origin}${modelPath(model)}`,
    date: model.createdAt,
    description: `${formatParams(model.paramsB)} ${model.architecture}. ${model.description || ""} Catalog ${updatedLabel()}.`,
  }));
  return new Response(rssDocument({ title: "GPUfit — new models", link: `${origin}/new/`, description: "Newly tracked open models.", items }), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
