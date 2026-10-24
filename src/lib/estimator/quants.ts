import { LOW_BIT_QUALITY, QUANT_META } from "./constants";
import type { ModelSpec, QuantSpec } from "./types";

/** Keep in sync with scripts/hf_parse.py. */
export const MIN_SIZE_RATIO = 0.45;
export const MAX_SIZE_RATIO = 3.5;
export const BF16_SLACK = 1.05;
export const MONO_SMALL = 0.72;
export const MONO_INFLATED = 1.45;

export function expectedQuantBytes(paramsB: number, bpw: number): number {
  return (paramsB * 1e9 * bpw) / 8;
}

function bpwOf(quant: QuantSpec): number {
  return quant.bpw ?? QUANT_META[quant.id]?.bpw ?? 0;
}

function measured(quants: QuantSpec[]): QuantSpec[] {
  return quants.filter((quant) => !quant.estimated && bpwOf(quant) > 0);
}

function bf16Ceiling(quants: QuantSpec[], paramsB: number): number {
  const expected = expectedQuantBytes(paramsB, 16);
  const real = quants
    .filter((quant) => (quant.id === "BF16" || quant.id === "F16") && !quant.estimated && quant.bytes >= expected * MIN_SIZE_RATIO)
    .map((quant) => quant.bytes);
  if (real.length) return Math.min(...real);
  return expected * BF16_SLACK;
}

/** Quant ids that must not ship, with a short reason. Estimated rows are kept. */
export function badQuantIds(quants: QuantSpec[], paramsB: number): Map<string, string> {
  const reasons = new Map<string, string>();
  if (paramsB <= 0) return reasons;
  const ceiling = bf16Ceiling(quants, paramsB);
  const kept: QuantSpec[] = [];
  for (const quant of measured(quants)) {
    const bpw = bpwOf(quant);
    const expected = expectedQuantBytes(paramsB, bpw);
    if (quant.bytes < expected * MIN_SIZE_RATIO) {
      reasons.set(quant.id, "partial");
      continue;
    }
    if (quant.id !== "BF16" && quant.id !== "F16" && quant.bytes > ceiling * BF16_SLACK) {
      reasons.set(quant.id, "larger_than_bf16");
      continue;
    }
    if (quant.bytes > expected * MAX_SIZE_RATIO) {
      reasons.set(quant.id, "too_large");
      continue;
    }
    kept.push(quant);
  }
  const pending = [...kept];
  for (;;) {
    const ordered = pending.filter((quant) => !reasons.has(quant.id)).sort((a, b) => bpwOf(a) - bpwOf(b) || a.bytes - b.bytes);
    let found = false;
    for (let index = 0; index < ordered.length && !found; index += 1) {
      const cur = ordered[index];
      const curBpw = bpwOf(cur);
      const curRatio = cur.bytes / expectedQuantBytes(paramsB, curBpw);
      for (const prev of ordered.slice(0, index)) {
        const prevBpw = bpwOf(prev);
        if (curBpw <= prevBpw || prev.bytes <= 0) continue;
        const bpwRatio = curBpw / prevBpw;
        const sizeRatio = cur.bytes / prev.bytes;
        const prevRatio = prev.bytes / expectedQuantBytes(paramsB, prevBpw);
        // A much higher-bit file that barely grows past a plausible lower one
        // is partial or mislabeled. Vocab-heavy small models are left alone.
        const flat = bpwRatio >= 1.5 && sizeRatio < 1.22 && curRatio < 0.78 && prevRatio >= 0.8 && prevRatio <= 1.35;
        if (flat) {
          reasons.set(cur.id, "not_monotonic");
          found = true;
          break;
        }
        const shrunk = cur.bytes < prev.bytes * MONO_SMALL;
        if (!shrunk) continue;
        if (prevRatio >= MONO_INFLATED && prevRatio > curRatio * 1.25) reasons.set(prev.id, "not_monotonic");
        else if (curRatio <= 0.8) reasons.set(cur.id, "not_monotonic");
        else break;
        found = true;
        break;
      }
    }
    if (!found) break;
  }
  return reasons;
}

export function quantIssues(model: Pick<ModelSpec, "name" | "paramsB" | "quants">): string[] {
  if (model.paramsB <= 0) return [`${model.name}: missing parameter count`];
  return [...badQuantIds(model.quants, model.paramsB).entries()].map(([id, reason]) => `${model.name} ${id}: ${reason}`);
}

/** Drop partial files, double-counted files, and quants larger than BF16. */
export function sanitizeQuants(model: Pick<ModelSpec, "paramsB" | "quants">): QuantSpec[] {
  if (model.paramsB <= 0) return model.quants;
  const blocked = badQuantIds(model.quants, model.paramsB);
  return model.quants
    .filter((quant) => quant.estimated || !blocked.has(quant.id))
    .sort((a, b) => b.quality - a.quality || a.bytes - b.bytes);
}

/** IQ1 / IQ2 and anything under Q2 quality. These load, but they are not a fit we recommend. */
export function isLowBitQuant(quant: Pick<QuantSpec, "id" | "quality"> | null | undefined): boolean {
  if (!quant) return false;
  if (quant.quality < LOW_BIT_QUALITY) return true;
  return /^(UD-)?IQ[12]_/i.test(quant.id);
}
