"""The loaded model and generating with it.

One model at a time, kept on the GPU between runs (loading is the slow part).
SDXL runs on the stock StableDiffusionXL pipelines; img2img and inpainting
are derived from the same weights with from_pipe, so they cost no extra VRAM.
Anima runs on its stock modular pipeline.
"""

from __future__ import annotations

import base64
import io
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import torch
from PIL import Image, ImageFilter

from . import samplers
from .gpu import GpuPlan
from .models import FAMILY_ANIMA, FAMILY_SDXL, ModelInfo
from .prompts import encode_sdxl

Emit = Callable[[str, dict], None]


class Cancelled(Exception):
    pass


class EngineError(Exception):
    """A refusal worth showing the user as is."""


@dataclass
class GenerateRequest:
    prompt: str
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    seed: int = -1
    image_count: int = 1
    sampler: str = samplers.DEFAULT
    scheduler: str = samplers.DEFAULT
    num_inference_steps: int = 28
    guidance_scale: float = 6.0
    init_image: Image.Image | None = None
    strength: float = 0.6
    mask: Image.Image | None = None
    mask_blur: float = 4


@dataclass
class Loaded:
    info: ModelInfo
    family: str
    pipe: object
    base_scheduler: object
    variants: dict = field(default_factory=dict)


def decode_image(data: str) -> Image.Image:
    if data.startswith("data:"):
        data = data.split(",", 1)[1]
    image = Image.open(io.BytesIO(base64.b64decode(data)))
    image.load()
    return image


