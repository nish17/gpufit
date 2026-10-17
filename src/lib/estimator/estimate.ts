import {
  GB,
  MBU_HIGH,
  MBU_LOW,
  OFFLOAD_RAM_RESERVE_BYTES,
  UTIL_GREAT,
  UTIL_RUNS,
  UTIL_TIGHT,
} from "./constants";
import {
  activeWeightBytes,
  bytesPerTokenKv,
  engineOverhead,
  kvBytes,
  memoryPool,
  moeResidentFraction,
  weightBytesFor,
} from "./memory";
import type {
  DeviceSpec,
  FitMode,
  FitResult,
  ModelSpec,
  QuantSpec,
  RuntimeOptions,
  VerdictId,
} from "./types";
import { formatContext, formatGB, formatTokRange } from "./format";

export function verdictFromUtilization(utilization: number): "great" | "runs" | "tight" | "over" {
  if (utilization <= UTIL_GREAT) return "great";
  if (utilization <= UTIL_RUNS) return "runs";
  if (utilization <= UTIL_TIGHT) return "tight";
  return "over";
}

const LABELS: Record<VerdictId, string> = {
  great: "Runs great",
  runs: "Runs",
  tight: "Tight fit",
  raise_limit: "Raise memory limit",
  moe_offload: "Expert offload",
  offload: "Partial offload",
  cpu: "Runs on CPU",
  wont_fit: "Won't fit",
};

function contextLadder(max: number): number[] {
  const base = [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 200000, 262144, 524288, 1048576];
  const values = base.filter((item) => item <= max);
  if (max > 0 && values[values.length - 1] !== max) values.push(max);
  return values.length ? values : [Math.max(512, max)];
}

function maxFittingContext(arch: ModelSpec["arch"], weight: number, overhead: number, usable: number, modelMax: number): number {
  let best = 0;
  for (const ctx of contextLadder(modelMax)) {
    const total = weight + kvBytes(arch, ctx) + overhead;
    if (total <= usable * UTIL_TIGHT) best = ctx;
    else break;
  }
  return best;
}

function workingContext(maxFit: number, modelMax: number): number {
  const preferred = Math.min(8192, modelMax);
  if (maxFit >= preferred) return preferred;
  return maxFit;
}

function tokRange(bytesPerToken: number, bandwidthGBps: number): [number, number] | null {
  if (bytesPerToken <= 0 || bandwidthGBps <= 0) return null;
  const low = (MBU_LOW * bandwidthGBps * GB) / bytesPerToken;
  const high = (MBU_HIGH * bandwidthGBps * GB) / bytesPerToken;
  return [low, high];
}

function splitTokRange(gpuBytes: number, gpuBw: number, cpuBytes: number, cpuBw: number): [number, number] | null {
  if (gpuBw <= 0 || cpuBw <= 0) return null;
  const time = (mbu: number) => gpuBytes / (gpuBw * GB * mbu) + cpuBytes / (cpuBw * GB * mbu);
  const high = 1 / time(MBU_HIGH);
  const low = 1 / time(MBU_LOW);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return [low, high];
}

function commands(model: ModelSpec, quant: QuantSpec, context: number, gpuLayers: number | null): FitResult["commands"] {
  const ngl = gpuLayers == null ? 99 : Math.max(0, gpuLayers);
  const estimateNote = quant.estimated ? "# Quant size is estimated — the file may not be published yet\n" : "";
  const moeNote =
    model.moe && gpuLayers == null
      ? "# Expert offload is approximate. llama.cpp can pin experts to CPU:\n#   -ot \"\\\\.ffn_.*_exps\\\\.=CPU\"\n"
      : "";
  const llamaCpp = `${estimateNote}${moeNote}llama-server -hf ${model.id}:${quant.id} -c ${context} -ngl ${ngl}`;
  const ollama = model.ollama ? `ollama run ${model.ollama}` : null;
  const lmStudio = `${estimateNote}lms get ${model.id}\n# Then load quant ${quant.id}`;
  return { llamaCpp, ollama, lmStudio };
}

