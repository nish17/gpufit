import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { BEST_TIERS, devices, fitDevice, models, seoPairs } from "../src/lib/catalog";
import { formatTokRange } from "../src/lib/estimator/format";
import { ogCardSvg } from "../src/lib/og-card";

const root = path.resolve("public/og");

async function writeCard(file: string, card: { kicker: string; title: string; subtitle: string; footer: string }) {
  await mkdir(path.dirname(file), { recursive: true });
  const png = await sharp(Buffer.from(ogCardSvg(card))).png().toBuffer();
  if (png.length < 2000) throw new Error(`OG image too small: ${file}`);
  await writeFile(file, png);
}

const jobs: { file: string; card: { kicker: string; title: string; subtitle: string; footer: string } }[] = [];

function queue(file: string, card: { kicker: string; title: string; subtitle: string; footer: string }) {
  jobs.push({ file: path.join(root, file), card });
}

queue("default.png", {
  kicker: "GPUfit",
  title: "Which open models fit?",
  subtitle: "GPU, Mac, and CPU estimates for GGUF quants.",
  footer: "Estimate from memory bandwidth, not a benchmark.",
});

for (const tier of BEST_TIERS) {
  queue(`best/${tier.slug}.png`, {
    kicker: "Best fits",
    title: tier.title.replace(/^Best local LLMs for /, ""),
    subtitle: tier.blurb,
    footer: "Estimate from memory bandwidth, not a benchmark.",
  });
}

for (const model of models) {
  queue(`models/${model.slug}.png`, {
    kicker: "Model",
    title: model.name,
    subtitle: `${model.paramsB >= 10 ? model.paramsB.toFixed(0) : model.paramsB.toFixed(1)}B ${model.architecture}`,
    footer: "VRAM fit and a speed estimate",
  });
}

for (const device of devices) {
  queue(`devices/${device.slug}.png`, {
    kicker: device.kind,
    title: device.name,
    subtitle: `${device.defaultMemoryGb} GB · ${device.bandwidthGBps} GB/s`,
    footer: "Which open models fit",
  });
}

for (const { model, device } of seoPairs()) {
  const fit = fitDevice(model, device);
  const speed = fit.tokPerSec ? `${formatTokRange(fit.tokPerSec)} tok/s` : "speed n/a";
  queue(`pairs/${model.slug}--${device.slug}.png`, {
    kicker: "Can I run it?",
    title: model.name,
    subtitle: device.name,
    footer: `${fit.label} · ${fit.quant?.id ?? "no quant"} · ${speed} (estimate)`,
  });
}

const width = 8;
for (let index = 0; index < jobs.length; index += width) {
  await Promise.all(jobs.slice(index, index + width).map((job) => writeCard(job.file, job.card)));
}

console.log(`Wrote ${jobs.length} OG images to ${root}`);
