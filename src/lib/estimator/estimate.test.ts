import { describe, expect, it } from "vitest";
import { GiB, UTIL_GREAT, UTIL_RUNS, UTIL_TIGHT } from "./constants";
import { estimate, verdictFromUtilization } from "./estimate";
import { kvBytes, memoryPool, weightBytesFor } from "./memory";
import type { ArchSpec, DeviceSpec, ModelSpec, QuantSpec, RuntimeOptions } from "./types";

function arch(overrides: Partial<ArchSpec> = {}): ArchSpec {
  return {
    layers: 28,
    kvHeads: 4,
    headDim: 128,
    fullAttentionLayers: 28,
    slidingLayers: 0,
    slidingWindow: null,
    linearLayers: 0,
    linearStateBytes: 0,
    attention: "gqa",
    mlaBytesPerLayer: null,
    experts: null,
    expertsPerTok: null,
    ...overrides,
  };
}

function quant(id: string, bytes: number, quality: number, estimated = false): QuantSpec {
  return { id, bytes, quality, estimated };
}

function model(overrides: Partial<ModelSpec> = {}): ModelSpec {
  return {
    id: "example/Model-7B-GGUF",
    slug: "model-7b",
    name: "Model 7B",
    paramsB: 7.62,
    activeParamsB: null,
    moe: false,
    architecture: "llama",
    contextLength: 32768,
    useCases: ["chat"],
    arch: arch(),
    quants: [
      quant("Q8_0", 8.1 * GiB, 84),
      quant("Q4_K_M", 4.68 * GiB, 52),
      quant("Q2_K", 2.8 * GiB, 20),
    ],
    ollama: "model",
    ...overrides,
  };
}

function device(overrides: Partial<DeviceSpec> = {}): DeviceSpec {
  return {
    slug: "rtx-3060-12gb",
    name: "GeForce RTX 3060 12GB",
    vendor: "nvidia",
    category: "consumer",
    kind: "gpu",
    vramGb: 12,
    bandwidthGBps: 360,
    memoryType: "GDDR6",
    year: 2021,
    popular: true,
    sourceUrl: "https://www.nvidia.com",
    sourceNote: "test",
    memoryOptionsGb: null,
    defaultMemoryGb: 12,
    drivesDisplayDefault: true,
    ...overrides,
  };
}

function options(overrides: Partial<RuntimeOptions> = {}): RuntimeOptions {
  return {
    memoryGb: 12,
    systemRamGb: 32,
    ramBandwidthGBps: 89.6,
    drivesDisplay: true,
    ...overrides,
  };
}

describe("kv cache", () => {
  it("matches the GQA formula at 8K", () => {
    const bytes = kvBytes(arch(), 8192);
    expect(bytes).toBe(2 * 28 * 4 * 128 * 2 * 8192);
  });

  it("keeps sliding-window layers on the window, not the full context", () => {
    const hybrid = arch({
      layers: 32,
      fullAttentionLayers: 8,
      slidingLayers: 24,
      slidingWindow: 1024,
      attention: "hybrid",
    });
    const long = kvBytes(hybrid, 32768);
    const allFull = kvBytes(arch({ layers: 32, fullAttentionLayers: 32 }), 32768);
    const atWindow = kvBytes(hybrid, 1024);
    const justAbove = kvBytes(hybrid, 1025);
    expect(long).toBeLessThan(allFull);
    expect(justAbove - atWindow).toBe(2 * 8 * 4 * 128 * 2);
  });

  it("uses the MLA latent and stays smaller than a wide GQA cache", () => {
    const mla = arch({
      layers: 61,
      kvHeads: 128,
      headDim: 128,
      fullAttentionLayers: 61,
      attention: "mla",
      mlaBytesPerLayer: (512 + 64) * 2,
    });
    expect(kvBytes(mla, 4096)).toBe(61 * (512 + 64) * 2 * 4096);
    const gqa = arch({ layers: 61, kvHeads: 8, headDim: 128, fullAttentionLayers: 61 });
    expect(kvBytes(mla, 4096)).toBeLessThan(kvBytes(gqa, 4096) / 3);
  });

  it("does not grow linear-attention state with context", () => {
    const hybrid = arch({
      layers: 12,
      fullAttentionLayers: 2,
      linearLayers: 10,
      linearStateBytes: 1000,
      kvHeads: 1,
      headDim: 64,
      attention: "hybrid",
    });
    const delta = kvBytes(hybrid, 100_000) - kvBytes(hybrid, 1_000);
    expect(delta).toBe(2 * 2 * 1 * 64 * 2 * 99_000);
  });
});