function assumptionsFor(parts: string[]): string[] {
  return [
    "Estimate, not a benchmark. Decode speed uses a memory-bandwidth model at 55–75% of peak.",
    "KV cache is FP16. Engine overhead assumes llama.cpp (0.3 GB + 1% of the weights). Ollama is closer to 0.9 GB + 3%, LM Studio closer to 1 GB + 3%.",
    ...parts,
  ];
}

function emptyResult(model: ModelSpec, summary: string): FitResult {
  return {
    verdict: "wont_fit",
    label: LABELS.wont_fit,
    bucket: "no",
    summary,
    quant: null,
    context: 0,
    maxContext: 0,
    weightBytes: 0,
    kvBytes: 0,
    overheadBytes: 0,
    totalBytes: 0,
    usableBytes: 0,
    utilization: Number.POSITIVE_INFINITY,
    tokPerSec: null,
    gpuLayers: null,
    totalLayers: model.arch.layers,
    spillBytes: 0,
    mode: "none",
    assumptions: assumptionsFor(["No quantization could be sized for this model."]),
    commands: { llamaCpp: "", ollama: null, lmStudio: "" },
  };
}

function summarizeFull(args: {
  label: string;
  device: DeviceSpec;
  quant: QuantSpec;
  context: number;
  maxContext: number;
  tok: [number, number] | null;
  weight: number;
  kv: number;
  total: number;
  usable: number;
  where: string;
}): string {
  const speed = args.tok ? `about ${formatTokRange(args.tok)} tok/s` : "speed unknown";
  const extra =
    args.maxContext > args.context ? ` Up to ${formatContext(args.maxContext)} context still fits.` : "";
  return `${args.label} ${args.where} your ${args.device.name} at ${args.quant.id}, ${formatContext(args.context)} context, ${speed}. Weights ${formatGB(args.weight)} plus ${formatGB(args.kv)} of KV cache — ${formatGB(args.total)} of ${formatGB(args.usable)} usable.${extra}`;
}

interface Placement {
  quant: QuantSpec;
  weight: number;
  estimated: boolean;
  overhead: number;
  context: number;
  maxContext: number;
  kv: number;
  total: number;
  usable: number;
  utilization: number;
  mode: FitMode;
  verdict: VerdictId;
  gpuLayers: number | null;
  spillBytes: number;
  tok: [number, number] | null;
  notes: string[];
}

function considerFull(
  model: ModelSpec,
  device: DeviceSpec,
  options: RuntimeOptions,
  quant: QuantSpec,
  usable: number,
  mode: FitMode,
  minContext = 4096,
): Placement | null {
  const modelMax = model.contextLength || 8192;
  const sized = weightBytesFor(model, quant);
  const overhead = engineOverhead(sized.bytes);
  const maxContext = maxFittingContext(model.arch, sized.bytes, overhead, usable, modelMax);
  const wanted = Math.min(minContext, modelMax);
  if (maxContext < wanted) return null;
  const context = workingContext(maxContext, modelMax);
  const kv = kvBytes(model.arch, context);
  const total = sized.bytes + kv + overhead;
  const utilization = usable > 0 ? total / usable : Number.POSITIVE_INFINITY;
  const band = verdictFromUtilization(utilization);
  if (band === "over") return null;
  const active = activeWeightBytes(model, sized.bytes);
  const perToken = active + bytesPerTokenKv(model.arch) * context;
  const bandwidth = device.kind === "gpu" ? device.bandwidthGBps : device.bandwidthGBps;
  return {
    quant,
    weight: sized.bytes,
    estimated: sized.estimated,
    overhead,
    context,
    maxContext,
    kv,
    total,
    usable,
    utilization,
    mode,
    verdict: mode === "cpu" ? "cpu" : band,
    gpuLayers: mode === "cpu" ? 0 : model.arch.layers,
    spillBytes: 0,
    tok: tokRange(perToken, bandwidth),
    notes: [],
  };
}

