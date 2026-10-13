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
from .models import (
    FAMILY_ANIMA,
    FAMILY_SDXL,
    ModelInfo,
    pickle_only_parts,
    sdxl_unet_in_channels,
)

# A single-file SDXL checkpoint carries the weights but not the pipeline's
# configs (scheduler, text encoders, tokenizers). Left to itself, diffusers
# fetches them from stabilityai/stable-diffusion-xl-base-1.0's main branch on
# the first load. These are the same files, from a fixed commit, each checked
# against its SHA-256: text only, no weights.
SDXL_CONFIG_REPO = "stabilityai/stable-diffusion-xl-base-1.0"
SDXL_CONFIG_REVISION = "462165984030d82259a11f4367a4eed129e94a7b"
SDXL_CONFIG_FILES = {
    "model_index.json": "6d7b93508390ab91ac5bfbe4aeb4dc2d83f7bb1b05fb069d714b5b0c75f70d44",
    "scheduler/scheduler_config.json": "af3e45a949aff8b8341ab8b811429ec03fee857a700a1d9477363e4fff9666e2",
    "text_encoder/config.json": "39b8b2e4b1949e36969caa425b6c81c68bace99198dd9078ce05d16ad401fe7f",
    "text_encoder_2/config.json": "a892d1c3a69a7e9247a24de2bc1d5891e3109a54696e53be20093af671072c34",
    "tokenizer/merges.txt": "9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a",
    "tokenizer/special_tokens_map.json": "c4864a9376a8401918425bed71fc14fc0e81f9b59ec45c1cf96cccb2df508eac",
    "tokenizer/tokenizer_config.json": "19d7b034cb0cc3ce9766c2231373ab8aa8991fc72e2c8f76558bfaae3de0d563",
    "tokenizer/vocab.json": "e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349",
    "tokenizer_2/merges.txt": "9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a",
    "tokenizer_2/special_tokens_map.json": "f118ab3a983206e4f32583448de6bd6aae4ee21869135cef1f5848a753cdaab6",
    "tokenizer_2/tokenizer_config.json": "c9d23941f76a41cbd50eda9290f57be7828f0a7a677939e9ef181f7e12bd1bdf",
    "tokenizer_2/vocab.json": "e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349",
    "unet/config.json": "30ebc70750223e59006f7f2b4e1e6c102570aa19a9c4ae3e1fbe7591332dbae6",
    "vae/config.json": "0b331c8ac22ded5f9997a144a575c1d113d6169aff262c353f39015bd24a6264",
}


def sdxl_config(controls_dir: Path) -> Path:
    """The pinned SDXL configs in the controls folder, fetched the first time."""
    folder = controls_dir / "sdxl-base-config"
    for filename, sha256 in SDXL_CONFIG_FILES.items():
        pose_control.pinned_download(SDXL_CONFIG_REPO, SDXL_CONFIG_REVISION, filename, sha256, folder)
    return folder


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


def load_sdxl(info: ModelInfo, plan: GpuPlan, controls_dir: Path) -> Loaded:
    from diffusers import StableDiffusionXLPipeline

    dtype = plan.dtype
    if info.path.is_file():
        if sdxl_unet_in_channels(info.path) == 4:
            # The pinned configs (see SDXL_CONFIG_FILES): no Hub lookup at all.
            config = str(sdxl_config(controls_dir))
            pipe = StableDiffusionXLPipeline.from_single_file(str(info.path), config=config, torch_dtype=dtype, local_files_only=True)
        else:
            # An inpainting checkpoint (9 channels) needs another repository's
            # configs, which diffusers picks and fetches itself on the first
            # load, then reads from its cache.
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
