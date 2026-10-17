import { describe, expect, it } from "vitest";
import { devices, models, seoPairs } from "./catalog";
import { estimate } from "./estimator";
import { defaultProfile, toOptions } from "./profile";
import { bestPicks, compareForMachine } from "./ranking";
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
});