function considerOffload(
  model: ModelSpec,
  device: DeviceSpec,
  options: RuntimeOptions,
  quant: QuantSpec,
  usable: number,
): Placement | null {
  if (device.kind !== "gpu") return null;
  const modelMax = model.contextLength || 8192;
  const sized = weightBytesFor(model, quant);
  const overhead = engineOverhead(sized.bytes);
  const contextTarget = Math.min(4096, modelMax);
  const kv = kvBytes(model.arch, contextTarget);
  let budget = usable - overhead;
  if (budget <= 0) return null;
  let kvOnGpu = 0;
  if (budget > kv) {
    kvOnGpu = kv;
    budget -= kv;
  }
  const weightsOnGpu = Math.min(sized.bytes, Math.max(0, budget));
  const weightsOnCpu = sized.bytes - weightsOnGpu;
  if (weightsOnCpu <= 0) return null;
  const ramBudget = Math.max(0, options.systemRamGb * 1024 ** 3 - OFFLOAD_RAM_RESERVE_BYTES);
  const spill = weightsOnCpu + (kv - kvOnGpu);
  if (spill > ramBudget) return null;
  const layers = model.arch.layers || 1;
  const gpuLayers = Math.max(0, Math.min(layers, Math.round((weightsOnGpu / sized.bytes) * layers)));
  if (gpuLayers <= 0) return null;
  const active = activeWeightBytes(model, sized.bytes);
  const frac = weightsOnGpu / sized.bytes;
  const gpuBytes = active * frac + kvOnGpu;
  const cpuBytes = active * (1 - frac) + (kv - kvOnGpu);
  const total = sized.bytes + kv + overhead;
  return {
    quant,
    weight: sized.bytes,
    estimated: sized.estimated,
    overhead,
    context: contextTarget,
    maxContext: contextTarget,
    kv,
    total,
    usable,
    utilization: usable > 0 ? (weightsOnGpu + kvOnGpu + overhead) / usable : 1,
    mode: "layer_offload",
    verdict: "offload",
    gpuLayers,
    spillBytes: spill,
    tok: splitTokRange(gpuBytes, device.bandwidthGBps, cpuBytes, options.ramBandwidthGBps),
    notes: [`About ${gpuLayers} of ${layers} layers stay on the GPU. ${formatGB(spill)} is read from system RAM.`],
  };
}

function considerMoe(
  model: ModelSpec,
  device: DeviceSpec,
  options: RuntimeOptions,
  quant: QuantSpec,
  usable: number,
): Placement | null {
  if (device.kind !== "gpu") return null;
  const fraction = moeResidentFraction(model);
  if (fraction == null) return null;
  const modelMax = model.contextLength || 8192;
  const sized = weightBytesFor(model, quant);
  const overhead = engineOverhead(sized.bytes);
  const contextTarget = Math.min(8192, modelMax);
  const kv = kvBytes(model.arch, contextTarget);
  const resident = sized.bytes * fraction;
  if (resident + kv + overhead > usable * UTIL_TIGHT) return null;
  const spill = sized.bytes - resident;
  const ramBudget = Math.max(0, options.systemRamGb * 1024 ** 3 - OFFLOAD_RAM_RESERVE_BYTES);
  if (spill > ramBudget) return null;
  const active = activeWeightBytes(model, sized.bytes);
  const activeOnGpu = Math.min(resident, active);
  const activeOnRam = Math.max(0, active - activeOnGpu);
  return {
    quant,
    weight: sized.bytes,
    estimated: sized.estimated,
    overhead,
    context: contextTarget,
    maxContext: contextTarget,
    kv,
    total: resident + kv + overhead,
    usable,
    utilization: usable > 0 ? (resident + kv + overhead) / usable : 1,
    mode: "moe_offload",
    verdict: "moe_offload",
    gpuLayers: null,
    spillBytes: spill,
    tok: splitTokRange(activeOnGpu + kv, device.bandwidthGBps, activeOnRam, options.ramBandwidthGBps),
    notes: [
      "Mixture-of-experts split is approximate: shared layers on the GPU, expert tensors in system RAM. Speed uses active parameters.",
    ],
  };
}

