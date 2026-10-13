"""Loading a model into a pipeline, and the pipelines made from its weights.

SDXL runs on the stock StableDiffusionXL pipelines; img2img and inpainting
are derived from the same weights with from_pipe, so they cost no extra VRAM.
Anima runs on its stock modular pipeline. Used by core.py's Engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import torch

from . import pose_control
from .gpu import GpuPlan
from .loras import LoraKeeper
from .models import FAMILY_ANIMA, FAMILY_SDXL, ModelInfo, pickle_only_parts


class EngineError(Exception):
    """A refusal worth showing the user as is."""


@dataclass
class Loaded:
    info: ModelInfo
    family: str
    pipe: object
    base_scheduler: object
    variants: dict = field(default_factory=dict)
    # Pose control, made on the first pose run: SDXL's ControlNet, Anima's adapter.
    controlnet: object = None
    pose_adapter: object = None
    # The prompt LoRAs left in this model's layers between runs.
    lora_keeper: LoraKeeper = field(default_factory=LoraKeeper)


def place(pipe, plan: GpuPlan) -> None:
    """Puts a pipeline where the plan says: all on the GPU, or offloaded."""
    if plan.offload == "model":
        pipe.enable_model_cpu_offload()
    elif plan.offload == "sequential":
        pipe.enable_sequential_cpu_offload()
    else:
        pipe.to(plan.device)


def refuse_pickles(info: ModelInfo) -> None:
    """Stops before loading a folder model that would read a pickle-format file."""
    parts = pickle_only_parts(info.path)
    if parts:
        raise EngineError(
            f"{info.name} has weights only in a pickle format (.bin, .ckpt, .pt) in {', '.join(parts)}; "
            "the engine reads only .safetensors, which cannot run code. Get the .safetensors files for it."
        )


def load_sdxl(info: ModelInfo, plan: GpuPlan) -> Loaded:
    from diffusers import StableDiffusionXLPipeline

    dtype = plan.dtype
    if info.path.is_file():
        # A single file carries the weights but not the pipeline's configs
        # (scheduler, tokenizers), which diffusers takes from the Hub. From
        # its cache once they are there, so a load does not ask the Hub
        # again every time; diffusers still downloads them on the first.
        pipe = StableDiffusionXLPipeline.from_single_file(str(info.path), torch_dtype=dtype, local_files_only=True)
    else:
        refuse_pickles(info)
        pipe = StableDiffusionXLPipeline.from_pretrained(str(info.path), torch_dtype=dtype, use_safetensors=True)
    if dtype == torch.float16:
        # SDXL's VAE overflows in fp16 (black images); the pipeline
        # upcasts it when this is set.
        pipe.vae.config.force_upcast = True
    # Decode a batch one image at a time. Decoding is the memory peak
    # (the VAE often runs in fp32), and doing it all at once is what makes
    # a batch outgrow the GPU: with this, four images at 832x1216 peak
    # where one does.
    pipe.vae.enable_slicing()
    place(pipe, plan)
    pipe.set_progress_bar_config(disable=True)
    return Loaded(info, FAMILY_SDXL, pipe, pipe.scheduler)


def load_anima(info: ModelInfo, plan: GpuPlan) -> Loaded:
    from diffusers.modular_pipelines.modular_pipeline import ModularPipeline

    refuse_pickles(info)
    pipe = ModularPipeline.from_pretrained(str(info.path))
    # The index names each component's Hub repository; without this the
    # weights would be fetched (or looked up in the HF cache) from there
    # instead of read from this folder.
    pipe.load_components(torch_dtype=plan.dtype, pretrained_model_name_or_path=str(info.path))
    missing = [name for name in pipe._component_specs if getattr(pipe, name, None) is None]
    if missing:
        raise EngineError(f"{info.name} is missing {', '.join(missing)}; is the folder complete?")
    # Modular pipelines move as a whole; the offload hooks of the classic
    # pipelines do not apply, so only the all-on-GPU plan is offered.
    pipe.to(plan.device)
    return Loaded(info, FAMILY_ANIMA, pipe, pipe.scheduler)


def variant(loaded: Loaded, kind: str, plan: GpuPlan, controls_dir: Path, pose: bool = False):
    """The txt2img pipeline, or img2img / inpaint built on its weights;
    with `pose`, their ControlNet twins."""
    if pose:
        key = f"{kind}+pose"
        if key not in loaded.variants:
            if loaded.controlnet is None:
                loaded.controlnet = pose_control.load_sdxl_controlnet(controls_dir, plan.dtype)
            made = pose_control.sdxl_pose_pipeline(kind, variant(loaded, kind, plan, controls_dir), loaded.controlnet, plan.dtype)
            if plan.offload == "none":
                loaded.controlnet.to(plan.device)
            else:
                # The ControlNet joins the offload chain; the shared modules
                # keep working for the plain pipelines too.
                place(made, plan)
            loaded.variants[key] = made
        return loaded.variants[key]
    if kind == "txt2img":
        return loaded.pipe
    if kind not in loaded.variants:
        from diffusers import AutoPipelineForImage2Image, AutoPipelineForInpainting

        cls = AutoPipelineForImage2Image if kind == "img2img" else AutoPipelineForInpainting
        made = cls.from_pipe(loaded.pipe)
        made.set_progress_bar_config(disable=True)
        loaded.variants[kind] = made
    return loaded.variants[kind]
