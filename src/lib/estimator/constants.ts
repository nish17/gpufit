import quantMeta from "../../data/quant-meta.json";

/** Binary gibibyte. Device memory is advertised this way: 16 GB on the box is 16 × 1024³ bytes. */
export const GiB = 1024 ** 3;

/** Decimal gigabyte, used for vendor bandwidth figures (GB/s means 1e9 bytes/s). */
export const GB = 1e9;

export const QUANT_META = quantMeta as Record<string, { bpw: number; quality: number }>;

/** llama.cpp measured starting point from VRAM Calculator's published table. */
export const LLAMA_CPP_FIXED_BYTES = 0.3 * GiB;
export const LLAMA_CPP_PERCENT = 0.01;

/** Leave this free so a desktop session is not evicted. Datacenter cards skip it. */
export const DISPLAY_RESERVE_BYTES = 0.5 * GiB;

/** Keep a cushion inside discrete VRAM. llmfit's top band is 98%; this stops us planning a 100% fill. */
export const DISCRETE_HEADROOM = 0.05;

/**
 * Default share of Apple (and other unified) memory the GPU can wire.
 * soverignplan documents ~75%. The rest stays with the OS and CPU.
 */
export const UNIFIED_GPU_FRACTION = 0.75;

/** Memory we refuse to hand to the model so the OS still runs. */
export const UNIFIED_OS_RESERVE_BYTES = 5 * GiB;
export const CPU_OS_RESERVE_BYTES = 4 * GiB;
export const OFFLOAD_RAM_RESERVE_BYTES = 6 * GiB;

/** Decode is memory-bandwidth bound. Ridgepoint measured ~0.61; we show 0.55–0.75. */
export const MBU_LOW = 0.55;
export const MBU_HIGH = 0.75;

/**
 * MoE speed does not read `active / total` of the file. Attention, embeddings,
 * and the always-on expert stay in the read, and expert gathers are scattered.
 * Floor the active share, then scale it. Caps live with these constants so a
 * 24B-A2B cannot be priced like a 2B dense model.
 */
export const MOE_READ_FLOOR = 0.22;
export const MOE_READ_SCALE = 1.85;
/** High end of the tok/s range for a large small-active MoE. */
export const MOE_TOK_CAP = 160;
/** Quants below this quality (IQ1 and IQ2) are not a usable fit. */
export const LOW_BIT_QUALITY = 20;

export const UTIL_GREAT = 0.6;
export const UTIL_RUNS = 0.85;
export const UTIL_TIGHT = 0.98;

export const KV_BYTES_PER_ELEMENT = 2;

export function quantBpw(id: string): number {
  return QUANT_META[id]?.bpw ?? 4.85;
}

export function quantQuality(id: string): number {
  return QUANT_META[id]?.quality ?? 50;
}