function byQuality(quants: QuantSpec[]): QuantSpec[] {
  return [...quants].sort((a, b) => b.quality - a.quality || a.bytes - b.bytes);
}

function q4ish(quants: QuantSpec[]): QuantSpec[] {
  const sorted = [...quants].sort(
    (a, b) => Math.abs(a.quality - 52) - Math.abs(b.quality - 52) || b.quality - a.quality,
  );
  return sorted;
}

export function estimate(model: ModelSpec, device: DeviceSpec, options: RuntimeOptions): FitResult {
  if (!model.quants.length || !model.arch?.layers) {
    return emptyResult(model, `${model.name} is missing architecture or quant data, so GPUfit will not guess a verdict.`);
  }
  const pool = memoryPool(device, options);
  const usable = pool.usableBytes;
  const fullMode: FitMode = device.kind === "cpu" ? "cpu" : device.kind === "gpu" ? "gpu" : "apple";
  const ranked = byQuality(model.quants);

  const fullAt = (minContext: number): Placement | null => {
    for (const quant of ranked) {
      const place = considerFull(model, device, options, quant, usable, fullMode, minContext);
      if (place) return place;
    }
    return null;
  };

  const modelMax = model.contextLength || 8192;
  let full = fullAt(Math.min(4096, modelMax)) ?? fullAt(Math.min(1024, modelMax));

  if (!full && pool.relaxedBytes && pool.relaxedBytes > usable + 1) {
    for (const quant of ranked) {
      const place = considerFull(model, device, options, quant, pool.relaxedBytes, "raise_limit");
      if (place) {
        full = { ...place, mode: "raise_limit", verdict: "raise_limit", usable: pool.relaxedBytes };
        break;
      }
    }
  }

  let offload: Placement | null = null;
  if (!full && device.kind === "gpu") {
    for (const quant of q4ish(model.quants)) {
      const moe = considerMoe(model, device, options, quant, usable);
      if (moe) {
        offload = moe;
        break;
      }
    }
    if (!offload) {
      for (const quant of q4ish(model.quants)) {
        const place = considerOffload(model, device, options, quant, usable);
        if (place) {
          offload = place;
          break;
        }
      }
    }
  }

  const chosen = full ?? offload;
  if (!chosen) {
    const smallest = [...model.quants].sort((a, b) => a.bytes - b.bytes)[0];
    const sized = smallest ? weightBytesFor(model, smallest) : null;
    const summary = sized
      ? `Won't fit on ${device.name}. The smallest quant ${smallest.id} is ${formatGB(sized.bytes)} before KV cache, and usable memory is ${formatGB(usable)}.`
      : `Won't fit on ${device.name}.`;
    return {
      ...emptyResult(model, summary),
      quant: smallest ?? null,
      weightBytes: sized?.bytes ?? 0,
      usableBytes: usable,
      assumptions: assumptionsFor([
        options.drivesDisplay && device.kind === "gpu" ? "0.5 GB is reserved because the GPU also drives a display, then 5% is left free." : "No display reserve on this device.",
        `Usable memory for this profile is ${formatGB(usable)}.`,
      ]),
      commands: smallest
        ? commands(model, smallest, Math.min(2048, model.contextLength || 2048), 0)
        : { llamaCpp: "", ollama: null, lmStudio: "" },
    };
  }

  const where =
    chosen.mode === "cpu"
      ? "on"
      : chosen.mode === "apple"
        ? "fully in unified memory on"
        : chosen.mode === "raise_limit"
          ? "only if you raise the GPU memory limit on"
          : "fully on";

  let summary: string;
  if (chosen.verdict === "offload") {
    const speed = chosen.tok ? ` Expect about ${formatTokRange(chosen.tok)} tok/s.` : "";
    summary = `Partial offload on your ${device.name}: ${chosen.quant.id} at ${formatContext(chosen.context)} context, ${chosen.gpuLayers} of ${model.arch.layers} layers on the GPU and ${formatGB(chosen.spillBytes)} in system RAM.${speed}`;
  } else if (chosen.verdict === "moe_offload") {
    const speed = chosen.tok ? ` About ${formatTokRange(chosen.tok)} tok/s.` : "";
    summary = `Expert offload on your ${device.name}: ${chosen.quant.id} keeps shared weights on the GPU and about ${formatGB(chosen.spillBytes)} of experts in system RAM.${speed} Active-parameter speed is approximate.`;
  } else if (chosen.verdict === "raise_limit") {
    summary = `Too big for the default ${Math.round((options.appleGpuFraction ?? 0.75) * 100)}% GPU budget on ${device.name} (${formatGB(usable)} usable). ${chosen.quant.id} fits if you raise the wired limit, using about ${formatGB(chosen.total)} of ${formatGB(chosen.usable)}.`;
  } else {
    const label = chosen.mode === "cpu" ? "Runs on CPU" : LABELS[chosen.verdict];
    summary = summarizeFull({
      label,
      device,
      quant: chosen.quant,
      context: chosen.context,
      maxContext: chosen.maxContext,
      tok: chosen.tok,
      weight: chosen.weight,
      kv: chosen.kv,
      total: chosen.total,
      usable: chosen.usable,
      where,
    });
  }

  const notes = [
    chosen.estimated
      ? `${chosen.quant.id} size is estimated from parameters × bits-per-weight because a GGUF file size was not available.`
      : `${chosen.quant.id} size is the real GGUF file size from Hugging Face.`,
    options.drivesDisplay && device.kind === "gpu"
      ? "0.5 GB is reserved because this GPU also drives a display, then 5% of the rest is left free."
      : device.kind === "mac" || device.kind === "unified"
        ? `Unified memory uses ${Math.round((options.appleGpuFraction ?? 0.75) * 100)}% for the GPU by default, and always leaves about 5 GB for the OS.`
        : "CPU runs keep about 4 GB plus a 10% cushion for the OS.",
    `Speed is quoted at ${formatContext(chosen.context)} context, not at the maximum context that still fits.`,
    ...chosen.notes,
  ];

  const bucket =
    chosen.verdict === "wont_fit"
      ? "no"
      : chosen.verdict === "offload" || chosen.verdict === "moe_offload"
        ? "offload"
        : chosen.verdict === "raise_limit"
          ? "limit"
          : "full";

  return {
    verdict: chosen.verdict,
    label: LABELS[chosen.verdict],
    bucket,
    summary,
    quant: chosen.quant,
    context: chosen.context,
    maxContext: chosen.maxContext,
    weightBytes: chosen.weight,
    kvBytes: chosen.kv,
    overheadBytes: chosen.overhead,
    totalBytes: chosen.total,
    usableBytes: chosen.usable,
    utilization: chosen.utilization,
    tokPerSec: chosen.tok,
    gpuLayers: chosen.gpuLayers,
    totalLayers: model.arch.layers,
    spillBytes: chosen.spillBytes,
    mode: chosen.mode,
    assumptions: assumptionsFor(notes),
    commands: commands(model, chosen.quant, chosen.context, chosen.gpuLayers),
  };
}

export function compareFits(a: FitResult, b: FitResult): number {
  const order: VerdictId[] = ["great", "runs", "tight", "cpu", "raise_limit", "moe_offload", "offload", "wont_fit"];
  const delta = order.indexOf(a.verdict) - order.indexOf(b.verdict);
  if (delta !== 0) return delta;
  const aTok = a.tokPerSec?.[1] ?? 0;
  const bTok = b.tokPerSec?.[1] ?? 0;
  return bTok - aTok;
}
