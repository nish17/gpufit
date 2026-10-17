export type AttentionKind = "gqa" | "mla" | "hybrid" | "mamba" | "sliding";

export interface ArchSpec {
  layers: number;
  kvHeads: number;
  headDim: number;
  fullAttentionLayers: number;
  slidingLayers: number;
  slidingWindow: number | null;
  linearLayers: number;
  linearStateBytes: number;
  linearStateApproximate?: boolean;
  attention: AttentionKind;
  /** FP16 bytes of the compressed MLA latent for one layer and one token. */
  mlaBytesPerLayer: number | null;
  experts: number | null;
  expertsPerTok: number | null;
}

export interface QuantSpec {
  id: string;
  bytes: number;
  estimated: boolean;
  quality: number;
  bpw?: number;
}

export interface ModelSpec {
  id: string;
  slug: string;
  name: string;
  author?: string;
  baseModel?: string | null;
  paramsB: number;
  activeParamsB: number | null;
  activeParamsEstimated?: boolean;
  moe: boolean;
  architecture: string;
  license?: string | null;
  contextLength: number | null;
  vision?: boolean;
  useCases: string[];
  createdAt?: string | null;
  firstSeen?: string;
  downloads?: number;
  likes?: number;
  downloadRank?: number;
  weightsEstimated?: boolean;
  arch: ArchSpec;
  quants: QuantSpec[];
  ollama?: string | null;
  description?: string;
  sources?: { gguf?: string; config?: string | null };
}

export type DeviceKind = "gpu" | "mac" | "unified" | "cpu";

export interface DeviceSpec {
  slug: string;
  name: string;
  vendor: string;
  category: string;
  kind: DeviceKind;
  vramGb: number | null;
  bandwidthGBps: number;
  memoryType: string;
  year: number;
  popular: boolean;
  sourceUrl: string;
  sourceNote: string;
  memoryOptionsGb: number[] | null;
  defaultMemoryGb: number;
  drivesDisplayDefault: boolean;
}

export interface RuntimeOptions {
  /** Selected VRAM, unified memory, or system RAM, in decimal-marketed GB (16 means 16 GiB). */
  memoryGb: number;
  /** System RAM available for offload. Ignored for CPU and unified-memory devices. */
  systemRamGb: number;
  /** System RAM bandwidth in decimal GB/s. Ignored when the device itself is the RAM. */
  ramBandwidthGBps: number;
  drivesDisplay: boolean;
  /** Fraction of unified memory the GPU may use before the user raises the limit. */
  appleGpuFraction?: number;
}

export type VerdictId =
  | "great"
  | "runs"
  | "tight"
  | "raise_limit"
  | "moe_offload"
  | "offload"
  | "cpu"
  | "wont_fit";

export type FitMode =
  | "gpu"
  | "apple"
  | "raise_limit"
  | "moe_offload"
  | "layer_offload"
  | "cpu"
  | "none";

export interface FitResult {
  verdict: VerdictId;
  label: string;
  bucket: "full" | "offload" | "limit" | "no";
  summary: string;
  quant: QuantSpec | null;
  context: number;
  maxContext: number;
  weightBytes: number;
  kvBytes: number;
  overheadBytes: number;
  totalBytes: number;
  usableBytes: number;
  utilization: number;
  tokPerSec: [number, number] | null;
  gpuLayers: number | null;
  totalLayers: number;
  spillBytes: number;
  mode: FitMode;
  assumptions: string[];
  commands: {
    llamaCpp: string;
    ollama: string | null;
    lmStudio: string;
  };
}