describe("weights and pools", () => {
  it("prefers a real file size over the bits-per-weight fallback", () => {
    const sized = weightBytesFor(model(), quant("Q4_K_M", 1234, 52, false));
    expect(sized).toEqual({ bytes: 1234, estimated: false });
  });

  it("estimates Q4_K_M from the shared 4.85 bpw table", () => {
    const sized = weightBytesFor(model({ paramsB: 27.32 }), quant("Q4_K_M", 0, 52, true));
    expect(sized.estimated).toBe(true);
    expect(sized.bytes).toBe(Math.round((27.32e9 * 4.85) / 8));
  });

  it("caps Apple unified memory at 75% and at RAM minus 5 GB", () => {
    const mac = device({
      kind: "mac",
      slug: "m4",
      name: "Apple M4",
      vramGb: null,
      memoryOptionsGb: [16, 24, 32],
      defaultMemoryGb: 24,
    });
    const big = memoryPool(mac, options({ memoryGb: 24, drivesDisplay: false }));
    expect(big.usableBytes).toBe(18 * GiB);
    const small = memoryPool(mac, options({ memoryGb: 8, drivesDisplay: false }));
    expect(small.usableBytes).toBe(3 * GiB);
    expect(small.relaxedBytes).toBe(3 * GiB);
  });

  it("reserves display memory and 5% on a discrete GPU, and skips that on datacenter cards", () => {
    const card = device();
    const desktop = memoryPool(card, options({ drivesDisplay: true }));
    expect(desktop.usableBytes).toBeCloseTo((12 - 0.5) * 0.95 * GiB, 0);
    const headless = memoryPool(card, options({ drivesDisplay: false }));
    expect(headless.usableBytes).toBeCloseTo(12 * 0.95 * GiB, 0);
  });
});

