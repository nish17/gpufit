import hardwareJson from "../data/hardware.json";
import modelsJson from "../data/models.json";
import reportJson from "../data/fetch-report.json";
import { estimate } from "./estimator";
import { sanitizeQuants } from "./estimator/quants";
import type { DeviceSpec, FitResult, ModelSpec } from "./estimator/types";
import { defaultProfile, toOptions } from "./profile";
import { selectCatalog } from "./select-models";

const BLOCK = /diffusion|whisper|embed|flux|stable-diffusion|rerank|tts|musicgen|controlnet|ocr|locate-anything|ace-step/i;
const BLOCK_ARCH = new Set(["clip", "diffusion-gemma", "locateanything", "acestep-lm"]);

export const devices = hardwareJson as DeviceSpec[];
export const models = selectCatalog(
  (modelsJson as ModelSpec[])
    .filter((model) => !BLOCK.test(`${model.name} ${model.architecture} ${model.id}`))
    .filter((model) => !BLOCK_ARCH.has(String(model.architecture).toLowerCase())),
).map((model) => ({ ...model, quants: sanitizeQuants(model) }));

export const report = reportJson as {
  generatedAt: string;
  modelCount: number;
  withRealQuants: number;
  newRepoIds?: string[];
  hfTokenUsed?: boolean;
  ollamaLibraryCount?: number;
};

const deviceBySlug = new Map(devices.map((device) => [device.slug, device]));
const modelBySlug = new Map(models.map((model) => [model.slug, model]));

export function getDevice(slug: string): DeviceSpec | undefined {
  return deviceBySlug.get(slug);
}

export function getModel(slug: string): ModelSpec | undefined {
  return modelBySlug.get(slug);
}

export function deviceKindPath(device: DeviceSpec): "gpu" | "mac" | "cpu" {
  if (device.kind === "mac") return "mac";
  if (device.kind === "gpu") return "gpu";
  return "cpu";
}

function slash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

export function devicePath(device: DeviceSpec): string {
  return slash(`/${deviceKindPath(device)}/${device.slug}`);
}

export function modelPath(model: ModelSpec): string {
  return slash(`/models/${model.slug}`);
}

export function pairPath(model: ModelSpec, device: DeviceSpec): string {
  return slash(`/can-i-run/${model.slug}/on/${device.slug}`);
}

/** Null when that pair has no generated page, so templates cannot link a 404. */
export function pairLink(model: ModelSpec, device: DeviceSpec): string | null {
  return isSeoPair(model.slug, device.slug) ? pairPath(model, device) : null;
}

const POPULAR_DEVICE_CAP = 34;
const POPULAR_MODEL_CAP = 42;

export function seoDevices(): DeviceSpec[] {
  return devices.filter((device) => device.popular).slice(0, POPULAR_DEVICE_CAP);
}

export function seoModels(): ModelSpec[] {
  return models.slice(0, POPULAR_MODEL_CAP);
}

export function seoPairs(): { model: ModelSpec; device: DeviceSpec }[] {
  const chosenDevices = seoDevices();
  return seoModels().flatMap((model) => chosenDevices.map((device) => ({ model, device })));
}

let pairKeys: Set<string> | null = null;
export function isSeoPair(modelSlug: string, deviceSlug: string): boolean {
  if (!pairKeys) {
    pairKeys = new Set(seoPairs().map((pair) => `${pair.model.slug}::${pair.device.slug}`));
  }
  return pairKeys.has(`${modelSlug}::${deviceSlug}`);
}

/** Devices that have a generated can-i-run page for this model. */
export function modelRunLinks(model: ModelSpec): DeviceSpec[] {
  return seoDevices().filter((device) => isSeoPair(model.slug, device.slug));
}

/** Models that have a generated can-i-run page for this device. */
export function deviceRunLinks(device: DeviceSpec): ModelSpec[] {
  return seoModels().filter((model) => isSeoPair(model.slug, device.slug));
}

