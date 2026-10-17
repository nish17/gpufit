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


def should_skip_repo(repo_id: str, pipeline: str | None) -> bool:
    name = repo_id.lower().split("/")[-1]
    if any(bit in name for bit in SKIP_NAME_BITS):
        return True
    if pipeline in SKIP_PIPELINES:
        return True
    return False


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


_SHARD = re.compile(r"of[-_]0*\d+", re.IGNORECASE)


def aggregate_quant_files(files: list[dict]) -> list[dict]:
    groups: dict[str, list[dict]] = {}
    for item in files:
        path = str(item.get("path") or "")
        size = int(item.get("size") or 0)
        if size < 100_000:
            continue
        qid = quant_id_from_path(path)
        if not qid:
            continue
        groups.setdefault(qid, []).append(item)

    quants = []
    for qid, group in groups.items():
        shards = [item for item in group if _SHARD.search(str(item.get("path")))]
        chosen = shards or group
        total = sum(int(item["size"]) for item in chosen)
        meta = QUANT_META[qid]
        quants.append(
            {
                "id": qid,
                "bytes": total,
                "estimated": False,
                "quality": meta["quality"],
                "bpw": meta["bpw"],
            }
        )
    quants.sort(key=lambda q: (-q["quality"], q["bytes"]))
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


def guess_active_params(name: str, params_b: float, arch: dict) -> tuple[float | None, bool]:
    match = _ACTIVE.search(name.replace(" ", ""))
    if match:
        return float(match.group(2)), False
    experts = arch.get("experts") or 0
    per = arch.get("expertsPerTok") or 0
    if experts > 1 and per > 0 and params_b > 0:
        ratio = per / experts
        return round(params_b * min(0.9, ratio + 0.15), 3), True
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
