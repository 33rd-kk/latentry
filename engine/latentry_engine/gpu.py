"""How to use the GPU this process was given: device, precision, memory strategy.

Decided once at start-up from what the hardware reports, so a user never has
to know what bf16 or offloading is. Every choice can be overridden with an
environment variable for the cases a heuristic gets wrong.

    LATENTRY_DEVICE   cuda | mps | cpu        (default: the best available)
    LATENTRY_DTYPE    bf16 | fp16 | fp32      (default: bf16 where supported)
    LATENTRY_OFFLOAD  none | model | sequential (default: by VRAM)
    LATENTRY_MAX_BATCH  images generated together (default: by VRAM)

One engine process drives one GPU: Latentry starts one per GPU with
CUDA_VISIBLE_DEVICES set, so inside the process the GPU is always cuda:0.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import torch

GIB = 1024**3


@dataclass(frozen=True)
class GpuPlan:
    device: str
    dtype: torch.dtype
    name: str
    vram_gib: float
    offload: str  # none | model | sequential
    max_batch: int

    def describe(self) -> dict:
        return {
            "device": self.device,
            "name": self.name,
            "vram_gib": round(self.vram_gib, 1),
            "dtype": str(self.dtype).replace("torch.", ""),
            "offload": self.offload,
            "max_batch": self.max_batch,
        }


def _pick_device() -> str:
    wanted = os.environ.get("LATENTRY_DEVICE", "").strip().lower()
    if wanted:
        return wanted
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _pick_dtype(device: str) -> torch.dtype:
    wanted = os.environ.get("LATENTRY_DTYPE", "").strip().lower()
    if wanted in ("bf16", "bfloat16"):
        return torch.bfloat16
    if wanted in ("fp16", "float16", "half"):
        return torch.float16
    if wanted in ("fp32", "float32"):
        return torch.float32
    if device == "cuda":
        # bf16 keeps fp32's range, so SDXL's VAE does not overflow into black
        # images; Ampere (8.x) and newer run it at full speed.
        return torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    if device == "mps":
        return torch.float16
    return torch.float32


def _vram(device: str) -> tuple[str, float]:
    if device == "cuda":
        props = torch.cuda.get_device_properties(0)
        return props.name, props.total_memory / GIB
    if device == "mps":
        return "Apple GPU", 0.0
    return "CPU", 0.0


def _pick_offload(device: str, vram_gib: float) -> str:
    wanted = os.environ.get("LATENTRY_OFFLOAD", "").strip().lower()
    if wanted in ("none", "model", "sequential"):
        return wanted
    if device != "cuda":
        return "none"
    # An SDXL pipeline is ~7 GB in half precision; generation needs room on top.
    if vram_gib >= 11.5:
        return "none"
    if vram_gib >= 7:
        return "model"
    return "sequential"


def _pick_batch(device: str, vram_gib: float, offload: str) -> int:
    wanted = os.environ.get("LATENTRY_MAX_BATCH", "").strip()
    if wanted.isdigit() and int(wanted) > 0:
        return int(wanted)
    if device != "cuda" or offload != "none":
        return 1
    # Roughly 1.5 GB per extra 1024x1024 SDXL image beyond the weights.
    return max(1, min(8, int((vram_gib - 9) // 1.5) + 1))


def plan() -> GpuPlan:
    device = _pick_device()
    dtype = _pick_dtype(device)
    name, vram_gib = _vram(device)
    offload = _pick_offload(device, vram_gib)
    if device == "cuda":
        # Free speed on tensor cores, at a precision diffusion does not notice.
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
    return GpuPlan(device, dtype, name, vram_gib, offload, _pick_batch(device, vram_gib, offload))
