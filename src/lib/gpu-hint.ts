/** Map a browser GPU string to a catalog slug. Order is specific names first. */
const RULES: [RegExp, string][] = [
  [/5090/, "rtx-5090"],
  [/5080/, "rtx-5080"],
  [/5070\s*ti/, "rtx-5070-ti"],
  [/5070/, "rtx-5070"],
  [/5060\s*ti/, "rtx-5060-ti-16gb"],
  [/5060/, "rtx-5060"],
  [/4090/, "rtx-4090"],
  [/4080\s*super/, "rtx-4080-super"],
  [/4080/, "rtx-4080"],
  [/4070\s*ti\s*super/, "rtx-4070-ti-super"],
  [/4070\s*ti/, "rtx-4070-ti"],
  [/4070\s*super/, "rtx-4070-super"],
  [/4070/, "rtx-4070"],
  [/4060\s*ti/, "rtx-4060-ti-16gb"],
  [/4060/, "rtx-4060"],
  [/3090\s*ti/, "rtx-3090-ti"],
  [/3090/, "rtx-3090"],
  [/3080\s*ti/, "rtx-3080-ti"],
  [/3080/, "rtx-3080-10gb"],
  [/3070\s*ti/, "rtx-3070-ti"],
  [/3070/, "rtx-3070"],
  [/3060\s*ti/, "rtx-3060-ti"],
  [/3060/, "rtx-3060-12gb"],
  [/7900\s*xtx/, "rx-7900-xtx"],
  [/7800\s*xt/, "rx-7800-xt"],
  [/9070\s*xt/, "rx-9070-xt"],
  [/b580/, "arc-b580"],
  [/a770/, "arc-a770-16gb"],
  [/m5 max/, "m5-max-40gpu"],
  [/m5 pro/, "m5-pro"],
  [/m4 max/, "m4-max-40gpu"],
  [/m4 pro/, "m4-pro"],
  [/m3 ultra/, "m3-ultra"],
  [/m3 max/, "m3-max-40gpu"],
  [/m3 pro/, "m3-pro"],
  [/m2 ultra/, "m2-ultra"],
  [/m2 max/, "m2-max"],
  [/m2 pro/, "m2-pro"],
  [/m1 ultra/, "m1-ultra"],
  [/m1 max/, "m1-max"],
  [/m1 pro/, "m1-pro"],
  [/m5/, "m5"],
  [/m4/, "m4"],
  [/m3/, "m3"],
  [/m2/, "m2"],
  [/m1/, "m1"],
];

export function hintSlug(text: string): string | null {
  const lowered = text.toLowerCase();
  if (!lowered.trim()) return null;
  for (const [pattern, slug] of RULES) {
    if (pattern.test(lowered)) return slug;
  }
  return null;
}

export function webglRenderer(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return "";
    const value = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    const lose = gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}
