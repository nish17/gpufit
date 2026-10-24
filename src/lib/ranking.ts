import { isLowBitQuant } from "./estimator/quants";
import type { FitResult, ModelSpec, QuantSpec } from "./estimator/types";

/** Lower bound of the tok/s range that still counts as a practical chat speed. */
export const USABLE_TOK_PER_SEC = 9.5;

export interface RankedRow {
  model: ModelSpec;
  fit: FitResult;
}

export type PickRole = "chat" | "coding" | "reasoning";

export interface ModelPick extends RankedRow {
  role: PickRole;
  roleLabel: string;
}

const ROLE_LABEL: Record<PickRole, string> = {
  chat: "General chat",
  coding: "Coding",
  reasoning: "Reasoning",
};

/** Larger checkpoints rank as more capable. MoE keeps most of its total size so a 30B-A3B beats a 4B dense model. */
export function capability(model: ModelSpec): number {
  if (model.moe && model.activeParamsB && model.activeParamsB > 0) {
    return model.paramsB * 0.7 + model.activeParamsB * 0.3;
  }
  return model.paramsB;
}

export function fitTier(fit: FitResult): number {
  const low = fit.tokPerSec?.[0] ?? 0;
  if (isLowBitQuant(fit.quant)) return 2;
  if (fit.bucket === "full" && low >= USABLE_TOK_PER_SEC) return 0;
  if (fit.bucket === "full") return 1;
  if (fit.bucket === "offload" || fit.bucket === "limit") return 2;
  return 3;
}

/** Full fits at a quant we are willing to recommend. IQ1 and IQ2 stay off this list. */
export function bestList(rows: RankedRow[]): RankedRow[] {
  return rows.filter((row) => row.fit.bucket === "full" && !isLowBitQuant(row.fit.quant)).sort(compareForMachine);
}

export function isRecommendableQuant(quant: Pick<QuantSpec, "id" | "quality"> | null | undefined): boolean {
  return !isLowBitQuant(quant);
}

/** Size, discounted when the quant that fits is well below Q4 quality. */
export function fitScore(row: RankedRow): number {
  const quality = row.fit.quant?.quality ?? 52;
  const factor = Math.min(1.15, Math.max(0.35, quality / 52));
  return capability(row.model) * factor;
}

/**
 * Default "best for this machine" order: capable models that fit fully at a
 * usable speed, then slower full fits, then partial offload, then won't fit.
 * Within a band, larger models at a usable quant come first so a 0.5B model does not lead.
 */
export function compareForMachine(a: RankedRow, b: RankedRow): number {
  const tier = fitTier(a.fit) - fitTier(b.fit);
  if (tier !== 0) return tier;
  const size = fitScore(b) - fitScore(a);
  if (Math.abs(size) > 0.05) return size;
  const speed = (b.fit.tokPerSec?.[1] ?? 0) - (a.fit.tokPerSec?.[1] ?? 0);
  if (Math.abs(speed) > 0.5) return speed;
  return (b.model.downloads ?? 0) - (a.model.downloads ?? 0);
}

function matchesRole(model: ModelSpec, role: PickRole, allowReasoningChat: boolean): boolean {
  if (role === "coding") return model.useCases.includes("coding");
  if (role === "reasoning") return model.useCases.includes("reasoning");
  if (!model.useCases.includes("chat") || model.useCases.includes("coding")) return false;
  if (!allowReasoningChat && model.useCases.includes("reasoning")) return false;
  return true;
}

function findRole(pools: RankedRow[][], role: PickRole, used: Set<string>): RankedRow | undefined {
  const passes = role === "chat" ? [false, true] : [true];
  for (const allowReasoningChat of passes) {
    for (const pool of pools) {
      const found = pool.find((row) => !used.has(row.model.slug) && !isLowBitQuant(row.fit.quant) && matchesRole(row.model, role, allowReasoningChat));
      if (found) return found;
    }
  }
  return undefined;
}

/** One general chat, one coding, and one reasoning model that actually runs on this profile. */
export function bestPicks(rows: RankedRow[]): ModelPick[] {
  const ordered = [...rows].sort(compareForMachine);
  const fast = ordered.filter((row) => fitTier(row.fit) === 0);
  const runnable = ordered.filter((row) => row.fit.bucket !== "no");
  const pools = [fast, runnable];
  const used = new Set<string>();
  const picks: ModelPick[] = [];
  for (const role of ["chat", "coding", "reasoning"] as const) {
    const found = findRole(pools, role, used);
    if (!found) continue;
    used.add(found.model.slug);
    picks.push({ ...found, role, roleLabel: ROLE_LABEL[role] });
  }
  return picks;
}
