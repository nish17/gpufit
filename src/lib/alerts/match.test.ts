import { describe, expect, it } from "vitest";
import { GiB } from "../estimator/constants";
import type { ArchSpec, DeviceSpec, ModelSpec, QuantSpec } from "../estimator/types";
import { planAlertMails, renderFitMail, type AlertSubscriber } from "./match";

const now = Date.parse("2026-10-24T00:00:00Z");
const recent = new Date(now - 2 * 86_400_000).toISOString();
const stale = new Date(now - 40 * 86_400_000).toISOString();

function arch(): ArchSpec {
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
  };
}

function quant(id: string, bytes: number): QuantSpec {
  return { id, bytes, quality: 50, estimated: false };
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
    createdAt: recent,
    arch: arch(),
    quants: [quant("Q4_K_M", 4.68 * GiB)],
    ...overrides,
  };
}

function device(): DeviceSpec {
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
  };
}

function subscriber(overrides: Partial<AlertSubscriber> = {}): AlertSubscriber {
  return {
    id: "ada@example.com::rtx-3060-12gb",
    email: "ada@example.com",
    deviceId: "rtx-3060-12gb",
    memoryGb: 12,
    systemRamGb: 32,
    ramBandwidthGBps: 89.6,
    drivesDisplay: true,
    weeklyDigest: true,
    confirmed: true,
    ...overrides,
  };
}

const devices = [device()];

describe("planAlertMails", () => {
  it("mails a confirmed subscriber only about new models that fit and were not sent", () => {
    const fits = model();
    const tooBig = model({
      id: "example/Huge-GGUF",
      slug: "huge",
      name: "Huge",
      paramsB: 70,
      quants: [quant("Q4_K_M", 80 * GiB)],
    });
    const old = model({ id: "example/Old-GGUF", slug: "old", name: "Old", createdAt: stale });
    const already = model({ id: "example/Sent-GGUF", slug: "sent", name: "Sent" });
    const mails = planAlertMails({
      subscribers: [
        subscriber(),
        subscriber({ id: "new@example.com::rtx-3060-12gb", email: "new@example.com", confirmed: false }),
        subscriber({ id: "ghost@example.com::missing", email: "ghost@example.com", deviceId: "missing" }),
      ],
      models: [tooBig, old, already, fits],
      devices,
      alreadySent: [{ subscriberId: subscriber().id, modelId: already.id }],
      now,
    });
    expect(mails).toHaveLength(1);
    expect(mails[0]?.subscriber.email).toBe("ada@example.com");
    expect(mails[0]?.hits.map((hit) => hit.model.slug)).toEqual(["model-7b"]);
  });

  it("keeps the largest fitting models when a mail would be too long", () => {
    const smaller = model({ id: "example/Small-GGUF", slug: "small", name: "Small", paramsB: 3 });
    const larger = model({ id: "example/Large-GGUF", slug: "large", name: "Large", paramsB: 14 });
    const mails = planAlertMails({
      subscribers: [subscriber()],
      models: [smaller, larger],
      devices,
      alreadySent: [],
      now,
      limit: 1,
    });
    expect(mails[0]?.hits.map((hit) => hit.model.slug)).toEqual(["large"]);
  });
});

describe("renderFitMail", () => {
  it("names the machine, links the model, and includes unsubscribe", () => {
    const [mail] = planAlertMails({
      subscribers: [subscriber()],
      models: [model()],
      devices,
      alreadySent: [],
      now,
    });
    const rendered = renderFitMail(mail!, "https://gpufit.tech", "https://gpufit.tech/alerts/unsubscribe?token=abc");
    expect(rendered.subject).toContain("GeForce RTX 3060 12GB");
    expect(rendered.text).toContain("Model 7B");
    expect(rendered.text).toContain("https://gpufit.tech/models/model-7b");
    expect(rendered.text).toContain("https://gpufit.tech/alerts/unsubscribe?token=abc");
  });
});