def encode_png(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def flatten(image: Image.Image) -> Image.Image:
    """RGB, with transparency on white (what an illustration's empty background means)."""
    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
        background = Image.new("RGB", image.size, (255, 255, 255))
        background.paste(image, mask=image.getchannel("A"))
        return background
    return image.convert("RGB")


def mask_from_alpha(mask: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Latentry's mask: painted (opaque) pixels are redrawn. As L, white = redraw."""
    mask = mask.convert("RGBA").getchannel("A") if mask.mode in ("RGBA", "LA", "P") else mask.convert("L")
    return mask.resize(size, Image.Resampling.LANCZOS)


def snap(value: float, multiple: int = 8) -> int:
    return max(256, min(2048, int(round(value / multiple)) * multiple))


def fit_to_image(source: Image.Image, width: int, height: int, multiple: int = 8) -> tuple[int, int]:
    """The source's aspect ratio at the requested pixel area (Latentry's fitToImage)."""
    area = max(256 * 256, width * height)
    aspect = source.width / source.height
    fitted_height = (area / aspect) ** 0.5
    return snap(fitted_height * aspect, multiple), snap(fitted_height, multiple)


def img2img_steps(steps: int, strength: float) -> int:
    init = min(steps * strength, steps)
    return max(1, steps - int(max(steps - init, 0)))


class Engine:
    def __init__(self, plan: GpuPlan):
        self.plan = plan
        self.loaded: Loaded | None = None
        self.loading: str | None = None
        self.load_error: str | None = None
        self._load_lock = threading.Lock()
        # Starts at the plan's estimate; shrinks if the GPU says otherwise.
        self.batch_size = plan.max_batch

    # ── Loading ─────────────────────────────────────────────────────────────

    def load(self, info: ModelInfo) -> None:
        if info.family not in (FAMILY_SDXL, FAMILY_ANIMA):
            raise EngineError(f"{info.name} is not a model this engine can run")
        with self._load_lock:
            self.loading = info.id
            self.load_error = None
            try:
                self.unload()
                started = time.time()
                loaded = self._load_sdxl(info) if info.family == FAMILY_SDXL else self._load_anima(info)
                self.loaded = loaded
                print(f"[engine] loaded {info.id} ({info.family}) in {time.time() - started:.0f}s", flush=True)
            except Exception as error:
                self.load_error = str(error)
                raise
            finally:
                self.loading = None

    def unload(self) -> None:
        self.loaded = None
        import gc

        gc.collect()
        if self.plan.device == "cuda":
            torch.cuda.empty_cache()

    def _place(self, pipe) -> None:
        """Puts a pipeline where the plan says: all on the GPU, or offloaded."""
        if self.plan.offload == "model":
            pipe.enable_model_cpu_offload()
        elif self.plan.offload == "sequential":
            pipe.enable_sequential_cpu_offload()
        else:
            pipe.to(self.plan.device)

    def _load_sdxl(self, info: ModelInfo) -> Loaded:
        from diffusers import StableDiffusionXLPipeline

        dtype = self.plan.dtype
        if info.path.is_file():
            pipe = StableDiffusionXLPipeline.from_single_file(str(info.path), torch_dtype=dtype)
        else:
            pipe = StableDiffusionXLPipeline.from_pretrained(str(info.path), torch_dtype=dtype)
        if dtype == torch.float16:
            # SDXL's VAE overflows in fp16 (black images); the pipeline
            # upcasts it when this is set.
            pipe.vae.config.force_upcast = True
        self._place(pipe)
        pipe.set_progress_bar_config(disable=True)
        return Loaded(info, FAMILY_SDXL, pipe, pipe.scheduler)

    def _load_anima(self, info: ModelInfo) -> Loaded:
        from diffusers.modular_pipelines.modular_pipeline import ModularPipeline

        pipe = ModularPipeline.from_pretrained(str(info.path))
        pipe.load_components(torch_dtype=self.plan.dtype)
        # Modular pipelines move as a whole; the offload hooks of the classic
        # pipelines do not apply, so only the all-on-GPU plan is offered.
        pipe.to(self.plan.device)
        return Loaded(info, FAMILY_ANIMA, pipe, pipe.scheduler)

    def _variant(self, kind: str):
        """The txt2img pipeline, or img2img / inpaint built on its weights."""
        assert self.loaded
        loaded = self.loaded
        if kind == "txt2img":
            return loaded.pipe
        if kind not in loaded.variants:
            from diffusers import AutoPipelineForImage2Image, AutoPipelineForInpainting

            cls = AutoPipelineForImage2Image if kind == "img2img" else AutoPipelineForInpainting
            variant = cls.from_pipe(loaded.pipe)
            variant.set_progress_bar_config(disable=True)
            loaded.variants[kind] = variant
        return loaded.variants[kind]

    # ── Capabilities ────────────────────────────────────────────────────────

    def capabilities(self) -> dict:
        family = self.loaded.family if self.loaded else None
        return {
            "img2img": family in (FAMILY_SDXL, FAMILY_ANIMA),
            # Anima's stock pipeline has no inpainting.
            "inpaint": family == FAMILY_SDXL,
            "pose_control": False,
            "tagger": False,
        }

    # ── Generating ──────────────────────────────────────────────────────────

    def generate(self, request: GenerateRequest, emit: Emit, cancel: threading.Event, run_id: str) -> None:
        if not self.loaded:
            raise EngineError("No model is loaded. Choose one in Latentry's settings.")
        if not request.prompt.strip():
            raise EngineError("A prompt is required.")
        if request.mask is not None and not self.capabilities()["inpaint"]:
            raise EngineError("This model cannot inpaint.")
        if self.loaded.family == FAMILY_SDXL:
            self._generate_sdxl(request, emit, cancel, run_id)
        else:
            self._generate_anima(request, emit, cancel, run_id)

    def _seeds(self, request: GenerateRequest) -> list[int]:
        if request.seed >= 0:
            return [(request.seed + index) % (2**32) for index in range(request.image_count)]
        return [int(torch.randint(0, 2**31 - 1, (1,)).item()) for _ in range(request.image_count)]

    def _generate_sdxl(self, request: GenerateRequest, emit: Emit, cancel: threading.Event, run_id: str) -> None:
        loaded = self.loaded
        assert loaded
        kind = "inpaint" if request.mask is not None else "img2img" if request.init_image is not None else "txt2img"
        pipe = self._variant(kind)
        pipe.scheduler = samplers.configure(loaded.base_scheduler, request.sampler, request.scheduler)

        source = flatten(request.init_image) if request.init_image is not None else None
        width, height = (fit_to_image(source, request.width, request.height) if source else (snap(request.width), snap(request.height)))
        if source is not None:
            source = source.resize((width, height), Image.Resampling.LANCZOS)
        mask = mask_from_alpha(request.mask, (width, height)) if request.mask is not None else None
        steps = img2img_steps(request.num_inference_steps, request.strength) if source is not None else request.num_inference_steps

        # Large canvases decode tile by tile; small ones in one go (faster).
        if width * height > 1536 * 1536:
            pipe.vae.enable_tiling()
        else:
            pipe.vae.disable_tiling()

        device = getattr(pipe, "_execution_device", self.plan.device)
        embeds = encode_sdxl(pipe, request.prompt, request.negative_prompt, device)
        seeds = self._seeds(request)
        generator_device = "cpu" if self.plan.offload != "none" else self.plan.device
        done = 0
        batch_size = self.batch_size
        while done < len(seeds):
            batch = seeds[done : done + batch_size]
            emit("start", {"index": done, "total": len(seeds), "steps": steps, "run_id": run_id})

            def on_step(pipeline, step, timestep, kwargs, first=done):
                if cancel.is_set():
                    pipeline._interrupt = True
                emit("step", {"index": first, "step": step + 1})
                return kwargs

            arguments = {
                **embeds,
                "num_images_per_prompt": len(batch),
                "num_inference_steps": request.num_inference_steps,
                "guidance_scale": request.guidance_scale,
                "generator": [torch.Generator(generator_device).manual_seed(seed) for seed in batch],
                "callback_on_step_end": on_step,
            }
            if source is None:
                arguments.update(width=width, height=height)
            else:
                arguments.update(image=source, strength=request.strength)
                if mask is not None:
                    arguments.update(mask_image=pipe.mask_processor.blur(mask, blur_factor=request.mask_blur) if request.mask_blur else mask, width=width, height=height)
            started = time.time()
            try:
                images = pipe(**arguments).images
            except torch.cuda.OutOfMemoryError:
                # Whatever else is on the GPU decides what fits; halve the
                # batch and try the same images again, down to one at a time.
                torch.cuda.empty_cache()
                if len(batch) == 1:
                    raise
                batch_size = self.batch_size = max(1, len(batch) // 2)
                print(f"[engine] out of memory at batch {len(batch)}; now {batch_size}", flush=True)
                continue
            if cancel.is_set():
                raise Cancelled()
            for offset, (image, seed) in enumerate(zip(images, batch)):
                if mask is not None and source is not None:
                    # Outside the mask, the source's own pixels, exactly.
                    soft = mask.filter(ImageFilter.GaussianBlur(request.mask_blur)) if request.mask_blur else mask
                    image = Image.composite(image.resize(source.size), source, soft)
                emit("image", {
                    "index": done + offset,
                    "total": len(seeds),
                    "seed": seed,
                    "image_base64": encode_png(image),
                    "steps_observed": steps,
                    "timings": {"batch": time.time() - started, "batch_size": len(batch)},
                })
            done += len(batch)
            if cancel.is_set():
                raise Cancelled()

    def _generate_anima(self, request: GenerateRequest, emit: Emit, cancel: threading.Event, run_id: str) -> None:
        loaded = self.loaded
        assert loaded
        pipe = loaded.pipe
        pipe.scheduler = samplers.configure(loaded.base_scheduler, request.sampler, request.scheduler)
        source = flatten(request.init_image) if request.init_image is not None else None
        width, height = fit_to_image(source, request.width, request.height, 16) if source else (snap(request.width, 16), snap(request.height, 16))
        if source is not None:
            source = source.resize((width, height), Image.Resampling.LANCZOS)
        steps = img2img_steps(request.num_inference_steps, request.strength) if source is not None else request.num_inference_steps

        guider = getattr(pipe, "guider", None)
        if guider is not None and hasattr(guider, "guidance_scale"):
            guider.guidance_scale = float(request.guidance_scale)
        # The modular pipeline has no step callback; count the transformer's
        # forward passes instead (one per guidance condition per step).
        per_step = max(1, int(getattr(guider, "num_conditions", 1) or 1))
        state = {"forwards": 0, "index": 0}

        def hook(module, args):
            if cancel.is_set():
                raise Cancelled()
            state["forwards"] += 1
            if state["forwards"] % per_step == 0:
                emit("step", {"index": state["index"], "step": state["forwards"] // per_step})

        handle = pipe.transformer.register_forward_pre_hook(hook)
        try:
            seeds = self._seeds(request)
            for index, seed in enumerate(seeds):
                state.update(forwards=0, index=index)
                emit("start", {"index": index, "total": len(seeds), "steps": steps, "run_id": run_id})
                arguments = {
                    "prompt": request.prompt,
                    "negative_prompt": request.negative_prompt,
                    "width": width,
                    "height": height,
                    "num_inference_steps": request.num_inference_steps,
                    "generator": torch.Generator(self.plan.device).manual_seed(seed),
                }
                if source is not None:
                    arguments.update(image=source, strength=request.strength)
                started = time.time()
                output = pipe(**arguments)
                image = output.images[0] if hasattr(output, "images") else output.get("images")[0]
                emit("image", {
                    "index": index,
                    "total": len(seeds),
                    "seed": seed,
                    "image_base64": encode_png(image),
                    "steps_observed": steps,
                    "timings": {"image": time.time() - started},
                })
        finally:
            handle.remove()
