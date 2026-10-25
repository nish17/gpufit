import { formatGB, formatTokRange } from "./estimator/format";
import type { DeviceSpec, FitResult, ModelSpec } from "./estimator/types";

export const ESTIMATE_NOTE = "Estimate from memory bandwidth, not a benchmark.";

const TITLE_SUFFIX = " · GPUfit";

/** Document title, kept to 60 characters when the core phrase is longer. */
export function pageTitle(core: string, max = 60): string {
  const clean = core.replace(/\s+/g, " ").trim();
  if (`${clean}${TITLE_SUFFIX}`.length <= max) return `${clean}${TITLE_SUFFIX}`;
  const room = Math.max(1, max - TITLE_SUFFIX.length - 1);
  return `${clean.slice(0, room).trimEnd()}…${TITLE_SUFFIX}`;
}

export function pairPageTitle(model: Pick<ModelSpec, "name">, device: Pick<DeviceSpec, "name">): string {
  const question = `Can I run ${model.name} on ${device.name}?`;
  const compact = `${model.name} on ${device.name}`;
  return pageTitle(`${question}${TITLE_SUFFIX}`.length <= 60 ? question : compact);
}

function clip(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function modelPageDescription(model: ModelSpec, fit: FitResult, deviceName: string): string {
  const quant = fit.quant?.id ?? "no quant";
  const speed = fit.tokPerSec ? `${formatTokRange(fit.tokPerSec)} tok/s (estimate)` : "speed n/a";
  const weights = formatGB(fit.weightBytes);
  const full = `${model.name} on ${deviceName}: ${fit.label} at ${quant}, about ${speed}. Weights ${weights}.`;
  const short = `${model.name}: ${fit.label} at ${quant}, ${speed}.`;
  return clip(full.length <= 160 ? full : short);
}

export function pairPageDescription(model: ModelSpec, device: DeviceSpec, fit: FitResult): string {
  const quant = fit.quant?.id ?? "no quant";
  const speed = fit.tokPerSec ? `${formatTokRange(fit.tokPerSec)} tok/s (estimate)` : "no speed";
  const weights = formatGB(fit.weightBytes);
  const full = `Can you run ${model.name} on ${device.name}? ${fit.label} at ${quant}, about ${speed}. VRAM ${weights}.`;
  const short = `${model.name} on ${device.name}: ${fit.label}, ${quant}, ${speed}.`;
  return clip(full.length <= 160 ? full : short);
}

export function websiteJsonLd(origin: string): Record<string, unknown>[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "GPUfit",
      url: `${origin}/`,
      description: "Which open-source LLMs fit on a GPU, Mac, or CPU, at which quant, and roughly how fast.",
    },
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "GPUfit",
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Web",
      url: `${origin}/`,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      description: "Free estimates of which open models fit in your GPU, unified memory, or system RAM.",
    },
  ];
}

export function breadcrumbJsonLd(origin: string, crumbs: { name: string; path: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: new URL(crumb.path, `${origin}/`).toString(),
    })),
  };
}
