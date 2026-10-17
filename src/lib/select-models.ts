import type { ModelSpec } from "./estimator/types";

/**
 * Catalog admission. Mirrors scripts/hf_parse.py (spam_name, keep_model, family_key).
 * Trusted quantizers still publish fine-tunes, so a known model family — or a
 * high download and like count — is required, and spam names are refused.
 */
const SPAM =
  /uncensor|abliterat|obliterat|heretic|darkidol|dolphin|memduet|hemming|thedrummer|cydonia|ornith|laguna|bonsai|inkling|muse glimmer|yue\s?2|jirack|occamy|\bgrug\b|frog\s?nano|\bclef\b|altworld|agentworld|north mini|endless frontier|bigbang|aquila|thomson|hyperclova|cold fusion|defiant|mai gym|jan nano|swift 1\.5/i;

const FAMILY =
  /qwen|llama|gemma|mistral|ministral|devstral|magistral|mixtral|\bphi\b|deepseek|\bglm\b|gpt[ -]?oss|nemotron|lfm|smollm|olmo|granite|apertus|minimax|\bstep\b|mimo|medgemma|hermes|codestral/i;

const TRUSTED = new Set([
  "unsloth",
  "bartowski",
  "lmstudio-community",
  "ggml-org",
  "liquidai",
  "qwen",
  "meta-llama",
  "mistralai",
  "google",
  "microsoft",
  "deepseek-ai",
  "nvidia",
  "huggingface",
  "allenai",
  "ibm-granite",
  "stepfun",
  "zai-org",
]);

const NOISE = /\b(qat|mobile|imatrix|mtp|gguf|hf|i1|reap|exp)\b/gi;
const ROLE_WORDS = /\b(instruct|instruction|chat|base|it)\b/gi;
const DATES = /\b(20\d{2}|2501|2503|2505|2506|2507|2509|2512|2603|0414|0528|0731|128k)\b/gi;

export function isSpamModel(model: Pick<ModelSpec, "name" | "id">): boolean {
  return SPAM.test(`${model.name} ${model.id}`);
}

export function isNotableModel(model: Pick<ModelSpec, "name" | "id" | "author" | "downloads" | "likes">): boolean {
  const blob = `${model.name} ${model.id}`;
  if (SPAM.test(blob)) return false;
  const author = (model.author || model.id.split("/")[0] || "").toLowerCase();
  const downloads = model.downloads ?? 0;
  const likes = model.likes ?? 0;
  const family = FAMILY.test(blob);
  if (family && (TRUSTED.has(author) || (downloads >= 100_000 && likes >= 40))) return true;
  return downloads >= 200_000 && likes >= 100;
}

export function familyKey(model: Pick<ModelSpec, "name" | "paramsB">): string {
  let name = model.name.toLowerCase();
  name = name.replace(NOISE, " ").replace(ROLE_WORDS, " ").replace(DATES, " ");
  // "Mistral Small 3.2 24B" and "Mistral Small 24B" are one checkpoint family.
  // "Qwen3.8 27B" keeps its generation because the version is glued to the family name.
  name = name.replace(/\b\d+\.\d+\b/g, " ");
  name = name.replace(/\b\d+(?:\.\d+)?b\b/g, " ");
  name = name.replace(/(?<![\w.])\d+(?![\w.])/g, " ");
  name = name.replace(/[^a-z0-9.]+/g, " ").replace(/\s+/g, " ").trim();
  const raw = model.name.toLowerCase();
  let role = "chat";
  if (/coder|\bcode\b|devstral|codestral/.test(raw)) role = "coding";
  else if (/vision|\bvl\b|omni/.test(raw)) role = "vision";
  else if (/reason|thinking|\br1\b|qwq/.test(raw)) role = "reasoning";
  const size = model.paramsB ? Math.round(model.paramsB) : 0;
  return `${name}|${size}|${role}`;
}

function variantPenalty(name: string): number {
  return /\bqat\b|\bmobile\b/i.test(name) ? 1 : 0;
}

function prefer(current: ModelSpec, candidate: ModelSpec): ModelSpec {
  const currentPenalty = variantPenalty(current.name);
  const candidatePenalty = variantPenalty(candidate.name);
  if (currentPenalty !== candidatePenalty) {
    const plain = currentPenalty < candidatePenalty ? current : candidate;
    const variant = currentPenalty < candidatePenalty ? candidate : current;
    if ((plain.downloads ?? 0) >= (variant.downloads ?? 0) * 0.5) return plain;
  }
  const downloads = (candidate.downloads ?? 0) - (current.downloads ?? 0);
  if (downloads !== 0) return downloads > 0 ? candidate : current;
  return (candidate.likes ?? 0) > (current.likes ?? 0) ? candidate : current;
}

/** Drop spam and near-duplicate quants or finetunes of the same checkpoint. */
export function selectCatalog(rows: ModelSpec[]): ModelSpec[] {
  const best = new Map<string, ModelSpec>();
  for (const model of rows) {
    if (!isNotableModel(model)) continue;
    const key = familyKey(model);
    const current = best.get(key);
    best.set(key, current ? prefer(current, model) : model);
  }
  return [...best.values()].sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0) || (b.likes ?? 0) - (a.likes ?? 0));
}
