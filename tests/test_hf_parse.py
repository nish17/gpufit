import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from hf_parse import (  # noqa: E402
    aggregate_quant_files,
    dedupe_catalog,
    estimated_quants,
    family_key,
    guess_active_params,
    keep_model,
    parse_architecture,
    quant_id_from_path,
    should_skip_repo,
)


QWEN38 = {
    "model_type": "qwen3_5",
    "vision_config": {"hidden_size": 1024},
    "text_config": {
        "model_type": "qwen3_5_text",
        "head_dim": 256,
        "hidden_size": 5120,
        "full_attention_interval": 4,
        "linear_conv_kernel_dim": 4,
        "linear_key_head_dim": 128,
        "linear_num_key_heads": 16,
        "linear_num_value_heads": 48,
        "linear_value_head_dim": 128,
        "max_position_embeddings": 262144,
        "num_attention_heads": 24,
        "num_hidden_layers": 64,
        "num_key_value_heads": 4,
        "layer_types": ["linear_attention"] * 48 + ["full_attention"] * 16,
    },
}


class ParseTests(unittest.TestCase):
    def test_hybrid_qwen_counts_full_and_linear_layers(self):
        arch = parse_architecture(QWEN38)
        self.assertIsNotNone(arch)
        assert arch is not None
        self.assertEqual(arch["layers"], 64)
        self.assertEqual(arch["fullAttentionLayers"], 16)
        self.assertEqual(arch["linearLayers"], 48)
        self.assertEqual(arch["kvHeads"], 4)
        self.assertEqual(arch["headDim"], 256)
        self.assertEqual(arch["attention"], "hybrid")
        self.assertTrue(arch["vision"])
        # 48 layers * 48 value heads * 128 * 128 * 2 bytes
        self.assertEqual(arch["linearStateBytes"], 48 * 48 * 128 * 128 * 2)

    def test_gemma_sliding_pattern(self):
        arch = parse_architecture(
            {
                "model_type": "gemma3_text",
                "num_hidden_layers": 42,
                "num_attention_heads": 16,
                "num_key_value_heads": 8,
                "head_dim": 256,
                "hidden_size": 4096,
                "sliding_window": 1024,
                "sliding_window_pattern": 6,
                "max_position_embeddings": 131072,
            }
        )
        assert arch is not None
        self.assertEqual(arch["fullAttentionLayers"] + arch["slidingLayers"], 42)
        self.assertEqual(arch["slidingWindow"], 1024)
        self.assertGreater(arch["slidingLayers"], arch["fullAttentionLayers"])

    def test_mla(self):
        arch = parse_architecture(
            {
                "model_type": "deepseek_v3",
                "num_hidden_layers": 61,
                "num_attention_heads": 128,
                "num_key_value_heads": 128,
                "hidden_size": 7168,
                "kv_lora_rank": 512,
                "qk_rope_head_dim": 64,
                "n_routed_experts": 256,
                "num_experts_per_tok": 8,
                "max_position_embeddings": 163840,
            }
        )
        assert arch is not None
        self.assertEqual(arch["attention"], "mla")
        self.assertEqual(arch["mlaBytesPerLayer"], (512 + 64) * 2)
        self.assertEqual(arch["experts"], 256)
        self.assertEqual(arch["expertsPerTok"], 8)

    def test_quant_ids_prefer_longest_match(self):
        self.assertEqual(quant_id_from_path("Qwen3.8-27B-UD-Q4_K_XL.gguf"), "UD-Q4_K_XL")
        self.assertEqual(quant_id_from_path("model-Q4_K_M.gguf"), "Q4_K_M")
        self.assertIsNone(quant_id_from_path("mmproj-f16.gguf"))
        self.assertIsNone(quant_id_from_path("MTP/mtp-Q4_0.gguf"))

    def test_shards_sum_once(self):
        files = [
            {"path": "Q4_K_M/model-00001-of-00002.gguf", "size": 5_000_000_000},
            {"path": "Q4_K_M/model-00002-of-00002.gguf", "size": 4_000_000_000},
            {"path": "Q8_0/model-Q8_0.gguf", "size": 16_000_000_000},
            {"path": "imatrix.gguf", "size": 50_000_000},
        ]
        quants = {q["id"]: q for q in aggregate_quant_files(files)}
        self.assertEqual(quants["Q4_K_M"]["bytes"], 9_000_000_000)
        self.assertFalse(quants["Q4_K_M"]["estimated"])
        self.assertEqual(quants["Q8_0"]["bytes"], 16_000_000_000)

    def test_estimated_q4_matches_shared_bpw_table(self):
        quants = {q["id"]: q for q in estimated_quants(27.32)}
        # 27.32e9 * 4.85 / 8
        self.assertEqual(quants["Q4_K_M"]["bytes"], int(27.32e9 * 4.85 / 8))
        self.assertTrue(quants["Q4_K_M"]["estimated"])

    def test_active_params_from_name(self):
        active, estimated = guess_active_params("Qwen3-30B-A3B", 30.5, {"experts": 128, "expertsPerTok": 8})
        self.assertEqual(active, 3.0)
        self.assertFalse(estimated)

    def test_skip_noise(self):
        self.assertTrue(should_skip_repo("foo/whisper-large-gguf", "automatic-speech-recognition"))
        self.assertTrue(should_skip_repo("foo/bge-m3-gguf", "feature-extraction"))
        self.assertTrue(should_skip_repo("mradermacher/MemDuet-S1-Qwen2.5-0.5B", "text-generation"))
        self.assertFalse(should_skip_repo("unsloth/Qwen3.8-27B-GGUF", "text-generation"))

    def test_catalog_keeps_one_variant_of_a_base_model(self):
        self.assertFalse(keep_model({"name": "MemDuet S1 Qwen2.5 0.5B", "id": "mradermacher/MemDuet", "author": "mradermacher", "downloads": 0, "likes": 0}))
        self.assertTrue(keep_model({"name": "Qwen3.8 27B", "id": "unsloth/Qwen3.8-27B-GGUF", "author": "unsloth", "downloads": 1000, "likes": 10}))
        self.assertTrue(keep_model({"name": "LFM2.5 2.6B", "id": "LiquidAI/LFM2.5-2.6B-GGUF", "author": "liquidai", "downloads": 1000, "likes": 10}))
        self.assertEqual(family_key("gemma 4 12b it", 11.9), family_key("gemma 4 12B it qat", 11.9))
        self.assertEqual(family_key("Mistral Small 3.2 24B Instruct 2506", 23.6), family_key("Mistral Small 24B Instruct 2501", 23.6))
        self.assertEqual(family_key("Devstral Small 2 24B Instruct 2512", 23.6), family_key("Devstral Small 2507", 23.6))
        self.assertNotEqual(family_key("Qwen3.8 27B", 27.3), family_key("Qwen3.5 27B", 26.9))
        rows = dedupe_catalog([
            {"name": "gemma 4 12b it", "id": "unsloth/gemma-4-12b-it-GGUF", "author": "unsloth", "downloads": 1_600_000, "likes": 900},
            {"name": "gemma 4 12B it qat", "id": "unsloth/gemma-4-12b-it-qat-GGUF", "author": "unsloth", "downloads": 300_000, "likes": 100},
            {"name": "Ornith 1.0 9B", "id": "unsloth/Ornith-1.0-9B-GGUF", "author": "unsloth", "downloads": 300_000, "likes": 60},
        ])
        self.assertEqual([row["name"] for row in rows], ["gemma 4 12b it"])


if __name__ == "__main__":
    unittest.main()
