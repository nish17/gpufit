"""Parse Hugging Face configs and GGUF filenames into GPUfit catalog records.

Weight bits-per-value live in src/data/quant-meta.json so the Python fetcher
and the TypeScript estimator share one table.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QUANT_META: dict[str, dict[str, float]] = json.loads(
    (ROOT / "src" / "data" / "quant-meta.json").read_text()
)
QUANT_IDS_BY_LEN = sorted(QUANT_META.keys(), key=len, reverse=True)

SKIP_NAME_BITS = (
    "whisper",
    "embedding",
    "-embed",
    "embed-",
    "rerank",
    "bge-",
    "bge_",
    "tts",
    "text-to-speech",
    "flux",
    "sdxl",
    "stable-diffusion",
    "controlnet",
    "mmproj",
    "nomic-embed",
    "jina-embed",
    "colbert",
    "musicgen",
    "encodec",
    "audiogen",
    "speecht5",
    "wav2vec",
    "clip-vit",
    "locate-anything",
    "ace-step",
    "diffusion",
    "ocr",
)

DENY_ARCHITECTURES = {"clip", "diffusion-gemma", "locateanything", "acestep-lm"}

SKIP_PIPELINES = {
    "text-to-image",
    "text-to-speech",
    "automatic-speech-recognition",
    "text-to-audio",
    "image-to-image",
    "feature-extraction",
    "text-to-video",
    "image-to-text",
}


# Keep in sync with src/lib/select-models.ts.
SPAM_NAME = re.compile(
    r"uncensor|abliterat|obliterat|heretic|darkidol|dolphin|memduet|hemming|thedrummer|"
    r"cydonia|ornith|laguna|bonsai|inkling|muse glimmer|yue\s?2|jirack|occamy|\bgrug\b|"
    r"frog\s?nano|\bclef\b|altworld|agentworld|north mini|endless frontier|bigbang|"
    r"aquila|thomson|hyperclova|cold fusion|defiant|mai gym|jan nano|swift 1\.5",
    re.IGNORECASE,
)
FAMILY_NAME = re.compile(
    r"qwen|llama|gemma|mistral|ministral|devstral|magistral|mixtral|\bphi\b|deepseek|"
    r"\bglm\b|gpt[ -]?oss|nemotron|lfm|smollm|olmo|granite|apertus|minimax|\bstep\b|"
    r"mimo|medgemma|hermes|codestral",
    re.IGNORECASE,
)
TRUSTED_AUTHORS = {
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
}
_NOISE = re.compile(r"\b(qat|mobile|imatrix|mtp|gguf|hf|i1|reap|exp)\b", re.IGNORECASE)
_ROLE_WORDS = re.compile(r"\b(instruct|instruction|chat|base|it)\b", re.IGNORECASE)
_DATES = re.compile(r"\b(20\d{2}|2501|2503|2505|2506|2507|2509|2512|2603|0414|0528|0731|128k)\b", re.IGNORECASE)


def should_skip_repo(repo_id: str, pipeline: str | None) -> bool:
    name = repo_id.lower().split("/")[-1]
    if any(bit in name for bit in SKIP_NAME_BITS):
        return True
    if SPAM_NAME.search(name):
        return True
    if pipeline in SKIP_PIPELINES:
        return True
    return False


def keep_model(record: dict) -> bool:
    """True for official-family checkpoints and notable community uploads."""
    blob = f"{record.get('name', '')} {record.get('id', '')}"
    if SPAM_NAME.search(blob):
        return False
    author = str(record.get("author") or str(record.get("id") or "").split("/")[0]).lower()
    downloads = int(record.get("downloads") or 0)
    likes = int(record.get("likes") or 0)
    family = FAMILY_NAME.search(blob) is not None
    if family and (author in TRUSTED_AUTHORS or (downloads >= 100_000 and likes >= 40)):
        return True
    return downloads >= 200_000 and likes >= 100


def family_key(name: str, params_b: float | None = None) -> str:
    cleaned = _NOISE.sub(" ", name.lower())
    cleaned = _ROLE_WORDS.sub(" ", cleaned)
    cleaned = _DATES.sub(" ", cleaned)
    # "Mistral Small 3.2 24B" matches "Mistral Small 24B". "Qwen3.8" stays intact.
    cleaned = re.sub(r"\b\d+\.\d+\b", " ", cleaned)
    cleaned = re.sub(r"\b\d+(?:\.\d+)?b\b", " ", cleaned)
    cleaned = re.sub(r"(?<![\w.])\d+(?![\w.])", " ", cleaned)
    cleaned = re.sub(r"[^a-z0-9.]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    raw = name.lower()
    if re.search(r"coder|\bcode\b|devstral|codestral", raw):
        role = "coding"
    elif re.search(r"vision|\bvl\b|omni", raw):
        role = "vision"
    elif re.search(r"reason|thinking|\br1\b|qwq", raw):
        role = "reasoning"
    else:
        role = "chat"
    size = int(round(params_b)) if params_b else 0
    return f"{cleaned}|{size}|{role}"


def _variant_penalty(name: str) -> int:
    return 1 if re.search(r"\bqat\b|\bmobile\b", name, re.IGNORECASE) else 0


def _prefer_record(current: dict, candidate: dict) -> dict:
    current_penalty = _variant_penalty(str(current.get("name") or ""))
    candidate_penalty = _variant_penalty(str(candidate.get("name") or ""))
    if current_penalty != candidate_penalty:
        plain, variant = (current, candidate) if current_penalty < candidate_penalty else (candidate, current)
        if int(plain.get("downloads") or 0) >= int(variant.get("downloads") or 0) * 0.5:
            return plain
    if int(candidate.get("downloads") or 0) != int(current.get("downloads") or 0):
        return candidate if int(candidate.get("downloads") or 0) > int(current.get("downloads") or 0) else current
    if int(candidate.get("likes") or 0) > int(current.get("likes") or 0):
        return candidate
    return current


def dedupe_catalog(rows: list[dict]) -> list[dict]:
    best: dict[str, dict] = {}
    for row in rows:
        if not keep_model(row):
            continue
        key = family_key(str(row.get("name") or ""), float(row.get("paramsB") or 0) or None)
        current = best.get(key)
        best[key] = row if current is None else _prefer_record(current, row)
    chosen = list(best.values())
    chosen.sort(key=lambda item: (int(item.get("downloads") or 0), int(item.get("likes") or 0)), reverse=True)
    return chosen


def unwrap_config(cfg: object) -> dict | None:
    if not isinstance(cfg, dict):
        return None
    if "num_hidden_layers" in cfg or "n_layer" in cfg:
        return cfg
    for key in ("text_config", "llm_config", "language_config", "text_model", "decoder"):
        inner = cfg.get(key)
        found = unwrap_config(inner)
        if found:
            return found
    return None


def _as_int(value: object, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def parse_architecture(raw: object) -> dict | None:
    """Return an architecture record, or None when the config is not a text model."""
    if not isinstance(raw, dict):
        return None
    vision = isinstance(raw.get("vision_config"), dict)
    cfg = unwrap_config(raw)
    if not cfg:
        return None

    layers = _as_int(cfg.get("num_hidden_layers", cfg.get("n_layer")))
    heads = _as_int(cfg.get("num_attention_heads", cfg.get("n_head")))
    if layers <= 0 or heads <= 0:
        return None
    kv_heads = _as_int(cfg.get("num_key_value_heads", cfg.get("num_kv_heads")), heads) or heads
    hidden = _as_int(cfg.get("hidden_size", cfg.get("n_embd")))
    head_dim = _as_int(cfg.get("head_dim") or cfg.get("attention_head_dim"))
    if head_dim <= 0 and hidden > 0 and heads > 0:
        head_dim = hidden // heads
    if head_dim <= 0:
        head_dim = 128

    max_pos = _as_int(cfg.get("max_position_embeddings", cfg.get("max_sequence_length")))
    sliding_window = cfg.get("sliding_window", cfg.get("attention_window_size"))
    sliding_window = _as_int(sliding_window) if sliding_window else 0
    if sliding_window and max_pos and sliding_window >= int(max_pos * 0.9):
        sliding_window = 0

    layer_types = cfg.get("layer_types") or []
    full = sliding = linear = 0
    if isinstance(layer_types, list) and len(layer_types) == layers:
        for kind in layer_types:
            text = str(kind).lower()
            if any(token in text for token in ("linear", "mamba", "ssm", "recurrent")):
                linear += 1
            elif "slid" in text or "local" in text:
                sliding += 1
            else:
                full += 1
    else:
        pattern = _as_int(cfg.get("sliding_window_pattern"))
        model_type = str(cfg.get("model_type") or "")
        if sliding_window and pattern > 1:
            full = max(1, round(layers / pattern))
            sliding = layers - full
        elif sliding_window and model_type.startswith("gemma2"):
            full = layers // 2
            sliding = layers - full
        else:
            full = layers
            if sliding_window and model_type.startswith("gemma"):
                full = max(1, layers // 6)
                sliding = layers - full

    kv_lora = _as_int(cfg.get("kv_lora_rank"))
    mla_per_layer = None
    if kv_lora > 0:
        rope = _as_int(cfg.get("qk_rope_head_dim"))
        mla_per_layer = (kv_lora + rope) * 2
        if full + sliding + linear == 0:
            full = layers

    linear_state = 0
    linear_state_approximate = False
    if linear:
        v_heads = _as_int(cfg.get("linear_num_value_heads"), kv_heads) or kv_heads
        v_dim = _as_int(cfg.get("linear_value_head_dim"), head_dim) or head_dim
        k_dim = _as_int(cfg.get("linear_key_head_dim"), head_dim) or head_dim
        if cfg.get("linear_num_value_heads") or cfg.get("linear_value_head_dim"):
            linear_state = linear * v_heads * v_dim * k_dim * 2
        else:
            linear_state = linear * 2 * 1024 * 1024
            linear_state_approximate = True

    if mla_per_layer:
        attention = "mla"
    elif linear and full == 0 and sliding == 0:
        attention = "mamba"
    elif linear or (sliding and full):
        attention = "hybrid"
    elif sliding and full == 0:
        attention = "sliding"
    else:
        attention = "gqa"

    experts = _as_int(
        cfg.get("num_experts")
        or cfg.get("num_local_experts")
        or cfg.get("n_routed_experts")
        or cfg.get("moe_num_experts")
    )
    experts_per = _as_int(
        cfg.get("num_experts_per_tok")
        or cfg.get("num_experts_per_token")
        or cfg.get("n_activated_experts")
        or cfg.get("moe_top_k")
    )
    if experts <= 1:
        experts = 0
        experts_per = 0

    return {
        "layers": layers,
        "kvHeads": kv_heads,
        "headDim": head_dim,
        "fullAttentionLayers": full,
        "slidingLayers": sliding,
        "slidingWindow": sliding_window or None,
        "linearLayers": linear,
        "linearStateBytes": linear_state,
        "linearStateApproximate": linear_state_approximate,
        "attention": attention,
        "mlaBytesPerLayer": mla_per_layer,
        "experts": experts or None,
        "expertsPerTok": experts_per or None,
        "vision": vision,
        "maxPositionEmbeddings": max_pos or None,
        "modelType": cfg.get("model_type"),
    }


def quant_id_from_path(path: str) -> str | None:
    lowered = path.lower()
    if any(bit in lowered for bit in ("mmproj", "imatrix", "/mtp", "mtp-", "mtp/")):
        return None
    upper = path.upper()
    for qid in QUANT_IDS_BY_LEN:
        if qid in upper:
            return qid
    return None


# `model-00001-of-00005.gguf`. Incomplete sets are dropped, not summed.
_SHARD_PART = re.compile(r"(?P<index>\d+)\s*[-_ ]of[-_ ]\s*(?P<count>\d+)", re.IGNORECASE)
_PARTIAL_PATH = re.compile(r"partial|incomplete|\.tmp|/\.cache", re.IGNORECASE)

# Keep in sync with src/lib/estimator/quants.ts.
MIN_SIZE_RATIO = 0.45
# Backstop when a file is many times the parameter estimate. Real Q2/Q3
# files run large because the table ignores vocab bytes; 3.5× is not that.
MAX_SIZE_RATIO = 3.5
BF16_SLACK = 1.05
# A higher-bpw file this much smaller than a lower-bpw file needs a second look.
MONO_SMALL = 0.72
# The lower-bpw file is the bad one when it is this far above its own estimate.
MONO_INFLATED = 1.45


def _expected_bytes(params_b: float, bpw: float) -> float:
    return params_b * 1_000_000_000 * bpw / 8


def _shard_family(path: str) -> tuple[str, int, int] | None:
    match = _SHARD_PART.search(path)
    if not match:
        return None
    index, count = int(match.group("index")), int(match.group("count"))
    if count < 2 or not 1 <= index <= count:
        return None
    base = _SHARD_PART.sub("SHARD", path, count=1)
    return base, index, count


def _candidate_sizes(group: list[dict]) -> list[int]:
    """One size per complete file. Shards count only when every part is present.

    Unrelated files that share a quant name are not added together. That sum
    is how a Q6_K row grew larger than the model's own BF16.
    """
    loose: list[int] = []
    families: dict[str, dict] = {}
    for item in group:
        path = str(item.get("path") or "")
        info = _shard_family(path)
        if info is None:
            loose.append(int(item["size"]))
            continue
        base, index, count = info
        family = families.setdefault(base, {"count": count, "parts": {}})
        if family["count"] != count:
            continue
        family["parts"][index] = int(item["size"])
    sizes = list(loose)
    for family in families.values():
        count = family["count"]
        parts: dict[int, int] = family["parts"]
        if len(parts) == count and set(parts) == set(range(1, count + 1)):
            sizes.append(sum(parts.values()))
    return sizes


def _pick_size(sizes: list[int], qid: str, params_b: float | None) -> int | None:
    if not sizes:
        return None
    if not params_b or params_b <= 0:
        return max(sizes)
    expected = _expected_bytes(params_b, QUANT_META[qid]["bpw"])
    plausible = [size for size in sizes if expected * MIN_SIZE_RATIO <= size <= expected * MAX_SIZE_RATIO]
    if not plausible:
        return None
    return min(plausible, key=lambda size: abs(size - expected))


def _bf16_ceiling(quants: list[dict], params_b: float) -> float:
    expected = _expected_bytes(params_b, 16.0)
    real = [
        int(quant["bytes"])
        for quant in quants
        if quant.get("id") in ("BF16", "F16") and not quant.get("estimated") and int(quant.get("bytes") or 0) >= expected * MIN_SIZE_RATIO
    ]
    if real:
        return float(min(real))
    return expected * BF16_SLACK


def _measured(quants: list[dict]) -> list[dict]:
    return [quant for quant in quants if not quant.get("estimated") and quant.get("id") in QUANT_META]


def bad_quant_ids(quants: list[dict], params_b: float) -> dict[str, str]:
    """Map quant id → why it cannot ship. Estimated rows are never included."""
    reasons: dict[str, str] = {}
    if params_b <= 0:
        return reasons
    ceiling = _bf16_ceiling(quants, params_b)
    kept: list[dict] = []
    for quant in _measured(quants):
        qid = str(quant["id"])
        bpw = float(quant.get("bpw") or QUANT_META[qid]["bpw"])
        size = int(quant.get("bytes") or 0)
        expected = _expected_bytes(params_b, bpw)
        if size < expected * MIN_SIZE_RATIO:
            reasons[qid] = "partial"
            continue
        if qid not in ("BF16", "F16") and size > ceiling * BF16_SLACK:
            reasons[qid] = "larger_than_bf16"
            continue
        if size > expected * MAX_SIZE_RATIO:
            reasons[qid] = "too_large"
            continue
        kept.append(quant)
    # An inflated low-bit file (a summed Q2) makes every better quant look
    # "smaller". Drop the row that disagrees with params×bpw, then look again.
    pending = list(kept)
    while True:
        ordered = sorted(
            [quant for quant in pending if str(quant["id"]) not in reasons],
            key=lambda quant: (float(quant.get("bpw") or QUANT_META[quant["id"]]["bpw"]), int(quant["bytes"])),
        )
        found = False
        for index, cur in enumerate(ordered):
            cur_id = str(cur["id"])
            cur_bpw = float(cur.get("bpw") or QUANT_META[cur_id]["bpw"])
            cur_size = int(cur["bytes"])
            cur_ratio = cur_size / _expected_bytes(params_b, cur_bpw)
            for prev in ordered[:index]:
                prev_id = str(prev["id"])
                prev_bpw = float(prev.get("bpw") or QUANT_META[prev_id]["bpw"])
                if cur_bpw <= prev_bpw:
                    continue
                prev_size = int(prev["bytes"])
                if prev_size <= 0:
                    continue
                bpw_ratio = cur_bpw / prev_bpw
                size_ratio = cur_size / prev_size
                prev_ratio = prev_size / _expected_bytes(params_b, prev_bpw)
                # A much higher-bit file that barely grows past a plausible lower
                # one is partial or mislabeled (a Q8 sitting on a Q4). Vocab-heavy
                # small models stay: their low quants run large, and real Q8s grow.
                flat = (
                    bpw_ratio >= 1.5
                    and size_ratio < 1.22
                    and cur_ratio < 0.78
                    and 0.80 <= prev_ratio <= 1.35
                )
                if flat:
                    reasons[cur_id] = "not_monotonic"
                    found = True
                    break
                shrunk = cur_size < prev_size * MONO_SMALL
                if not shrunk:
                    continue
                if prev_ratio >= MONO_INFLATED and prev_ratio > cur_ratio * 1.25:
                    reasons[prev_id] = "not_monotonic"
                elif cur_ratio <= 0.8:
                    reasons[cur_id] = "not_monotonic"
                else:
                    break
                found = True
                break
            if found:
                break
        if not found:
            break
    return reasons


def quant_issues(record: dict) -> list[str]:
    """Reasons a catalog row violates the GGUF size rules. Empty means it can ship."""
    params_b = float(record.get("paramsB") or 0)
    name = str(record.get("name") or record.get("id") or "model")
    quants = [quant for quant in record.get("quants") or [] if isinstance(quant, dict)]
    if params_b <= 0:
        return [f"{name}: missing parameter count"]
    return [f"{name} {qid}: {reason}" for qid, reason in bad_quant_ids(quants, params_b).items()]


def sanitize_quants(quants: list[dict], params_b: float) -> list[dict]:
    """Drop partial, summed, and over-BF16 rows. Estimated sizes are kept."""
    if params_b <= 0:
        return quants
    blocked = bad_quant_ids(quants, params_b)
    kept = [quant for quant in quants if quant.get("estimated") or quant.get("id") not in blocked]
    kept.sort(key=lambda quant: (-float(quant.get("quality") or 0), int(quant.get("bytes") or 0)))
    return kept


def aggregate_quant_files(files: list[dict], params_b: float | None = None) -> list[dict]:
    groups: dict[str, list[dict]] = {}
    for item in files:
        path = str(item.get("path") or "")
        size = int(item.get("size") or 0)
        if size < 100_000 or _PARTIAL_PATH.search(path):
            continue
        qid = quant_id_from_path(path)
        if not qid:
            continue
        groups.setdefault(qid, []).append(item)

    quants = []
    for qid, group in groups.items():
        chosen = _pick_size(_candidate_sizes(group), qid, params_b)
        if chosen is None:
            continue
        meta = QUANT_META[qid]
        quants.append(
            {
                "id": qid,
                "bytes": chosen,
                "estimated": False,
                "quality": meta["quality"],
                "bpw": meta["bpw"],
            }
        )
    if params_b and params_b > 0:
        quants = sanitize_quants(quants, params_b)
    else:
        quants.sort(key=lambda quant: (-quant["quality"], quant["bytes"]))
    return quants


def estimated_quants(params_b: float) -> list[dict]:
    """Fallback sizes when a repo has no GGUF files yet. Flagged estimated."""
    if params_b <= 0:
        return []
    wanted = ["Q8_0", "Q6_K", "Q5_K_M", "Q4_K_M", "Q3_K_M", "Q2_K"]
    out = []
    params = params_b * 1_000_000_000
    for qid in wanted:
        meta = QUANT_META[qid]
        out.append(
            {
                "id": qid,
                "bytes": int(params * meta["bpw"] / 8),
                "estimated": True,
                "quality": meta["quality"],
                "bpw": meta["bpw"],
            }
        )
    return out


_ACTIVE = re.compile(r"(\d+(?:\.\d+)?)B[-_]?A(\d+(?:\.\d+)?)B", re.IGNORECASE)

# Official activated-parameter counts, checked before the expert-ratio estimate.
# Each row is (name pattern, minimum total, maximum total, active billions).
# Ranges keep a 7B distill from inheriting the 671B model's figure.
_PUBLISHED_ACTIVE: tuple[tuple[re.Pattern[str], float, float, float], ...] = (
    (re.compile(r"deepseek.*(?:\br1\b|\bv3(?:[.\s]|$|\d))", re.IGNORECASE), 600, 720, 37),
    (re.compile(r"deepseek.*v4\.1.*flash", re.IGNORECASE), 500, 900, 16),
    (re.compile(r"deepseek.*v4(?!\.1).*flash", re.IGNORECASE), 200, 450, 13),
    (re.compile(r"llama 4 scout", re.IGNORECASE), 80, 150, 17),
    (re.compile(r"llama 4 maverick", re.IGNORECASE), 300, 480, 17),
    (re.compile(r"gpt[- ]?oss[- ]?20", re.IGNORECASE), 15, 30, 3.6),
    (re.compile(r"gpt[- ]?oss[- ]?120", re.IGNORECASE), 90, 150, 5.1),
    (re.compile(r"glm 4\.7 flash", re.IGNORECASE), 20, 45, 3),
    (re.compile(r"glm 4\.5 air|glm 4\.6v", re.IGNORECASE), 80, 150, 12),
    (re.compile(r"glm 4\.[567](?!\s*flash)", re.IGNORECASE), 280, 420, 32),
    (re.compile(r"glm 5\.3 flash", re.IGNORECASE), 250, 400, 18),
    (re.compile(r"glm 5\.3(?!\s*flash)", re.IGNORECASE), 650, 850, 40),
    (re.compile(r"minimax[- ]?m2", re.IGNORECASE), 180, 280, 10),
    (re.compile(r"mimo[- ]?v2 flash", re.IGNORECASE), 250, 380, 15),
    (re.compile(r"mistral small 4", re.IGNORECASE), 90, 150, 6.5),
    (re.compile(r"kat[- ]?coder", re.IGNORECASE), 25, 50, 3),
    (re.compile(r"qwen3\.8 flash next", re.IGNORECASE), 140, 220, 6),
)

# Share of the expanded total that stays on for attention, embeddings, and a shared expert.
# 15% of the expanded file counted DeepSeek-V3 as ~122B active. 2.4% plus the routed
# experts is 37B, which is the published figure (8 of 256 experts on a 671B model).
MOE_DENSE_SHARE = 0.024


def _published_active(name: str, params_b: float) -> float | None:
    for pattern, low, high, active in _PUBLISHED_ACTIVE:
        if low <= params_b <= high and pattern.search(name):
            return active
    return None


def guess_active_params(name: str, params_b: float, arch: dict) -> tuple[float | None, bool]:
    match = _ACTIVE.search(name.replace(" ", ""))
    if match:
        return float(match.group(2)), False
    published = _published_active(name, params_b)
    if published is not None:
        return published, False
    experts = arch.get("experts") or 0
    per = arch.get("expertsPerTok") or 0
    if experts > 1 and per > 0 and params_b > 0:
        ratio = per / experts
        return round(params_b * min(0.9, ratio + MOE_DENSE_SHARE), 3), True
    return None, False


def pretty_name(repo_id: str) -> str:
    name = repo_id.split("/")[-1]
    name = re.sub(r"-gguf$", "", name, flags=re.IGNORECASE)
    name = name.replace("-", " ").replace("_", " ")
    name = re.sub(r"\s+", " ", name).strip()
    return name


def slugify(repo_id: str) -> str:
    name = repo_id.split("/")[-1]
    name = re.sub(r"-gguf$", "", name, flags=re.IGNORECASE)
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower()
    return slug[:90] or "model"


def use_cases(name: str, vision: bool, params_b: float) -> list[str]:
    lowered = name.lower()
    tags: list[str] = []
    if any(bit in lowered for bit in ("code", "coder", "devstral", "starcoder", "codestral")):
        tags.append("coding")
    if any(bit in lowered for bit in ("reason", "-r1", "r1-", "qwq", "thinking")):
        tags.append("reasoning")
    if vision or any(bit in lowered for bit in ("vision", "-vl", "vl-", "omni")):
        tags.append("vision")
    if params_b <= 4:
        tags.append("small")
    if "coding" not in tags and "chat" not in tags:
        tags.append("chat")
    return tags


def base_model_ids(card: object, repo_id: str) -> list[str]:
    if not isinstance(card, dict):
        return []
    raw = card.get("base_model") or card.get("base_models")
    found: list[str] = []

    def push(value: object) -> None:
        if isinstance(value, str) and "/" in value and not value.lower().endswith("-gguf"):
            found.append(value)
        elif isinstance(value, list):
            for item in value:
                push(item)
        elif isinstance(value, dict):
            for item in value.values():
                push(item)

    push(raw)
    # Keep order, drop the quant repo itself.
    out = []
    for item in found:
        if item == repo_id or item in out:
            continue
        out.append(item)
    return out


def describe(name: str, params_b: float, arch_name: str, org: str, context: int | None, license_id: str | None, active: float | None, moe: bool) -> str:
    size = f"{params_b:.1f}B" if params_b >= 10 else f"{params_b:.2f}B"
    kind = "mixture-of-experts" if moe else "dense"
    sentence = f"{name} is a {size} {kind} {arch_name} model from {org}"
    if moe and active:
        sentence += f", with about {active:.1f}B parameters active per token"
    sentence += "."
    bits = [sentence]
    if context:
        bits.append(f"Configured context length is {context:,} tokens.")
    if license_id:
        bits.append(f"License: {license_id}.")
    bits.append("Quant sizes are the GGUF file bytes published on Hugging Face when a file exists.")
    return " ".join(bits)
