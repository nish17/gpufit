import { describe, expect, it } from "vitest";
import rawModels from "../data/models.json";
import { deviceRunLinks, devices, fitDevice, modelRunLinks, models, pairLink, seoPairs } from "./catalog";
import { estimate } from "./estimator";
import { quantIssues } from "./estimator/quants";
import type { ModelSpec } from "./estimator/types";
import { defaultProfile, toOptions } from "./profile";
import { bestList, bestPicks, compareForMachine } from "./ranking";
import { modelPageDescription, pairPageDescription, pairPageTitle } from "./seo";
import { familyKey } from "./select-models";

describe("catalog", () => {
  it("ships a sourced hardware list and a real model snapshot", () => {
    expect(devices.length).toBeGreaterThanOrEqual(100);
    expect(new Set(devices.map((device) => device.slug)).size).toBe(devices.length);
    expect(devices.every((device) => device.bandwidthGBps > 0 && device.sourceUrl.startsWith("http"))).toBe(true);
    const card = devices.find((device) => device.slug === "rtx-4060-ti-16gb");
    expect(card?.vramGb).toBe(16);
    expect(card?.bandwidthGBps).toBe(288);

    expect(models.length).toBeGreaterThanOrEqual(100);
    expect(models.length).toBeLessThanOrEqual(300);
    expect(new Set(models.map((model) => model.slug)).size).toBe(models.length);
    expect(new Set(models.map((model) => familyKey(model))).size).toBe(models.length);
    expect(models.filter((model) => model.quants.some((quant) => !quant.estimated)).length).toBeGreaterThan(90);
    expect(models.some((model) => /memduet|uncensor|abliterat|heretic|ornith|laguna/i.test(`${model.name} ${model.id}`))).toBe(false);
    for (const model of models) {
      expect(model.arch.layers).toBeGreaterThan(0);
      expect(model.quants.length).toBeGreaterThan(0);
      expect(model.paramsB).toBeGreaterThan(0.3);
    }
  });

  it("can score a real catalog model against a 16GB card", () => {
    const model = models.find((item) => /qwen3\.8 27b$/i.test(item.name));
    const device = devices.find((item) => item.slug === "rtx-4060-ti-16gb");
    expect(model).toBeTruthy();
    expect(device).toBeTruthy();
    const fit = estimate(model!, device!, toOptions(defaultProfile(device!)));
    expect(fit.quant).toBeTruthy();
    expect(fit.summary.length).toBeGreaterThan(40);
    expect(fit.commands.llamaCpp).toContain("llama-server");
  });

  it("leads a 16GB card with capable models and three role picks", () => {
    const device = devices.find((item) => item.slug === "rtx-4060-ti-16gb");
    expect(device).toBeTruthy();
    const ranked = models
      .map((model) => ({ model, fit: estimate(model, device!, toOptions(defaultProfile(device!))) }))
      .sort(compareForMachine);
    expect(ranked[0].model.paramsB).toBeGreaterThan(8);
    expect(ranked[0].fit.bucket).toBe("full");
    expect(ranked[0].fit.tokPerSec?.[0] ?? 0).toBeGreaterThanOrEqual(9.5);
    const tiny = ranked.findIndex((row) => row.model.paramsB < 2);
    expect(tiny).toBeGreaterThan(10);
    const picks = bestPicks(ranked);
    expect(picks.map((pick) => pick.role)).toEqual(["chat", "coding", "reasoning"]);
    expect(new Set(picks.map((pick) => pick.model.slug)).size).toBe(3);
    expect(picks.every((pick) => pick.fit.bucket !== "no")).toBe(true);
  });

  it("keeps programmatic pages in a sensible band", () => {
    const pairs = seoPairs();
    expect(pairs.length).toBeGreaterThan(400);
    expect(pairs.length).toBeLessThan(2500);
  });

  it("rejects implausible GGUF sizes in the committed catalog", () => {
    const problems = (rawModels as ModelSpec[]).flatMap((model) => quantIssues(model));
    expect(problems).toEqual([]);
  });

  it("links every generated can-i-run pair from a model hub and nowhere else", () => {
    const linked = new Set<string>();
    for (const model of models) {
      for (const device of modelRunLinks(model)) linked.add(`${model.slug}::${device.slug}`);
    }
    const pairs = seoPairs();
    expect(linked.size).toBe(pairs.length);
    const fromDevices = new Set<string>();
    for (const device of devices) {
      for (const model of deviceRunLinks(device)) fromDevices.add(`${model.slug}::${device.slug}`);
    }
    expect(fromDevices.size).toBe(pairs.length);
    for (const pair of pairs) {
      expect(pairLink(pair.model, pair.device)).toBe(`/can-i-run/${pair.model.slug}/on/${pair.device.slug}/`);
    }
    const rare = devices.find((device) => !seoPairs().some((pair) => pair.device.slug === device.slug));
    expect(rare).toBeTruthy();
    expect(pairLink(models[0], rare!)).toBeNull();
  });

  it("keeps IQ1 and IQ2 off the 8GB best-fit list and caps MoE speeds", () => {
    const eight = devices.find((device) => device.slug === "rtx-4060-ti-8gb");
    expect(eight).toBeTruthy();
    const rows = bestList(models.map((model) => ({ model, fit: fitDevice(model, eight!) })));
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((row) => (row.fit.quant?.quality ?? 0) >= 20)).toBe(true);
    expect(rows.every((row) => !/IQ[12]_/i.test(row.fit.quant?.id ?? ""))).toBe(true);
    expect(rows.some((row) => /cyber tiel|qwythos/i.test(row.model.name))).toBe(false);
    expect(models.some((model) => /cyber tiel|qwythos/i.test(model.name))).toBe(true);

    const card = devices.find((device) => device.slug === "rtx-3080-10gb");
    const lfm = models.find((model) => model.slug === "lfm2-5-24b-a2b");
    const qwen = models.find((model) => model.slug === "qwen3-5-35b-a3b");
    const rtx = devices.find((device) => device.slug === "rtx-4090");
    expect(lfm && card && qwen && rtx).toBeTruthy();
    const lfmFit = fitDevice(lfm!, card!);
    const qwenFit = fitDevice(qwen!, rtx!);
    if (lfmFit.tokPerSec) expect(lfmFit.tokPerSec[1]).toBeLessThanOrEqual(160);
    if (qwenFit.tokPerSec) expect(qwenFit.tokPerSec[1]).toBeLessThanOrEqual(160);
    if (lfmFit.quant && /IQ[12]_/i.test(lfmFit.quant.id)) expect(lfmFit.label).toBe("Heavily degraded");
  });

  it("writes a unique model and pair description of at most 160 characters", () => {
    const device = devices.find((item) => item.slug === "rtx-4060-ti-16gb");
    expect(device).toBeTruthy();
    const descriptions = models.map((model) => modelPageDescription(model, fitDevice(model, device!), device!.name));
    expect(new Set(descriptions).size).toBe(descriptions.length);
    expect(descriptions.every((text) => text.length <= 160 && text.length >= 40)).toBe(true);

    const pairText = seoPairs().map((pair) => pairPageDescription(pair.model, pair.device, fitDevice(pair.model, pair.device)));
    const pairTitles = seoPairs().map((pair) => pairPageTitle(pair.model, pair.device));
    expect(pairTitles.every((text) => text.length <= 60 && text.endsWith("· GPUfit"))).toBe(true);
    expect(new Set(pairText).size).toBe(pairText.length);
    expect(pairText.every((text) => text.length <= 160 && text.length >= 40)).toBe(true);
  });

  it("uses published active-parameter counts for DeepSeek V3 and R1", () => {
    for (const slug of ["deepseek-r1", "deepseek-v3-1", "deepseek-v3-2"]) {
      const model = models.find((item) => item.slug === slug);
      expect(model?.paramsB).toBeGreaterThan(600);
      expect(model?.activeParamsB).toBe(37);
      expect(model?.description).toContain("37.0B parameters active");
      expect(model?.description).not.toContain("121.6B");
    }
    const scout = models.find((model) => /llama 4 scout/i.test(model.name));
    const maverick = models.find((model) => /llama 4 maverick/i.test(model.name));
    const oss = models.find((model) => /gpt oss 120b/i.test(model.name));
    expect(scout?.activeParamsB).toBe(17);
    expect(maverick?.activeParamsB).toBe(17);
    expect(oss?.activeParamsB).toBe(5.1);
  });
});
