#!/usr/bin/env python3
"""Write src/data/hardware.json from a curated, sourced device table.

Each row is checked against a vendor spec page or, for CPU bandwidth, computed
from the JEDEC rate. Do not bulk-import TechPowerUp.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "data" / "hardware.json"

NVIDIA_COMPARE = "https://www.nvidia.com/en-us/geforce/graphics-cards/compare/"
NVIDIA_40 = "https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/"
NVIDIA_30 = "https://www.nvidia.com/en-us/geforce/graphics-cards/30-series/"
NVIDIA_DC = "https://www.nvidia.com/en-us/data-center/gpu-comparison/"
AMD_7000 = "https://www.amd.com/en/products/graphics/desktops/radeon/7000-series.html"
AMD_9000 = "https://www.amd.com/en/products/graphics/desktops/radeon/9000-series/amd-radeon-rx-9070xt.html"
INTEL_ARC = "https://www.intel.com/content/www/us/en/products/details/discrete-gpus/arc.html"
APPLE_M4 = "https://www.apple.com/newsroom/2024/10/apple-introduces-m4-pro-and-m4-max/"
APPLE_M5 = "https://www.apple.com/newsroom/2025/10/apple-unleashes-m5-the-next-big-leap-in-ai-performance-for-apple-silicon/"
APPLE_M5_PRO = "https://www.apple.com/newsroom/2026/03/apple-debuts-m5-pro-and-m5-max-to-supercharge-the-most-demanding-pro-workflows/"
APPLE_MBP = "https://www.apple.com/macbook-pro/specs/"
DDR5 = "https://en.wikipedia.org/wiki/DDR5_SDRAM"
DDR4 = "https://en.wikipedia.org/wiki/DDR4_SDRAM"

# slug, name, vendor, category, kind, vram_gb, bandwidth, memory_type, year,
# popular, source, note, memory_options, default_memory, drives_display
Row = tuple


def gpu(slug, name, vendor, category, vram, bandwidth, memory_type, year, popular, source, note, drives=True):
    return {
        "slug": slug,
        "name": name,
        "vendor": vendor,
        "category": category,
        "kind": "gpu",
        "vramGb": vram,
        "bandwidthGBps": bandwidth,
        "memoryType": memory_type,
        "year": year,
        "popular": popular,
        "sourceUrl": source,
        "sourceNote": note,
        "memoryOptionsGb": None,
        "defaultMemoryGb": vram,
        "drivesDisplayDefault": drives,
    }


def pool(slug, name, vendor, category, kind, bandwidth, memory_type, year, popular, source, note, options, default):
    return {
        "slug": slug,
        "name": name,
        "vendor": vendor,
        "category": category,
        "kind": kind,
        "vramGb": None,
        "bandwidthGBps": bandwidth,
        "memoryType": memory_type,
        "year": year,
        "popular": popular,
        "sourceUrl": source,
        "sourceNote": note,
        "memoryOptionsGb": options,
        "defaultMemoryGb": default,
        "drivesDisplayDefault": False,
    }


def build() -> list[dict]:
    rows: list[dict] = []
    N = "nvidia"
    note50 = "NVIDIA official compare table: memory config and bandwidth."
    rows += [
        gpu("rtx-5090", "GeForce RTX 5090", N, "consumer", 32, 1792, "GDDR7", 2025, True, NVIDIA_COMPARE, note50),
        gpu("rtx-5080", "GeForce RTX 5080", N, "consumer", 16, 960, "GDDR7", 2025, True, NVIDIA_COMPARE, note50),
        gpu("rtx-5070-ti", "GeForce RTX 5070 Ti", N, "consumer", 16, 896, "GDDR7", 2025, False, NVIDIA_COMPARE, note50),
        gpu("rtx-5070", "GeForce RTX 5070", N, "consumer", 12, 672, "GDDR7", 2025, True, NVIDIA_COMPARE, note50),
        gpu("rtx-5060-ti-16gb", "GeForce RTX 5060 Ti 16GB", N, "consumer", 16, 448, "GDDR7", 2025, True, NVIDIA_COMPARE, "NVIDIA lists the 5060 Ti as 16GB or 8GB GDDR7, 448 GB/s."),
        gpu("rtx-5060-ti-8gb", "GeForce RTX 5060 Ti 8GB", N, "consumer", 8, 448, "GDDR7", 2025, True, NVIDIA_COMPARE, "8GB variant of the RTX 5060 Ti. Same 448 GB/s bus as the 16GB card."),
        gpu("rtx-5060", "GeForce RTX 5060", N, "consumer", 8, 448, "GDDR7", 2025, False, NVIDIA_COMPARE, note50),
        gpu("rtx-5050", "GeForce RTX 5050", N, "consumer", 8, 320, "GDDR6", 2025, False, NVIDIA_COMPARE, note50),
    ]
    note40 = "NVIDIA GeForce RTX 40-series specifications. Bandwidth is the published peak."
    rows += [
        gpu("rtx-4090", "GeForce RTX 4090", N, "consumer", 24, 1008, "GDDR6X", 2022, True, NVIDIA_40, note40),
        gpu("rtx-4080-super", "GeForce RTX 4080 Super", N, "consumer", 16, 736, "GDDR6X", 2024, True, NVIDIA_40, note40),
        gpu("rtx-4080", "GeForce RTX 4080", N, "consumer", 16, 716.8, "GDDR6X", 2022, False, NVIDIA_40, "256-bit GDDR6X at 22.4 Gbps = 716.8 GB/s."),
        gpu("rtx-4070-ti-super", "GeForce RTX 4070 Ti Super", N, "consumer", 16, 672, "GDDR6X", 2024, True, NVIDIA_40, note40),
        gpu("rtx-4070-ti", "GeForce RTX 4070 Ti", N, "consumer", 12, 504, "GDDR6X", 2023, False, NVIDIA_40, "192-bit GDDR6X at 21 Gbps = 504 GB/s."),
        gpu("rtx-4070-super", "GeForce RTX 4070 Super", N, "consumer", 12, 504, "GDDR6X", 2024, False, NVIDIA_40, note40),
        gpu("rtx-4070", "GeForce RTX 4070", N, "consumer", 12, 504, "GDDR6X", 2023, True, NVIDIA_40, note40),
        gpu("rtx-4060-ti-16gb", "GeForce RTX 4060 Ti 16GB", N, "consumer", 16, 288, "GDDR6", 2023, True, NVIDIA_40, "128-bit GDDR6 at 18 Gbps = 288 GB/s."),
        gpu("rtx-4060-ti-8gb", "GeForce RTX 4060 Ti 8GB", N, "consumer", 8, 288, "GDDR6", 2023, True, NVIDIA_40, "8GB variant. Same 288 GB/s bus as the 16GB card."),
        gpu("rtx-4060", "GeForce RTX 4060", N, "consumer", 8, 272, "GDDR6", 2023, True, NVIDIA_40, "128-bit GDDR6 at 17 Gbps = 272 GB/s."),
    ]
    note30 = "NVIDIA GeForce RTX 30-series specifications."
    rows += [
        gpu("rtx-3090-ti", "GeForce RTX 3090 Ti", N, "consumer", 24, 1008, "GDDR6X", 2022, False, NVIDIA_30, note30),
        gpu("rtx-3090", "GeForce RTX 3090", N, "consumer", 24, 936, "GDDR6X", 2020, True, NVIDIA_30, "384-bit GDDR6X at 19.5 Gbps = 936 GB/s."),
        gpu("rtx-3080-ti", "GeForce RTX 3080 Ti", N, "consumer", 12, 912, "GDDR6X", 2021, False, NVIDIA_30, note30),
        gpu("rtx-3080-12gb", "GeForce RTX 3080 12GB", N, "consumer", 12, 912, "GDDR6X", 2022, False, NVIDIA_30, "384-bit GDDR6X at 19 Gbps = 912 GB/s."),
        gpu("rtx-3080-10gb", "GeForce RTX 3080 10GB", N, "consumer", 10, 760, "GDDR6X", 2020, True, NVIDIA_30, "320-bit GDDR6X at 19 Gbps = 760 GB/s."),
        gpu("rtx-3070-ti", "GeForce RTX 3070 Ti", N, "consumer", 8, 608, "GDDR6X", 2021, False, NVIDIA_30, note30),
        gpu("rtx-3070", "GeForce RTX 3070", N, "consumer", 8, 448, "GDDR6", 2020, True, NVIDIA_30, "256-bit GDDR6 at 14 Gbps = 448 GB/s."),
        gpu("rtx-3060-ti", "GeForce RTX 3060 Ti", N, "consumer", 8, 448, "GDDR6", 2020, True, NVIDIA_30, "256-bit GDDR6 at 14 Gbps = 448 GB/s."),
        gpu("rtx-3060-12gb", "GeForce RTX 3060 12GB", N, "consumer", 12, 360, "GDDR6", 2021, True, NVIDIA_30, "192-bit GDDR6 at 15 Gbps = 360 GB/s."),
        gpu("rtx-3060-8gb", "GeForce RTX 3060 8GB", N, "consumer", 8, 240, "GDDR6", 2022, False, NVIDIA_30, "128-bit GDDR6 at 15 Gbps = 240 GB/s."),
        gpu("rtx-3050-8gb", "GeForce RTX 3050 8GB", N, "consumer", 8, 224, "GDDR6", 2022, False, NVIDIA_30, "128-bit GDDR6 at 14 Gbps = 224 GB/s."),
        gpu("rtx-3050-6gb", "GeForce RTX 3050 6GB", N, "consumer", 6, 168, "GDDR6", 2024, False, NVIDIA_COMPARE, "NVIDIA compare table lists 6GB and 168 GB/s for this variant."),
    ]
    rows += [
        gpu("rtx-2080-ti", "GeForce RTX 2080 Ti", N, "consumer", 11, 616, "GDDR6", 2018, False, "https://www.nvidia.com/en-us/geforce/graphics-cards/rtx-2080-ti/", "352-bit GDDR6 at 14 Gbps = 616 GB/s."),
        gpu("rtx-2080-super", "GeForce RTX 2080 Super", N, "consumer", 8, 496, "GDDR6", 2019, False, NVIDIA_COMPARE, "256-bit GDDR6 at 15.5 Gbps = 496 GB/s."),
        gpu("rtx-2070-super", "GeForce RTX 2070 Super", N, "consumer", 8, 448, "GDDR6", 2019, False, NVIDIA_COMPARE, "256-bit GDDR6 at 14 Gbps = 448 GB/s."),
        gpu("rtx-2060-super", "GeForce RTX 2060 Super", N, "consumer", 8, 448, "GDDR6", 2019, False, NVIDIA_COMPARE, "256-bit GDDR6 at 14 Gbps = 448 GB/s."),
        gpu("rtx-2060-12gb", "GeForce RTX 2060 12GB", N, "consumer", 12, 336, "GDDR6", 2021, False, NVIDIA_COMPARE, "192-bit GDDR6 at 14 Gbps = 336 GB/s."),
        gpu("rtx-2060-6gb", "GeForce RTX 2060 6GB", N, "consumer", 6, 336, "GDDR6", 2019, False, NVIDIA_COMPARE, "192-bit GDDR6 at 14 Gbps = 336 GB/s."),
        gpu("gtx-1660-super", "GeForce GTX 1660 Super", N, "consumer", 6, 336, "GDDR6", 2019, False, NVIDIA_COMPARE, "192-bit GDDR6 at 14 Gbps = 336 GB/s."),
        gpu("gtx-1660-ti", "GeForce GTX 1660 Ti", N, "consumer", 6, 288, "GDDR6", 2019, False, NVIDIA_COMPARE, "192-bit GDDR6 at 12 Gbps = 288 GB/s."),
        gpu("gtx-1080-ti", "GeForce GTX 1080 Ti", N, "consumer", 11, 484, "GDDR5X", 2017, False, "https://www.nvidia.com/en-us/geforce/graphics-cards/geforce-gtx-1080-ti/", "352-bit GDDR5X at 11 Gbps = 484 GB/s."),
        gpu("gtx-1080", "GeForce GTX 1080", N, "consumer", 8, 320, "GDDR5X", 2016, False, NVIDIA_COMPARE, "256-bit GDDR5X at 10 Gbps = 320 GB/s."),
        gpu("gtx-1070", "GeForce GTX 1070", N, "consumer", 8, 256, "GDDR5", 2016, False, NVIDIA_COMPARE, "256-bit GDDR5 at 8 Gbps = 256 GB/s."),
    ]
    laptop = "NVIDIA laptop GPU reference spec. Partner clocks vary; bandwidth is the reference bus."
    rows += [
        gpu("rtx-4090-laptop", "GeForce RTX 4090 Laptop", N, "laptop", 16, 576, "GDDR6", 2023, False, NVIDIA_40, laptop),
        gpu("rtx-4080-laptop", "GeForce RTX 4080 Laptop", N, "laptop", 12, 432, "GDDR6", 2023, False, NVIDIA_40, laptop),
        gpu("rtx-4070-laptop", "GeForce RTX 4070 Laptop", N, "laptop", 8, 256, "GDDR6", 2023, False, NVIDIA_40, laptop),
        gpu("rtx-4060-laptop", "GeForce RTX 4060 Laptop", N, "laptop", 8, 256, "GDDR6", 2023, False, NVIDIA_40, laptop),
    ]
    rows += [
        gpu("b200", "NVIDIA B200", N, "datacenter", 192, 8000, "HBM3e", 2024, False, NVIDIA_DC, "192GB HBM3e, 8 TB/s class bandwidth.", False),
        gpu("h200-sxm", "NVIDIA H200 SXM", N, "datacenter", 141, 4800, "HBM3e", 2024, False, "https://www.nvidia.com/en-us/data-center/h200/", "141GB HBM3e, 4.8 TB/s.", False),
        gpu("h100-sxm-80gb", "NVIDIA H100 SXM 80GB", N, "datacenter", 80, 3350, "HBM3", 2022, True, "https://www.nvidia.com/en-us/data-center/h100/", "SXM5 80GB HBM3, 3.35 TB/s.", False),
        gpu("h100-pcie-80gb", "NVIDIA H100 PCIe 80GB", N, "datacenter", 80, 2000, "HBM2e", 2023, False, "https://www.nvidia.com/en-us/data-center/h100/", "PCIe 80GB, 2 TB/s.", False),
        gpu("a100-80gb-sxm", "NVIDIA A100 80GB SXM", N, "datacenter", 80, 2039, "HBM2e", 2021, False, "https://www.nvidia.com/en-us/data-center/a100/", "SXM4 80GB, 2039 GB/s.", False),
        gpu("a100-80gb-pcie", "NVIDIA A100 80GB PCIe", N, "datacenter", 80, 1935, "HBM2e", 2021, False, "https://www.nvidia.com/en-us/data-center/a100/", "PCIe 80GB, 1935 GB/s.", False),
        gpu("a100-40gb", "NVIDIA A100 40GB", N, "datacenter", 40, 1555, "HBM2", 2020, False, "https://www.nvidia.com/en-us/data-center/a100/", "40GB HBM2, 1555 GB/s.", False),
        gpu("l40s", "NVIDIA L40S", N, "datacenter", 48, 864, "GDDR6", 2023, False, "https://www.nvidia.com/en-us/data-center/l40s/", "48GB GDDR6, 864 GB/s.", False),
        gpu("l4", "NVIDIA L4", N, "datacenter", 24, 300, "GDDR6", 2023, False, "https://www.nvidia.com/en-us/data-center/l4/", "24GB GDDR6, 300 GB/s.", False),
        gpu("a10", "NVIDIA A10", N, "datacenter", 24, 600, "GDDR6", 2021, False, NVIDIA_DC, "24GB GDDR6, 600 GB/s.", False),
        gpu("a40", "NVIDIA A40", N, "datacenter", 48, 696, "GDDR6", 2020, False, NVIDIA_DC, "48GB GDDR6, 696 GB/s.", False),
        gpu("rtx-6000-ada", "RTX 6000 Ada", N, "workstation", 48, 960, "GDDR6", 2023, True, "https://www.nvidia.com/en-us/products/workstations/rtx-6000/", "48GB GDDR6, 960 GB/s.", True),
        gpu("rtx-5000-ada", "RTX 5000 Ada", N, "workstation", 32, 576, "GDDR6", 2023, False, "https://www.nvidia.com/en-us/products/workstations/", "32GB GDDR6, 576 GB/s.", True),
        gpu("rtx-4000-ada", "RTX 4000 Ada", N, "workstation", 20, 360, "GDDR6", 2023, False, "https://www.nvidia.com/en-us/products/workstations/", "20GB GDDR6, 360 GB/s.", True),
        gpu("rtx-a6000", "RTX A6000", N, "workstation", 48, 768, "GDDR6", 2020, False, "https://www.nvidia.com/en-us/products/workstations/rtx-a6000/", "48GB GDDR6, 768 GB/s.", True),
        gpu("rtx-a5000", "RTX A5000", N, "workstation", 24, 768, "GDDR6", 2021, False, "https://www.nvidia.com/en-us/products/workstations/", "24GB GDDR6, 768 GB/s.", True),
        gpu("rtx-a4000", "RTX A4000", N, "workstation", 16, 448, "GDDR6", 2021, False, "https://www.nvidia.com/en-us/products/workstations/", "16GB GDDR6, 448 GB/s.", True),
        gpu("v100-32gb", "Tesla V100 32GB", N, "datacenter", 32, 900, "HBM2", 2018, False, NVIDIA_DC, "32GB HBM2 SXM2, 900 GB/s.", False),
        gpu("tesla-t4", "NVIDIA T4", N, "datacenter", 16, 320, "GDDR6", 2018, False, "https://www.nvidia.com/en-us/data-center/tesla-t4/", "16GB GDDR6, 320 GB/s.", False),
    ]

    A = "amd"
    rows += [
        gpu("rx-9070-xt", "Radeon RX 9070 XT", A, "consumer", 16, 640, "GDDR6", 2025, True, AMD_9000, "AMD product page: 16GB GDDR6, 256-bit, up to 640 GB/s."),
        gpu("rx-9070", "Radeon RX 9070", A, "consumer", 16, 640, "GDDR6", 2025, False, "https://www.amd.com/en/products/graphics/desktops/radeon/9000-series.html", "256-bit GDDR6 at 20 Gbps = 640 GB/s, same memory bus AMD publishes for the 9070 series."),
        gpu("rx-9060-xt-16gb", "Radeon RX 9060 XT 16GB", A, "consumer", 16, 320, "GDDR6", 2025, False, "https://www.amd.com/en/products/graphics/desktops/radeon.html", "AMD quick reference: 16GB GDDR6, 128-bit, 320 GB/s."),
        gpu("rx-9060-xt-8gb", "Radeon RX 9060 XT 8GB", A, "consumer", 8, 320, "GDDR6", 2025, False, "https://www.amd.com/en/products/graphics/desktops/radeon.html", "8GB board, same 128-bit 320 GB/s class bus."),
        gpu("rx-7900-xtx", "Radeon RX 7900 XTX", A, "consumer", 24, 960, "GDDR6", 2022, True, AMD_7000, "24GB GDDR6, 384-bit, 960 GB/s."),
        gpu("rx-7900-xt", "Radeon RX 7900 XT", A, "consumer", 20, 800, "GDDR6", 2022, False, AMD_7000, "20GB GDDR6, 320-bit, 800 GB/s."),
        gpu("rx-7900-gre", "Radeon RX 7900 GRE", A, "consumer", 16, 576, "GDDR6", 2023, False, AMD_7000, "16GB GDDR6, 256-bit, 576 GB/s."),
        gpu("rx-7800-xt", "Radeon RX 7800 XT", A, "consumer", 16, 624, "GDDR6", 2023, True, AMD_7000, "16GB GDDR6, 256-bit, 624 GB/s."),
        gpu("rx-7700-xt", "Radeon RX 7700 XT", A, "consumer", 12, 432, "GDDR6", 2023, False, AMD_7000, "12GB GDDR6, 192-bit, 432 GB/s."),
        gpu("rx-7600-xt", "Radeon RX 7600 XT", A, "consumer", 16, 288, "GDDR6", 2024, False, AMD_7000, "16GB GDDR6, 128-bit, 288 GB/s."),
        gpu("rx-7600", "Radeon RX 7600", A, "consumer", 8, 288, "GDDR6", 2023, True, AMD_7000, "8GB GDDR6, 128-bit, 288 GB/s."),
        gpu("rx-6950-xt", "Radeon RX 6950 XT", A, "consumer", 16, 576, "GDDR6", 2022, False, AMD_7000, "16GB GDDR6, 256-bit, 576 GB/s."),
        gpu("rx-6900-xt", "Radeon RX 6900 XT", A, "consumer", 16, 512, "GDDR6", 2020, False, "https://www.amd.com/en/products/graphics/desktops/radeon/6000-series.html", "16GB GDDR6, 256-bit, 512 GB/s."),
        gpu("rx-6800-xt", "Radeon RX 6800 XT", A, "consumer", 16, 512, "GDDR6", 2020, False, "https://www.amd.com/en/products/graphics/desktops/radeon/6000-series.html", "16GB GDDR6, 256-bit, 512 GB/s."),
        gpu("rx-6800", "Radeon RX 6800", A, "consumer", 16, 512, "GDDR6", 2020, False, "https://www.amd.com/en/products/graphics/desktops/radeon/6000-series.html", "16GB GDDR6, 256-bit, 512 GB/s."),
        gpu("rx-6750-xt", "Radeon RX 6750 XT", A, "consumer", 12, 432, "GDDR6", 2022, False, "https://www.amd.com/en/products/graphics/desktops/radeon/6000-series.html", "12GB GDDR6, 192-bit, 432 GB/s."),
        gpu("rx-6700-xt", "Radeon RX 6700 XT", A, "consumer", 12, 384, "GDDR6", 2021, False, "https://www.amd.com/en/products/graphics/desktops/radeon/6000-series.html", "12GB GDDR6, 192-bit, 384 GB/s."),
        gpu("rx-6650-xt", "Radeon RX 6650 XT", A, "consumer", 8, 280, "GDDR6", 2022, False, "https://www.amd.com/en/products/graphics/desktops/radeon/6000-series.html", "128-bit GDDR6 at 17.5 Gbps = 280 GB/s."),
        gpu("rx-6600-xt", "Radeon RX 6600 XT", A, "consumer", 8, 256, "GDDR6", 2021, False, "https://www.amd.com/en/products/graphics/desktops/radeon/6000-series.html", "128-bit GDDR6 at 16 Gbps = 256 GB/s."),
        gpu("rx-6600", "Radeon RX 6600", A, "consumer", 8, 224, "GDDR6", 2021, False, "https://www.amd.com/en/products/graphics/desktops/radeon/6000-series.html", "128-bit GDDR6 at 14 Gbps = 224 GB/s."),
        gpu("rx-5700-xt", "Radeon RX 5700 XT", A, "consumer", 8, 448, "GDDR6", 2019, False, "https://www.amd.com/en/products/graphics/desktops/radeon.html", "256-bit GDDR6 at 14 Gbps = 448 GB/s."),
    ]

    I = "intel"
    rows += [
        gpu("arc-b580", "Intel Arc B580", I, "consumer", 12, 456, "GDDR6", 2024, True, "https://www.intel.com/content/www/us/en/products/sku/241598/intel-arc-b580-graphics/specifications.html", "12GB GDDR6, 456 GB/s."),
        gpu("arc-b570", "Intel Arc B570", I, "consumer", 10, 380, "GDDR6", 2024, False, "https://www.intel.com/content/www/us/en/products/details/discrete-gpus/arc.html", "10GB GDDR6, 380 GB/s."),
        gpu("arc-a770-16gb", "Intel Arc A770 16GB", I, "consumer", 16, 560, "GDDR6", 2022, True, INTEL_ARC, "16GB GDDR6, 256-bit, 560 GB/s."),
        gpu("arc-a770-8gb", "Intel Arc A770 8GB", I, "consumer", 8, 512, "GDDR6", 2022, False, INTEL_ARC, "8GB GDDR6, 256-bit, 512 GB/s."),
        gpu("arc-a750", "Intel Arc A750", I, "consumer", 8, 512, "GDDR6", 2022, False, INTEL_ARC, "8GB GDDR6, 512 GB/s."),
        gpu("arc-a580", "Intel Arc A580", I, "consumer", 8, 512, "GDDR6", 2023, False, INTEL_ARC, "8GB GDDR6, 512 GB/s."),
        gpu("arc-a380", "Intel Arc A380", I, "consumer", 6, 186, "GDDR6", 2022, False, INTEL_ARC, "6GB GDDR6, about 186 GB/s."),
    ]

    def mac(slug, name, bandwidth, year, popular, source, note, options, default):
        return pool(slug, name, "apple", "apple", "mac", bandwidth, "Unified", year, popular, source, note, options, default)

    apple_m1 = "https://www.apple.com/newsroom/2020/11/apple-unleashes-m1/"
    rows += [
        mac("m1", "Apple M1", 68.25, 2020, False, apple_m1, "Apple M1 unified memory bandwidth is 68.25 GB/s. 8GB or 16GB configs.", [8, 16], 16),
        mac("m1-pro", "Apple M1 Pro", 200, 2021, False, "https://www.apple.com/newsroom/2021/10/introducing-m1-pro-and-m1-max/", "200 GB/s. 16GB or 32GB unified memory.", [16, 32], 16),
        mac("m1-max", "Apple M1 Max", 400, 2021, True, "https://www.apple.com/newsroom/2021/10/introducing-m1-pro-and-m1-max/", "400 GB/s. 32GB or 64GB unified memory.", [32, 64], 32),
        mac("m1-ultra", "Apple M1 Ultra", 800, 2022, False, "https://www.apple.com/newsroom/2022/03/apple-unveils-m1-ultra/", "800 GB/s. 64GB or 128GB.", [64, 128], 64),
        mac("m2", "Apple M2", 100, 2022, False, "https://www.apple.com/newsroom/2022/06/apple-unveils-m2/", "100 GB/s. 8, 16, or 24GB.", [8, 16, 24], 16),
        mac("m2-pro", "Apple M2 Pro", 200, 2023, False, "https://www.apple.com/newsroom/2023/01/apple-unveils-m2-pro-and-m2-max/", "200 GB/s. 16GB or 32GB.", [16, 32], 16),
        mac("m2-max", "Apple M2 Max", 400, 2023, False, "https://www.apple.com/newsroom/2023/01/apple-unveils-m2-pro-and-m2-max/", "400 GB/s. 32, 64, or 96GB.", [32, 64, 96], 32),
        mac("m2-ultra", "Apple M2 Ultra", 800, 2023, False, "https://www.apple.com/newsroom/2023/06/apple-introduces-m2-ultra/", "800 GB/s. 64, 128, or 192GB.", [64, 128, 192], 64),
        mac("m3", "Apple M3", 100, 2023, False, "https://www.apple.com/newsroom/2023/10/apple-unveils-m3-m3-pro-and-m3-max/", "100 GB/s. 8, 16, or 24GB.", [8, 16, 24], 16),
        mac("m3-pro", "Apple M3 Pro", 150, 2023, True, "https://www.apple.com/newsroom/2023/10/apple-unveils-m3-m3-pro-and-m3-max/", "150 GB/s. 18GB or 36GB.", [18, 36], 18),
        mac("m3-max-30gpu", "Apple M3 Max (30-core GPU)", 300, 2023, False, "https://www.apple.com/newsroom/2023/10/apple-unveils-m3-m3-pro-and-m3-max/", "30-core GPU version, 300 GB/s. Memory configs 36–96GB.", [36, 48, 96], 36),
        mac("m3-max-40gpu", "Apple M3 Max (40-core GPU)", 400, 2023, False, "https://www.apple.com/newsroom/2023/10/apple-unveils-m3-m3-pro-and-m3-max/", "40-core GPU version, 400 GB/s. Up to 128GB.", [48, 64, 96, 128], 48),
        mac("m3-ultra", "Apple M3 Ultra", 819, 2025, False, "https://www.apple.com/newsroom/2025/03/apple-reveals-m3-ultra/", "Apple quotes 819 GB/s and up to 512GB unified memory.", [96, 256, 512], 96),
        mac("m4", "Apple M4", 120, 2024, True, APPLE_M4, "Apple: M4 bandwidth is 120 GB/s, up to 32GB unified memory.", [16, 24, 32], 16),
        mac("m4-pro", "Apple M4 Pro", 273, 2024, True, APPLE_M4, "Apple: 273 GB/s, up to 64GB.", [24, 48, 64], 24),
        mac("m4-max-32gpu", "Apple M4 Max (32-core GPU)", 410, 2024, False, APPLE_MBP, "Apple MacBook Pro specs: 14-core CPU / 32-core GPU at 410 GB/s, 36GB.", [36], 36),
        mac("m4-max-40gpu", "Apple M4 Max (40-core GPU)", 546, 2024, True, APPLE_M4, "Apple: up to 546 GB/s and 128GB for the 40-core GPU M4 Max.", [48, 64, 128], 48),
        mac("m5", "Apple M5", 153, 2025, True, APPLE_M5, "Apple: 153 GB/s, 16/24/32GB unified memory.", [16, 24, 32], 16),
        mac("m5-pro", "Apple M5 Pro", 307, 2026, True, APPLE_M5_PRO, "Apple March 2026: up to 307 GB/s and 64GB.", [24, 48, 64], 24),
        mac("m5-max-32gpu", "Apple M5 Max (32-core GPU)", 460, 2026, False, APPLE_MBP, "Apple MacBook Pro specs: 32-core GPU at 460 GB/s, 36GB.", [36], 36),
        mac("m5-max-40gpu", "Apple M5 Max (40-core GPU)", 614, 2026, True, APPLE_M5_PRO, "Apple: up to 614 GB/s and 128GB for the 40-core GPU M5 Max.", [48, 64, 128], 48),
    ]

    rows.append(
        pool(
            "ryzen-ai-max-395",
            "AMD Ryzen AI Max+ 395",
            "amd",
            "soc",
            "unified",
            256,
            "LPDDR5X",
            2025,
            True,
            "https://www.amd.com/en/products/processors/laptop/ryzen/ai-300-series.html",
            "Strix Halo class APU with a large unified pool. 256 GB/s assumes 256-bit LPDDR5X-8000. The 75% GPU budget is a conservative default, not an AMD firmware limit.",
            [32, 64, 96, 128],
            64,
        )
    )

    def cpu(slug, name, bandwidth, popular, source, note, options, default):
        return pool(slug, name, "cpu", "cpu", "cpu", bandwidth, "System RAM", 2024, popular, source, note, options, default)

    ram = [8, 16, 32, 64, 128]
    rows += [
        cpu("cpu-ddr4-3200", "CPU only · DDR4-3200", 51.2, False, DDR4, "Dual-channel DDR4-3200 theoretical bandwidth: 2 × 3.2 GT/s × 8 bytes = 51.2 GB/s.", ram, 32),
        cpu("cpu-ddr5-4800", "CPU only · DDR5-4800", 76.8, False, DDR5, "Dual-channel DDR5-4800: 2 × 4.8 GT/s × 8 bytes = 76.8 GB/s.", ram, 32),
        cpu("cpu-ddr5-5600", "CPU only · DDR5-5600", 89.6, True, DDR5, "Dual-channel DDR5-5600: 2 × 5.6 GT/s × 8 bytes = 89.6 GB/s.", ram, 32),
        cpu("cpu-ddr5-6000", "CPU only · DDR5-6000", 96, False, DDR5, "Dual-channel DDR5-6000: 2 × 6.0 GT/s × 8 bytes = 96 GB/s.", ram, 32),
        cpu("cpu-ddr5-6400", "CPU only · DDR5-6400", 102.4, False, DDR5, "Dual-channel DDR5-6400: 2 × 6.4 GT/s × 8 bytes = 102.4 GB/s.", ram, 32),
        cpu(
            "cpu-laptop-lpddr5x",
            "Laptop CPU · LPDDR5X",
            120,
            False,
            DDR5,
            "Rough class for a 128-bit LPDDR5X laptop (about 120 GB/s). Real bandwidth depends on the bus width.",
            [16, 32, 64],
            32,
        ),
    ]

    slugs = [row["slug"] for row in rows]
    if len(slugs) != len(set(slugs)):
        raise SystemExit("duplicate hardware slug")
    for row in rows:
        if row["kind"] == "gpu" and not row["vramGb"]:
            raise SystemExit(f"gpu missing vram {row['slug']}")
        if row["kind"] != "gpu" and not row["memoryOptionsGb"]:
            raise SystemExit(f"pool missing options {row['slug']}")
        if row["defaultMemoryGb"] <= 0 or row["bandwidthGBps"] <= 0:
            raise SystemExit(f"bad numbers {row['slug']}")
    return rows


def main() -> None:
    rows = build()
    OUT.write_text(json.dumps(rows, indent=2) + "\n")
    print(f"wrote {len(rows)} devices to {OUT}")


if __name__ == "__main__":
    main()