describe("verdicts", () => {
  it("places utilization on the documented bands", () => {
    expect(verdictFromUtilization(UTIL_GREAT)).toBe("great");
    expect(verdictFromUtilization(UTIL_GREAT + 0.001)).toBe("runs");
    expect(verdictFromUtilization(UTIL_RUNS)).toBe("runs");
    expect(verdictFromUtilization(UTIL_RUNS + 0.001)).toBe("tight");
    expect(verdictFromUtilization(UTIL_TIGHT)).toBe("tight");
    expect(verdictFromUtilization(UTIL_TIGHT + 0.001)).toBe("over");
  });

  it("runs a 7B Q4 model fully on a 12GB GPU and quotes a tok/s range", () => {
    const fit = estimate(
      model({ quants: [quant("Q8_0", 11 * GiB, 84), quant("Q4_K_M", 4.68 * GiB, 52)] }),
      device(),
      options(),
    );
    expect(fit.bucket).toBe("full");
    expect(fit.verdict).toBe("great");
    expect(fit.quant?.id).toBe("Q4_K_M");
    expect(fit.context).toBe(8192);
    expect(fit.tokPerSec).not.toBeNull();
    expect(fit.tokPerSec![0]).toBeLessThan(fit.tokPerSec![1]);
    expect(fit.summary).toContain("tok/s");
    expect(fit.summary).toContain("GeForce RTX 3060 12GB");
    expect(fit.commands.llamaCpp).toContain("llama-server -hf example/Model-7B-GGUF:Q4_K_M");
    expect(fit.commands.ollama).toBe("ollama run model");
    expect(fit.kvBytes).toBe(2 * 28 * 4 * 128 * 2 * 8192);
  });

  it("keeps the higher-quality quant when both fit, and drops to Q4 when Q8 does not", () => {
    const roomy = estimate(
      model({
        quants: [quant("Q8_0", 4 * GiB, 84), quant("Q4_K_M", 3 * GiB, 52)],
      }),
      device({ vramGb: 24, defaultMemoryGb: 24, bandwidthGBps: 1008, name: "RTX 4090" }),
      options({ memoryGb: 24 }),
    );
    expect(roomy.quant?.id).toBe("Q8_0");

    const tightCard = estimate(
      model({
        quants: [quant("Q8_0", 11 * GiB, 84), quant("Q4_K_M", 5 * GiB, 52)],
      }),
      device(),
      options(),
    );
    expect(tightCard.bucket).toBe("full");
    expect(tightCard.quant?.id).toBe("Q4_K_M");
  });

  it("offloads a 70B model onto a 12GB card with 64GB RAM, and refuses it with 16GB RAM", () => {
    const big = model({
      id: "example/Model-70B-GGUF",
      name: "Model 70B",
      paramsB: 70,
      contextLength: 8192,
      arch: arch({ layers: 80, kvHeads: 8, headDim: 128, fullAttentionLayers: 80 }),
      quants: [quant("Q4_K_M", 40 * GiB, 52), quant("Q2_K", 26 * GiB, 20)],
      ollama: null,
    });
    const off = estimate(big, device(), options({ systemRamGb: 64 }));
    expect(off.verdict).toBe("offload");
    expect(off.gpuLayers).toBeGreaterThan(0);
    expect(off.gpuLayers).toBeLessThan(80);
    expect(off.spillBytes).toBeGreaterThan(GiB);
    expect(off.summary).toContain("Partial offload");

    const no = estimate(big, device({ vramGb: 8, defaultMemoryGb: 8, name: "RTX 3070" }), options({ memoryGb: 8, systemRamGb: 16 }));
    expect(no.verdict).toBe("wont_fit");
    expect(no.bucket).toBe("no");
  });

  it("asks Apple users to raise the wired limit when 75% is short and RAM minus the OS is not", () => {
    const heavy = model({
      name: "Huge 100B",
      paramsB: 100,
      contextLength: 8192,
      arch: arch({ layers: 8, kvHeads: 1, headDim: 64, fullAttentionLayers: 8 }),
      quants: [quant("Q4_K_M", 100 * GiB, 52)],
    });
    const mac = device({
      kind: "mac",
      slug: "m4-max-40gpu",
      name: "Apple M4 Max (40-core GPU)",
      vramGb: null,
      memoryOptionsGb: [128],
      defaultMemoryGb: 128,
      bandwidthGBps: 546,
    });
    const fit = estimate(heavy, mac, options({ memoryGb: 128, drivesDisplay: false }));
    expect(fit.verdict).toBe("raise_limit");
    expect(fit.bucket).toBe("limit");
  });

  it("is faster for MoE active weights, faster on a wider bus, and slower once layers spill to RAM", () => {
    const dense = model({
      quants: [quant("Q4_K_M", 20 * GiB, 52)],
      paramsB: 30,
      activeParamsB: null,
      moe: false,
    });
    const moe = model({
      ...dense,
      id: "example/Moe-30B-A3B-GGUF",
      name: "Moe 30B A3B",
      paramsB: 30,
      activeParamsB: 3,
      moe: true,
      arch: arch({ experts: 128, expertsPerTok: 8 }),
    });
    const card = device({ vramGb: 48, defaultMemoryGb: 48, bandwidthGBps: 960, name: "48GB" });
    const denseFit = estimate(dense, card, options({ memoryGb: 48, drivesDisplay: false }));
    const moeFit = estimate(moe, card, options({ memoryGb: 48, drivesDisplay: false }));
    expect(denseFit.bucket).toBe("full");
    expect(moeFit.bucket).toBe("full");
    expect(moeFit.tokPerSec![1]).toBeGreaterThan(denseFit.tokPerSec![1]);

    const slow = estimate(dense, device({ bandwidthGBps: 100, vramGb: 48, defaultMemoryGb: 48 }), options({ memoryGb: 48 }));
    const fast = estimate(dense, device({ bandwidthGBps: 1000, vramGb: 48, defaultMemoryGb: 48 }), options({ memoryGb: 48 }));
    expect(fast.tokPerSec![1]).toBeGreaterThan(slow.tokPerSec![1] * 5);

    const spilled = estimate(dense, device(), options({ systemRamGb: 64 }));
    expect(spilled.verdict).toBe("offload");
    expect(spilled.tokPerSec![1]).toBeLessThan(denseFit.tokPerSec![0]);
  });

  it("runs on CPU when the device has no GPU", () => {
    const cpu = device({
      kind: "cpu",
      slug: "cpu-ddr5-5600",
      name: "CPU only · DDR5-5600",
      vramGb: null,
      bandwidthGBps: 89.6,
      memoryOptionsGb: [32],
      defaultMemoryGb: 32,
      drivesDisplayDefault: false,
    });
    const fit = estimate(model(), cpu, options({ memoryGb: 32, drivesDisplay: false }));
    expect(fit.mode).toBe("cpu");
    expect(fit.bucket).toBe("full");
    expect(fit.summary).toContain("CPU only");
    expect(fit.tokPerSec![1]).toBeLessThan(80);
  });

  it("ignores a quant file that is far too small for the parameter count", () => {
    const huge = model({
      name: "Huge 284B",
      paramsB: 284,
      quants: [
        { id: "Q8_0", bytes: 11e9, quality: 84, estimated: false, bpw: 8.5 },
        { id: "Q4_K_M", bytes: 150e9, quality: 52, estimated: false, bpw: 4.85 },
      ],
    });
    const card = device({ vramGb: 16, defaultMemoryGb: 16, bandwidthGBps: 288, slug: "rtx-4060-ti-16gb" });
    const fit = estimate(huge, card, options({ memoryGb: 16 }));
    expect(fit.quant?.id).not.toBe("Q8_0");
  });
});
