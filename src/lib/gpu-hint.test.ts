import { describe, expect, it } from "vitest";
import { hintSlug } from "./gpu-hint";

describe("browser GPU hint", () => {
  it("reads common WebGL renderer strings", () => {
    expect(hintSlug("ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)")).toBe("m4-pro");
    expect(hintSlug("ANGLE (Apple, Apple M4, OpenGL 4.1)")).toBe("m4");
    expect(hintSlug("ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)")).toBe("m1-pro");
    expect(hintSlug("ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x00002803) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("rtx-4060-ti-16gb");
    expect(hintSlug("")).toBeNull();
    expect(hintSlug("apple gpu")).toBeNull();
  });
});