"""How to use the GPU this process was given: device, precision, memory strategy.

Decided once at start-up from what the hardware reports, so a user never has
to know what bf16 or offloading is. Every choice can be overridden with an
environment variable for the cases a heuristic gets wrong.

    LATENTRY_DEVICE   cuda | mps | cpu        (default: the best available)
    LATENTRY_DTYPE    bf16 | fp16 | fp32      (default: bf16 where supported)
    LATENTRY_OFFLOAD  none | model | sequential (default: by VRAM)
    LATENTRY_MAX_BATCH  images generated together (default: by VRAM)
    LATENTRY_VRAM_FRACTION  share of the GPU's memory this process may take
                            (default: what was free at start, less a margin)

Memory is judged by what is *free* when the engine starts, not the card's
size: another program (a second web UI, a game) may hold part of it.

The allocator is capped at that amount. Without a cap, the Windows NVIDIA
driver lets a process run past its VRAM into system RAM ("sysmem fallback")
instead of failing: nothing breaks, but generation gets several times
slower and the out-of-memory retry never triggers. Measured on a 16 GB
card, SDXL at 832x1216 went from 8 s an image to 43 s in a batch of four.

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
    vram_gib: float  # usable: free at start, within the cap
    total_gib: float
    offload: str  # none | model | sequential
    max_batch: int
    max_pose_batch: int  # the same with SDXL's pose ControlNet (2.5 GB) also on the GPU

    def describe(self) -> dict:
        return {
            "device": self.device,
            "name": self.name,
            "vram_gib": round(self.vram_gib, 1),
            "total_gib": round(self.total_gib, 1),
            "dtype": str(self.dtype).replace("torch.", ""),
            "offload": self.offload,
            "max_batch": self.max_batch,
            "max_pose_batch": self.max_pose_batch,
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


MARGIN_GIB = 0.75  # left for the display, the driver and other programs' growth


def _vram(device: str) -> tuple[str, float, float]:
    """The GPU's name, the memory this process may use, and its total, in GiB."""
    if device == "cuda":
        props = torch.cuda.get_device_properties(0)
        total = props.total_memory / GIB
        wanted = os.environ.get("LATENTRY_VRAM_FRACTION", "").strip()
        try:
            fraction = float(wanted) if wanted else None
        except ValueError:
            fraction = None
        if fraction is None or not 0.1 <= fraction <= 1:
            free, _ = torch.cuda.mem_get_info(0)
            fraction = max(0.1, min(0.95, (free / GIB - MARGIN_GIB) / total))
        # Past this, allocation fails with an out-of-memory error the engine
        # can act on, instead of spilling into system RAM.
        torch.cuda.set_per_process_memory_fraction(fraction, 0)
        return props.name, total * fraction, total
    if device == "mps":
        return "Apple GPU", 0.0, 0.0
    return "CPU", 0.0, 0.0


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


CONTROLNET_GIB = 2.5  # xinsir/controlnet-openpose-sdxl-1.0 in half precision


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
    name, vram_gib, total_gib = _vram(device)
    offload = _pick_offload(device, vram_gib)
    if device == "cuda":
        # Free speed on tensor cores, at a precision diffusion does not notice.
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
    return GpuPlan(
        device,
        dtype,
        name,
        vram_gib,
        total_gib,
        offload,
        _pick_batch(device, vram_gib, offload),
        _pick_batch(device, vram_gib - CONTROLNET_GIB, offload),
    )
