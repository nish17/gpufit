import {
  CPU_OS_RESERVE_BYTES,
  DISCRETE_HEADROOM,
  DISPLAY_RESERVE_BYTES,
  GiB,
  KV_BYTES_PER_ELEMENT,
  LLAMA_CPP_FIXED_BYTES,
  LLAMA_CPP_PERCENT,
  MOE_READ_FLOOR,
  MOE_READ_SCALE,
  UNIFIED_GPU_FRACTION,
  UNIFIED_OS_RESERVE_BYTES,
  quantBpw,
} from "./constants";
import type { ArchSpec, DeviceSpec, ModelSpec, QuantSpec, RuntimeOptions } from "./types";

export function gibibytes(gb: number): number {
  return gb * GiB;
}

/** KV cache bytes for `context` tokens. FP16. Linear/Mamba state is fixed, not per token. */
export function kvBytes(arch: ArchSpec, context: number): number {
  const ctx = Math.max(0, Math.floor(context));
  const slideCtx = Math.min(ctx, arch.slidingWindow ?? ctx);
  const useMla = arch.attention === "mla" && arch.mlaBytesPerLayer;
  let bytes = 0;
  if (useMla && arch.mlaBytesPerLayer) {
    bytes += arch.fullAttentionLayers * arch.mlaBytesPerLayer * ctx;
    bytes += arch.slidingLayers * arch.mlaBytesPerLayer * slideCtx;
  } else {
    const perLayer = 2 * arch.kvHeads * arch.headDim * KV_BYTES_PER_ELEMENT;
    bytes += arch.fullAttentionLayers * perLayer * ctx;
    bytes += arch.slidingLayers * perLayer * slideCtx;
  }
  bytes += arch.linearStateBytes || 0;
  return bytes;
}

export function bytesPerTokenKv(arch: ArchSpec): number {
  if (arch.attention === "mla" && arch.mlaBytesPerLayer) {
    return (arch.fullAttentionLayers + arch.slidingLayers) * arch.mlaBytesPerLayer;
  }
  const perLayer = 2 * arch.kvHeads * arch.headDim * KV_BYTES_PER_ELEMENT;
  return (arch.fullAttentionLayers + arch.slidingLayers) * perLayer;
}

export function weightBytesFor(model: ModelSpec, quant: QuantSpec): { bytes: number; estimated: boolean } {
  if (!quant.estimated && quant.bytes > 0) {
    return { bytes: quant.bytes, estimated: false };
  }
  const bpw = quant.bpw ?? quantBpw(quant.id);
  return { bytes: Math.round((model.paramsB * 1e9 * bpw) / 8), estimated: true };
}

export function engineOverhead(weightBytes: number): number {
  return LLAMA_CPP_FIXED_BYTES + LLAMA_CPP_PERCENT * weightBytes;
}

export interface Pool {
  usableBytes: number;
  /** Larger budget if a unified-memory machine raises the GPU wired limit. */
  relaxedBytes: number | null;
  kind: DeviceSpec["kind"];
}

export function memoryPool(device: DeviceSpec, options: RuntimeOptions): Pool {
  const memory = gibibytes(options.memoryGb);
  if (device.kind === "mac" || device.kind === "unified") {
    const fraction = options.appleGpuFraction ?? UNIFIED_GPU_FRACTION;
    const capped = memory * fraction;
    const afterOs = Math.max(0, memory - UNIFIED_OS_RESERVE_BYTES);
    return {
      usableBytes: Math.max(0, Math.min(capped, afterOs)),
      relaxedBytes: afterOs,
      kind: device.kind,
    };
  }
  if (device.kind === "cpu") {
    const afterOs = Math.max(0, memory - CPU_OS_RESERVE_BYTES);
    return { usableBytes: afterOs * 0.9, relaxedBytes: null, kind: "cpu" };
  }
  let vram = memory;
  if (options.drivesDisplay) vram = Math.max(0, vram - DISPLAY_RESERVE_BYTES);
  return { usableBytes: vram * (1 - DISCRETE_HEADROOM), relaxedBytes: null, kind: "gpu" };
}

export function activeWeightBytes(model: ModelSpec, weightBytes: number): number {
  if (model.activeParamsB && model.paramsB > 0 && model.activeParamsB < model.paramsB) {
    return weightBytes * (model.activeParamsB / model.paramsB);
  }
  return weightBytes;
}

/**
 * Bytes moved per token for the bandwidth estimate.
 * Dense models read the whole file. MoE models read more than the active-parameter
 * slice: shared layers stay on the bus, and expert gathers are not a contiguous read.
 */
export function speedWeightBytes(model: ModelSpec, weightBytes: number): number {
  if (!model.moe || !model.activeParamsB || model.paramsB <= 0) return weightBytes;
  if (model.activeParamsB >= model.paramsB * 0.85) return weightBytes;
  const ratio = model.activeParamsB / model.paramsB;
  const fraction = Math.min(1, Math.max(ratio, MOE_READ_FLOOR) * MOE_READ_SCALE);
  return weightBytes * fraction;
}

/** Share of the file that must stay on the GPU when experts are offloaded. Approximate. */
export function moeResidentFraction(model: ModelSpec): number | null {
  if (!model.moe || !model.activeParamsB || model.paramsB <= 0) return null;
  if (model.activeParamsB >= model.paramsB * 0.9) return null;
  const activeRatio = model.activeParamsB / model.paramsB;
  return Math.min(0.45, Math.max(activeRatio * 2, 0.08));
}
