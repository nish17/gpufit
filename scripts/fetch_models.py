#!/usr/bin/env python3
"""Pull a GPUfit model catalog from the public Hugging Face Hub API.

Works without a token. Set HF_TOKEN to raise rate limits. Writes
src/data/models.json and src/data/fetch-report.json. Existing firstSeen
timestamps are preserved so a later run can tell new base models from old ones.
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hf_parse import (  # noqa: E402
    DENY_ARCHITECTURES,
    aggregate_quant_files,
    base_model_ids,
    describe,
    estimated_quants,
    guess_active_params,
    parse_architecture,
    pretty_name,
    should_skip_repo,
    slugify,
    use_cases,
)

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"
CACHE = ROOT / ".cache" / "hf"
MODELS_PATH = DATA / "models.json"
REPORT_PATH = DATA / "fetch-report.json"

TARGET = int(os.environ.get("MAX_MODELS", "210"))
MAX_ATTEMPTS = int(os.environ.get("MAX_ATTEMPTS", "380"))
UA = "GPUfit/1.0 (catalog builder; +https://gpufit.dev)"
_CACHE_LOCK = threading.Lock()

AUTHOR_PRIORITY = {
    "unsloth": 5,
    "bartowski": 4,
    "lmstudio-community": 3,
    "ggml-org": 3,
    "mradermacher": 1,
}

TRUSTED_AUTHORS = set(AUTHOR_PRIORITY) | {
    "qwen",
    "meta-llama",
    "mistralai",
    "google",
    "microsoft",
    "deepseek-ai",
    "nvidia",
    "huggingface",
}


def _headers() -> dict[str, str]:
    headers = {"User-Agent": UA, "Accept": "application/json"}
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def get_json(url: str, retries: int = 4) -> tuple[object, dict[str, str]]:
    CACHE.mkdir(parents=True, exist_ok=True)
    key = urllib.parse.quote(url, safe="")[:180]
    cache_path = CACHE / f"{key}.json"
    if cache_path.exists() and os.environ.get("HF_REFRESH") != "1":
        payload = json.loads(cache_path.read_text())
        return payload["body"], payload.get("headers") or {}

    last_error: Exception | None = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers=_headers())
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                raw = response.read()
                headers = {k.lower(): v for k, v in response.headers.items()}
                body = json.loads(raw.decode("utf-8"))
                with _CACHE_LOCK:
                    cache_path.write_text(json.dumps({"body": body, "headers": headers}))
                return body, headers
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code == 404:
                raise
            wait = 2 ** attempt
            if exc.code == 429:
                wait = max(wait, int(exc.headers.get("Retry-After") or 5))
            time.sleep(wait)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"GET failed {url}: {last_error}")


def next_link(headers: dict[str, str]) -> str | None:
    link = headers.get("link") or ""
    match = re.search(r'<([^>]+)>;\s*rel="next"', link)
    return match.group(1) if match else None


def list_models(params: dict[str, str], pages: int = 1) -> list[dict]:
    query = urllib.parse.urlencode(params)
    url = f"https://huggingface.co/api/models?{query}"
    found: list[dict] = []
    for _ in range(pages):
        body, headers = get_json(url)
        if not isinstance(body, list):
            break
        found.extend(item for item in body if isinstance(item, dict))
        url = next_link(headers) or ""
        if not url:
            break
        time.sleep(0.15)
    return found


def collect_candidates() -> list[dict]:
    queries = [
        ({"filter": "gguf", "sort": "downloads", "direction": "-1", "limit": "100"}, 3),
        ({"author": "unsloth", "filter": "gguf", "sort": "downloads", "direction": "-1", "limit": "100"}, 2),
        ({"author": "bartowski", "filter": "gguf", "sort": "downloads", "direction": "-1", "limit": "80"}, 1),
        ({"author": "lmstudio-community", "filter": "gguf", "sort": "downloads", "direction": "-1", "limit": "50"}, 1),
        ({"filter": "gguf", "sort": "createdAt", "direction": "-1", "limit": "100"}, 1),
        ({"filter": "gguf", "sort": "likes", "direction": "-1", "limit": "50"}, 1),
        ({"filter": "gguf", "sort": "trendingScore", "direction": "-1", "limit": "50", "pipeline_tag": "text-generation"}, 1),
    ]
    by_id: dict[str, dict] = {}
    for params, pages in queries:
        try:
            rows = list_models(params, pages=pages)
        except Exception as exc:  # noqa: BLE001
            print(f"list failed {params}: {exc}", file=sys.stderr)
            continue
        print(f"listed {len(rows)} for {params.get('author') or params.get('sort')}")
        for row in rows:
            repo_id = row.get("id")
            if not isinstance(repo_id, str):
                continue
            current = by_id.get(repo_id)
            if current is None or (row.get("downloads") or 0) > (current.get("downloads") or 0):
                by_id[repo_id] = row
    return list(by_id.values())


def author_of(repo_id: str) -> str:
    return repo_id.split("/")[0].lower()


def candidate_score(row: dict) -> int:
    repo_id = row["id"]
    downloads = int(row.get("downloads") or 0)
    priority = AUTHOR_PRIORITY.get(author_of(repo_id), 0)
    created = str(row.get("createdAt") or "")
    recent_boost = 50_000_000 if created >= "2026-09-01" and author_of(repo_id) in TRUSTED_AUTHORS else 0
    return priority * 1_000_000_000 + recent_boost + downloads


def list_tree(repo_id: str, path: str = "") -> list[dict]:
    url = f"https://huggingface.co/api/models/{repo_id}/tree/main"
    if path:
        url += "/" + urllib.parse.quote(path)
    files: list[dict] = []
    while url:
        body, headers = get_json(url)
        if not isinstance(body, list):
            break
        files.extend(item for item in body if isinstance(item, dict))
        url = next_link(headers) or ""
    return files


def collect_files(repo_id: str) -> list[dict]:
    root = list_tree(repo_id)
    files = [item for item in root if item.get("type") == "file"]
    for item in root:
        if item.get("type") != "directory":
            continue
        name = str(item.get("path") or "").split("/")[-1]
        upper = name.upper()
        if name.lower() in {"mtp", "mmproj"} or "MMPROJ" in upper:
            continue
        interesting = any(token in upper for token in ("Q", "IQ", "F16", "BF16", "UD-"))
        if not interesting:
            continue
        try:
            nested = list_tree(repo_id, str(item.get("path")))
        except Exception:  # noqa: BLE001
            continue
        files.extend(entry for entry in nested if entry.get("type") == "file")
    return files


def load_config(repo_ids: list[str]) -> tuple[dict | None, str | None]:
    for repo_id in repo_ids:
        url = f"https://huggingface.co/{repo_id}/resolve/main/config.json"
        try:
            body, _headers = get_json(url)
        except Exception:  # noqa: BLE001
            continue
        if isinstance(body, dict):
            return body, repo_id
    return None, None


def fetch_ollama_names() -> set[str]:
    req = urllib.request.Request("https://ollama.com/library", headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            html = response.read().decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        print(f"ollama library fetch failed (continuing): {exc}", file=sys.stderr)
        return set()
    names = {match.lower() for match in re.findall(r'href="/library/([a-zA-Z0-9_.:-]+)"', html)}
    print(f"ollama library names: {len(names)}")
    return names


def ollama_library(name: str, repo_id: str, libraries: set[str]) -> str | None:
    candidates = []
    family = repo_id.split("/")[-1].lower()
    family = re.sub(r"-gguf$", "", family)
    family = re.sub(r"-(instruct|chat|it)$", "", family)
    compact = re.sub(r"[^a-z0-9.]+", "", name.lower())
    candidates.append(family)
    candidates.append(compact)
    # "Qwen3.8 27B" -> qwen3.8
    head = re.split(r"[-_\s]", family)[0]
    candidates.append(head)
    for candidate in candidates:
        if candidate and candidate in libraries:
            return candidate
    return None


def load_previous() -> dict[str, dict]:
    if not MODELS_PATH.exists():
        return {}
    try:
        rows = json.loads(MODELS_PATH.read_text())
    except json.JSONDecodeError:
        return {}
    return {row["id"]: row for row in rows if isinstance(row, dict) and row.get("id")}


def enrich(row: dict, libraries: set[str], previous: dict[str, dict]) -> dict | None:
    repo_id = row["id"]
    pipeline = row.get("pipeline_tag")
    if should_skip_repo(repo_id, pipeline if isinstance(pipeline, str) else None):
        return None
    detail, _headers = get_json(f"https://huggingface.co/api/models/{repo_id}")
    if not isinstance(detail, dict):
        return None
    gguf = detail.get("gguf") if isinstance(detail.get("gguf"), dict) else {}
    total = gguf.get("total") or 0
    try:
        params_b = float(total) / 1_000_000_000
    except (TypeError, ValueError):
        params_b = 0
    if params_b < 0.4 or params_b > 900:
        return None
    if str(gguf.get("architecture") or "").lower() in DENY_ARCHITECTURES:
        return None
    card = detail.get("cardData") if isinstance(detail.get("cardData"), dict) else {}
    bases = base_model_ids(card, repo_id)
    dedupe_key = (bases[0] if bases else repo_id).lower()
    files = collect_files(repo_id)
    quants = aggregate_quant_files(files)
    weights_estimated = False
    if not quants:
        quants = estimated_quants(params_b)
        weights_estimated = True
        if not quants:
            return None
    config, config_repo = load_config(bases + [repo_id])
    arch = parse_architecture(config) if config else None
    if not arch:
        return None
    context = gguf.get("context_length") or arch.get("maxPositionEmbeddings")
    try:
        context = int(context) if context else None
    except (TypeError, ValueError):
        context = None
    name = pretty_name(repo_id)
    active, active_estimated = guess_active_params(name, params_b, arch)
    moe = bool(arch.get("experts")) or bool(active)
    org = author_of(repo_id)
    license_id = card.get("license") if isinstance(card.get("license"), str) else None
    created = detail.get("createdAt") or row.get("createdAt")
    prev = previous.get(repo_id) or {}
    first_seen = prev.get("firstSeen") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    record = {
        "id": repo_id,
        "slug": slugify(repo_id),
        "name": name,
        "author": org,
        "baseModel": bases[0] if bases else None,
        "dedupeKey": dedupe_key,
        "paramsB": round(params_b, 3),
        "activeParamsB": active,
        "activeParamsEstimated": active_estimated,
        "moe": moe,
        "architecture": gguf.get("architecture") or arch.get("modelType") or "transformer",
        "license": license_id,
        "contextLength": context,
        "vision": bool(arch.get("vision")),
        "useCases": use_cases(name, bool(arch.get("vision")), params_b),
        "createdAt": created,
        "firstSeen": first_seen,
        "downloads": int(detail.get("downloads") or row.get("downloads") or 0),
        "likes": int(detail.get("likes") or row.get("likes") or 0),
        "weightsEstimated": weights_estimated,
        "arch": {
            "layers": arch["layers"],
            "kvHeads": arch["kvHeads"],
            "headDim": arch["headDim"],
            "fullAttentionLayers": arch["fullAttentionLayers"],
            "slidingLayers": arch["slidingLayers"],
            "slidingWindow": arch["slidingWindow"],
            "linearLayers": arch["linearLayers"],
            "linearStateBytes": arch["linearStateBytes"],
            "linearStateApproximate": arch["linearStateApproximate"],
            "attention": arch["attention"],
            "mlaBytesPerLayer": arch["mlaBytesPerLayer"],
            "experts": arch["experts"],
            "expertsPerTok": arch["expertsPerTok"],
        },
        "quants": quants,
        "ollama": ollama_library(name, repo_id, libraries),
        "description": describe(
            name,
            params_b,
            str(gguf.get("architecture") or arch.get("modelType") or "transformer"),
            org,
            context,
            license_id,
            active,
            moe,
        ),
        "sources": {
            "gguf": f"https://huggingface.co/{repo_id}",
            "config": f"https://huggingface.co/{config_repo}" if config_repo else None,
        },
    }
    return record


def unique_slugs(rows: list[dict]) -> None:
    seen: dict[str, int] = {}
    for row in rows:
        slug = row["slug"]
        count = seen.get(slug, 0)
        if count:
            row["slug"] = f"{slug}-{count + 1}"
        seen[slug] = count + 1


def main() -> int:
    print(f"HF token: {'yes' if os.environ.get('HF_TOKEN') else 'no'}")
    previous = load_previous()
    candidates = collect_candidates()
    candidates = [row for row in candidates if not should_skip_repo(row["id"], row.get("pipeline_tag"))]
    candidates.sort(key=candidate_score, reverse=True)
    print(f"candidates {len(candidates)} target {TARGET}")
    libraries = fetch_ollama_names()
    accepted: list[dict] = []
    seen_base: set[str] = set()
    errors: list[str] = []
    attempts = 0
    # Enrich sequentially enough to respect the API, with a small pool.
    pool_size = int(os.environ.get("HF_WORKERS", "4"))
    pending = candidates[: max(MAX_ATTEMPTS, TARGET)]

    def _one(row: dict) -> dict | None:
        return enrich(row, libraries, previous)

    with ThreadPoolExecutor(max_workers=pool_size) as pool:
        futures = {}
        iterator = iter(pending)
        for _ in range(pool_size * 2):
            row = next(iterator, None)
            if row is None:
                break
            futures[pool.submit(_one, row)] = row
        while futures and len(accepted) < TARGET and attempts < MAX_ATTEMPTS:
            done = next(as_completed(futures))
            row = futures.pop(done)
            attempts += 1
            if attempts % 25 == 0:
                print(f"attempts {attempts} kept {len(accepted)}", flush=True)
            replacement = next(iterator, None)
            if replacement is not None and len(accepted) < TARGET:
                futures[pool.submit(_one, replacement)] = replacement
            try:
                record = done.result()
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{row['id']}: {exc}")
                if len(errors) <= 8:
                    print(f"error {row['id']}: {exc}", file=sys.stderr)
                continue
            if not record:
                continue
            if record["dedupeKey"] in seen_base:
                continue
            seen_base.add(record["dedupeKey"])
            accepted.append(record)
            if len(accepted) % 15 == 0:
                print(f"kept {len(accepted)} (attempts {attempts}) last={record['id']}")

    if len(accepted) < 40:
        print(f"only kept {len(accepted)} models; refusing to overwrite a good catalog", file=sys.stderr)
        return 1

    accepted.sort(key=lambda item: item["downloads"], reverse=True)
    unique_slugs(accepted)
    for index, row in enumerate(accepted, start=1):
        row["downloadRank"] = index

    previous_ids = set(previous)
    new_ids = [row["id"] for row in accepted if row["id"] not in previous_ids]
    DATA.mkdir(parents=True, exist_ok=True)
    MODELS_PATH.write_text(json.dumps(accepted, indent=2) + "\n")
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "modelCount": len(accepted),
        "withRealQuants": sum(1 for row in accepted if not row["weightsEstimated"]),
        "attempts": attempts,
        "candidateCount": len(candidates),
        "newRepoIds": new_ids[:40],
        "errorCount": len(errors),
        "errors": errors[:25],
        "hfTokenUsed": bool(os.environ.get("HF_TOKEN")),
        "ollamaLibraryCount": len(libraries),
        "sources": [
            "https://huggingface.co/docs/hub/api",
            "https://ollama.com/library",
        ],
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: report[k] for k in ("modelCount", "withRealQuants", "attempts", "errorCount", "newRepoIds")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
