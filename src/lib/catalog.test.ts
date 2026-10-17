import { describe, expect, it } from "vitest";
import { devices, models, seoPairs } from "./catalog";
import { estimate } from "./estimator";
import { defaultProfile, toOptions } from "./profile";

describe("catalog", () => {
  it("ships a sourced hardware list and a real model snapshot", () => {
    expect(devices.length).toBeGreaterThanOrEqual(100);
    expect(new Set(devices.map((device) => device.slug)).size).toBe(devices.length);
    expect(devices.every((device) => device.bandwidthGBps > 0 && device.sourceUrl.startsWith("http"))).toBe(true);
    const card = devices.find((device) => device.slug === "rtx-4060-ti-16gb");
    expect(card?.vramGb).toBe(16);
    expect(card?.bandwidthGBps).toBe(288);

    expect(models.length).toBeGreaterThanOrEqual(150);
    expect(models.length).toBeLessThanOrEqual(300);
    expect(new Set(models.map((model) => model.slug)).size).toBe(models.length);
    expect(models.filter((model) => model.quants.some((quant) => !quant.estimated)).length).toBeGreaterThan(140);
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

  it("keeps programmatic pages in a sensible band", () => {
    const pairs = seoPairs();
    expect(pairs.length).toBeGreaterThan(400);
    expect(pairs.length).toBeLessThan(2500);
  });
});
