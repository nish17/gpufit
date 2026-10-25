import { describe, expect, it } from "vitest";
import { ogCardSvg } from "./og-card";

describe("og cards", () => {
  it("draws the GPUfit mark on a 1200 by 630 card", () => {
    const svg = ogCardSvg({
      kicker: "Model",
      title: "DeepSeek R1",
      subtitle: "671B · 37B active",
      footer: "Estimate from memory bandwidth, not a benchmark.",
    });
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
    expect(svg).toContain(">GPUfit</text>");
    expect(svg).toContain('fill="#34D399"');
    expect(svg).toContain('fill="#F1F5F9"');
    expect(svg).toContain("DeepSeek R1");
  });
});