export function fitDevice(model: ModelSpec, device: DeviceSpec, memoryGb = device.defaultMemoryGb): FitResult {
  const profile = defaultProfile(device);
  profile.memoryGb = memoryGb;
  if (device.kind !== "gpu") profile.systemRamGb = memoryGb;
  return estimate(model, device, toOptions(profile));
}

export function freshModels(days = 14): ModelSpec[] {
  const cutoff = Date.now() - days * 86_400_000;
  const recent = models.filter((model) => {
    const stamp = Date.parse(model.createdAt || model.firstSeen || "");
    return Number.isFinite(stamp) && stamp >= cutoff;
  });
  const list = recent.length ? recent : [...models].sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "")).slice(0, 12);
  return list.sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
}

export function isRecentCatalog(days = 14): boolean {
  return models.some((model) => {
    const stamp = Date.parse(model.createdAt || "");
    return Number.isFinite(stamp) && stamp >= Date.now() - days * 86_400_000;
  });
}

export function alternatives(model: ModelSpec, device: DeviceSpec, current: FitResult): { model: ModelSpec; fit: FitResult }[] {
  const ranked = models
    .filter((other) => other.slug !== model.slug && other.useCases.some((use) => model.useCases.includes(use)))
    .map((other) => ({ model: other, fit: fitDevice(other, device) }))
    .filter((item) => item.fit.bucket === "full");
  if (current.bucket === "full") {
    return ranked.filter((item) => item.model.paramsB >= model.paramsB).slice(0, 3);
  }
  return ranked.sort((a, b) => b.model.paramsB - a.model.paramsB).slice(0, 3);
}

export function smallestFits(model: ModelSpec): { device: DeviceSpec; fit: FitResult }[] {
  const found: { device: DeviceSpec; fit: FitResult }[] = [];
  const ordered = [...devices].sort((a, b) => (a.vramGb ?? a.defaultMemoryGb) - (b.vramGb ?? b.defaultMemoryGb));
  for (const device of ordered) {
    if (device.kind === "cpu") continue;
    const fit = fitDevice(model, device);
    if (fit.bucket === "full") found.push({ device, fit });
    if (found.length >= 6) break;
  }
  return found;
}

export const BEST_TIERS = [
  { slug: "8gb", label: "8 GB", title: "Best local LLMs for 8GB VRAM", device: "rtx-4060-ti-8gb", blurb: "Cards in this class include the RTX 4060 Ti 8GB, RTX 4060, RTX 3070, and Arc A750." },
  { slug: "12gb", label: "12 GB", title: "Best local LLMs for 12GB VRAM", device: "rtx-3060-12gb", blurb: "The RTX 3060 12GB, RTX 4070, and RTX 5070 sit in the 12GB band." },
  { slug: "16gb", label: "16 GB", title: "Best local LLMs for 16GB VRAM", device: "rtx-4060-ti-16gb", blurb: "16GB covers the RTX 4060 Ti 16GB, RTX 5060 Ti 16GB, RTX 4080, and RX 7800 XT." },
  { slug: "24gb", label: "24 GB", title: "Best local LLMs for 24GB VRAM", device: "rtx-4090", blurb: "24GB is the RTX 3090, RTX 4090, and RX 7900 XTX class." },
  { slug: "32gb", label: "32 GB", title: "Best local LLMs for 32GB", device: "rtx-5090", blurb: "32GB discrete cards such as the RTX 5090, plus 32GB Macs." },
  { slug: "mac", label: "Mac", title: "Best local LLMs for Apple silicon", device: "m4-pro", blurb: "Apple M-series chips share unified memory. This page uses an M4 Pro with 24GB as the reference." },
] as const;

export function updatedLabel(): string {
  const stamp = Date.parse(report.generatedAt || "");
  if (!Number.isFinite(stamp)) return "unknown";
  return new Date(stamp).toISOString().slice(0, 10);
}
