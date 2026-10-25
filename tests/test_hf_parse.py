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
    quant_issues,
    sanitize_quants,
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

    def test_deepseek_v3_active_params_are_the_published_37b(self):
        arch = {"experts": 256, "expertsPerTok": 8}
        for name in ("DeepSeek R1", "DeepSeek V3.1", "DeepSeek V3.2"):
            active, estimated = guess_active_params(name, 671.026, arch)
            self.assertEqual(active, 37)
            self.assertFalse(estimated)
        # The same expert shape without a published name stays near 37B, not ~122B.
        guessed, estimated = guess_active_params("Some MoE", 671.026, arch)
        self.assertAlmostEqual(guessed, 37.074, places=3)
        self.assertTrue(estimated)
        self.assertLess(guessed, 40)

    def test_other_published_moe_active_counts(self):
        cases = [
            ("Llama 4 Scout 17B 16E Instruct", 107.8, {"experts": 16, "expertsPerTok": 1}, 17),
            ("Llama 4 Maverick 17B 128E Instruct", 400.7, {"experts": 128, "expertsPerTok": 1}, 17),
            ("gpt oss 20b", 20.9, {"experts": 32, "expertsPerTok": 4}, 3.6),
            ("gpt oss 120b", 116.8, {"experts": 128, "expertsPerTok": 4}, 5.1),
            ("DeepSeek V4 Flash", 284.3, {"experts": 256, "expertsPerTok": 6}, 13),
            ("DeepSeek V4.1 Flash", 748.5, {"experts": 384, "expertsPerTok": 6}, 16),
            ("GLM 4.5 Air", 110.5, {"experts": 128, "expertsPerTok": 8}, 12),
            ("MiniMax M2", 228.7, {"experts": 256, "expertsPerTok": 8}, 10),
            ("MiMo V2 Flash", 308.8, {"experts": 256, "expertsPerTok": 8}, 15),
        ]
        for name, params, arch, expected in cases:
            active, estimated = guess_active_params(name, params, arch)
            self.assertEqual(active, expected, name)
            self.assertFalse(estimated, name)

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

    def test_incomplete_shard_is_dropped_and_loose_files_are_not_summed(self):
        files = [
            {"path": "DeepSeek-V4.1-Flash-1017-Q8_0-00001-of-00008.gguf", "size": int(7.43e9)},
            {"path": "DeepSeek-V4.1-Flash-1017-UD-Q8_K_XL.gguf", "size": int(473.5e9)},
            {"path": "extra-Q6_K.gguf", "size": int(40e9)},
            {"path": "model-Q6_K.gguf", "size": int(20e9)},
        ]
        # No parameter count: incomplete Q8 shard disappears, and the two Q6 files are not added.
        quants = {q["id"]: q for q in aggregate_quant_files(files)}
        self.assertNotIn("Q8_0", quants)
        self.assertEqual(quants["UD-Q8_K_XL"]["bytes"], int(473.5e9))
        self.assertEqual(quants["Q6_K"]["bytes"], int(40e9))

    def test_flash_1017_q8_that_matches_q4_is_dropped(self):
        """UD-Q8_K_XL was 473 GiB beside a 466 GiB UD-Q4_K_XL. The Q8 is not a Q8."""
        params = 748.495
        quants = sanitize_quants(
            [
                {"id": "UD-Q8_K_XL", "bytes": 508_380_000_000, "bpw": 8.5, "quality": 86, "estimated": False},
                {"id": "UD-Q4_K_XL", "bytes": 500_710_000_000, "bpw": 4.95, "quality": 55, "estimated": False},
                {"id": "UD-Q2_K_XL", "bytes": 334_790_000_000, "bpw": 3.35, "quality": 22, "estimated": False},
                {"id": "Q8_0", "bytes": 7_980_000_000, "bpw": 8.5, "quality": 84, "estimated": False},
            ],
            params,
        )
        ids = {quant["id"] for quant in quants}
        self.assertNotIn("UD-Q8_K_XL", ids)
        self.assertNotIn("Q8_0", ids)
        self.assertIn("UD-Q4_K_XL", ids)
        self.assertIn("UD-Q2_K_XL", ids)

    def test_small_model_q8_above_its_estimate_is_kept(self):
        """Vocab overhead makes a 2B UD-Q8 larger than the table. That is not a bad file."""
        quants = sanitize_quants(
            [
                {"id": "UD-Q8_K_XL", "bytes": int(2.83e9), "bpw": 8.5, "quality": 86, "estimated": False},
                {"id": "Q8_0", "bytes": int(2.01e9), "bpw": 8.5, "quality": 84, "estimated": False},
                {"id": "Q4_K_M", "bytes": int(1.28e9), "bpw": 4.85, "quality": 52, "estimated": False},
                {"id": "BF16", "bytes": int(3.78e9), "bpw": 16, "quality": 98, "estimated": False},
            ],
            1.882,
        )
        ids = {quant["id"] for quant in quants}
        self.assertIn("UD-Q8_K_XL", ids)
        self.assertIn("Q8_0", ids)
        self.assertIn("Q4_K_M", ids)
        self.assertIn("BF16", ids)

    def test_deepseek_v4_1_flash_1017_drops_partial_q8(self):
        params = 473.5 * 8 / 8.5
        files = [
            {"path": "DeepSeek-V4.1-Flash-1017-Q8_0-00001-of-00008.gguf", "size": int(7.43e9)},
            {"path": "DeepSeek-V4.1-Flash-1017-UD-Q8_K_XL.gguf", "size": int(473.5e9)},
        ]
        quants = {q["id"]: q for q in aggregate_quant_files(files, params)}
        self.assertNotIn("Q8_0", quants)
        self.assertEqual(quants["UD-Q8_K_XL"]["bytes"], int(473.5e9))

    def test_nemotron_bolt_e4b_drops_tiny_q8(self):
        files = [
            {"path": "Nemotron-3.5-Bolt-E4B-Q8_0.gguf", "size": int(0.37e9)},
            {"path": "Nemotron-3.5-Bolt-E4B-Q4_K_M.gguf", "size": int(2.4e9)},
        ]
        ids = {q["id"] for q in aggregate_quant_files(files, 4.0)}
        self.assertNotIn("Q8_0", ids)
        self.assertIn("Q4_K_M", ids)

    def test_thinkingcap_q6_cannot_exceed_bf16(self):
        files = [
            {"path": "ThinkingCap-gemma-4-26B-A4B-Q6_K.gguf", "size": int(66.5e9)},
            {"path": "ThinkingCap-gemma-4-26B-A4B-BF16.gguf", "size": int(47.0e9)},
            {"path": "ThinkingCap-gemma-4-26B-A4B-Q4_K_M.gguf", "size": int(15.5e9)},
        ]
        quants = {q["id"]: q for q in aggregate_quant_files(files, 26.0)}
        self.assertNotIn("Q6_K", quants)
        self.assertIn("BF16", quants)
        self.assertIn("Q4_K_M", quants)
        issues = quant_issues(
            {
                "name": "ThinkingCap gemma 4 26B A4B",
                "paramsB": 26,
                "quants": [
                    {"id": "Q6_K", "bytes": int(66.5e9), "estimated": False, "bpw": 6.56, "quality": 72},
                    {"id": "BF16", "bytes": int(47.0e9), "estimated": False, "bpw": 16, "quality": 98},
                ],
            }
        )
        self.assertTrue(any("Q6_K" in issue for issue in issues))

    def test_committed_catalog_passes_quant_sanity(self):
        root = Path(__file__).resolve().parents[1]
        rows = json.loads((root / "src" / "data" / "models.json").read_text())
        problems = [issue for row in rows for issue in quant_issues(row)]
        self.assertEqual(problems, [])


if __name__ == "__main__":
    unittest.main()
