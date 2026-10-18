"""The loaded model and generating with it.

One model at a time, kept on the GPU between runs (loading is the slow part).
How each family is loaded, and the img2img / inpaint / pose pipelines made
from its weights, are in pipelines.py; pictures in and out in pictures.py.

Pose control (pose_control.py) follows a skeleton poseorbit drew: SDXL
through an OpenPose ControlNet pipeline built from the same weights, Anima
through a LoRA adapter put on for the run only. The prompt's own LoRAs
(loras.py) are on for the run only too; the last few used stay in the
model switched off, so calling them again is quick.
"""

from __future__ import annotations

import contextlib
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import torch
from PIL import Image, ImageFilter
from poseorbit import letterbox

from . import loras, pipelines, pose_control, samplers
from .gpu import GpuPlan
from .models import FAMILY_ANIMA, FAMILY_SDXL, ModelInfo
from .pictures import (
    encode_png,
    fit_to_image,
    flatten,
    hires_schedule,
    hires_size,
    img2img_steps,
    mask_from_alpha,
    snap,
)

# The only upscaler: no model to fetch or trust, and the same as Latentry's default.
UPSCALERS = ["Lanczos"]
from .pipelines import EngineError, Loaded
from .prompts import encode_sdxl

Emit = Callable[[str, dict], None]


class Cancelled(Exception):
    pass


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
    # Drawn by poseorbit in this model's style (Engine.pose_style), at any
    # size: it is letterboxed onto the run's.
    pose_skeleton: Image.Image | None = None
    pose_strength: float = 1.0
    # Hires fix (txt2img only): each picture upscaled by hr_scale with Lanczos,
    # then redrawn for hr_steps (0: as many as the first pass) at hr_denoise.
    hr_scale: float | None = None
    hr_steps: int = 0
    hr_denoise: float = 0.4
    # Resolved by loras.resolve, and already taken out of `prompt`.
    loras: list[loras.LoraCall] = field(default_factory=list)
    # Say each LoRA's hash in the image events (A1111's "Lora hashes").
    lora_hashes: bool = False


def _tile_large(vae, width: int, height: int) -> None:
    """Large canvases decode tile by tile; small ones in one go (faster)."""
    if width * height > 1536 * 1536:
        vae.enable_tiling()
    else:
        vae.disable_tiling()


def _with_loras(emit: Emit, applied: list[dict]) -> Emit:
    """`emit` that adds the applied LoRAs to each image event."""

    def wrapped(event: str, data: dict) -> None:
        emit(event, {**data, "loras": applied} if event == "image" else data)

    return wrapped


class Engine:
    def __init__(self, plan: GpuPlan, controls_dir: Path):
        self.plan = plan
        # Where pose control's weights are kept (<models>/controls).
        self.controls_dir = controls_dir
        self.loaded: Loaded | None = None
        self.loading: str | None = None
        self.load_error: str | None = None
        self._load_lock = threading.Lock()
        # Starts at the plan's estimate; shrinks if the GPU says otherwise.
        self.batch_size = plan.max_batch
        self.pose_batch_size = plan.max_pose_batch

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
                if info.family == FAMILY_SDXL:
                    loaded = pipelines.load_sdxl(info, self.plan, self.controls_dir)
                else:
                    loaded = pipelines.load_anima(info, self.plan)
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

    def _variant(self, kind: str, pose: bool = False):
        """The pipeline for this kind of run on the loaded model (pipelines.variant)."""
        assert self.loaded
        return pipelines.variant(self.loaded, kind, self.plan, self.controls_dir, pose)

    # ── Capabilities ────────────────────────────────────────────────────────

    def capabilities(self) -> dict:
        family = self.loaded.family if self.loaded else None
        return {
            "img2img": family in (FAMILY_SDXL, FAMILY_ANIMA),
            # Anima's stock pipeline has no inpainting.
            "inpaint": family == FAMILY_SDXL,
            "pose_control": self._pose_supported(),
            "lora": self.loaded is not None,
            "tagger": False,
            "hires": family in (FAMILY_SDXL, FAMILY_ANIMA),
            "upscalers": UPSCALERS,
            # Why each feature is off, for Latentry to show (docs/backend-api.md).
            "unavailable": self._unavailable(family),
        }

    def _unavailable(self, family: str | None) -> dict[str, str]:
        if self.loaded is None:
            reason = "No model is loaded. Choose one in Latentry's settings."
            return {"img2img": reason, "inpaint": reason, "pose": reason, "lora": reason, "hires": reason}
        reasons: dict[str, str] = {}
        if family == FAMILY_ANIMA:
            reasons["inpaint"] = "Anima's pipeline has no inpainting; load an SDXL model to inpaint."
            if not self._pose_supported():
                layers = int(self.loaded.pipe.transformer.config.num_layers)
                reasons["pose"] = (
                    f"This Anima model has {layers} layers; the pose adapter only fits the 28-layer v1.0 models. "
                    "Load a 28-layer Anima v1.0 model or an SDXL model to use pose."
                )
        return reasons

    def _pose_supported(self) -> bool:
        if self.loaded is None:
            return False
        if self.loaded.family == FAMILY_ANIMA:
            return pose_control.anima_supported(self.loaded.pipe)
        return self.loaded.family == FAMILY_SDXL

    def pose_style(self) -> str:
        """How skeletons must be drawn for the loaded model to follow them."""
        return "openpose" if self.loaded is not None and self.loaded.family == FAMILY_SDXL else "dwpose"

    # ── Generating ──────────────────────────────────────────────────────────

    def generate(self, request: GenerateRequest, emit: Emit, cancel: threading.Event, run_id: str) -> None:
        if not self.loaded:
            raise EngineError("No model is loaded. Choose one in Latentry's settings.")
        if not request.prompt.strip():
            raise EngineError("A prompt is required.")
        if request.mask is not None and not self.capabilities()["inpaint"]:
            raise EngineError("This model cannot inpaint.")
        if request.pose_skeleton is not None and not self._pose_supported():
            raise EngineError("This model cannot follow a pose (Anima needs a 28-layer v1.0 model).")
        if request.hr_scale is not None and request.init_image is not None:
            raise EngineError("Hires fix redraws a picture drawn from the prompt; it does not go with a source image.")
        if request.hr_scale is not None and request.pose_skeleton is not None and self.loaded.family == FAMILY_ANIMA:
            # The pose adapter adds the skeleton at the first pass's size.
            raise EngineError("On Anima, hires fix and a pose do not go together yet. Turn one off, or use an SDXL model.")
        # Worked out before the first step, so a run that cannot read a
        # LoRA's file fails before it starts.
        applied = loras.applied_list(request.loras, request.lora_hashes)
        if applied:
            emit = _with_loras(emit, applied)
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
        pose = request.pose_skeleton is not None
        pipe = self._variant(kind, pose)
        pipe.scheduler = samplers.configure(loaded.base_scheduler, request.sampler, request.scheduler)

        source = flatten(request.init_image) if request.init_image is not None else None
        width, height = (fit_to_image(source, request.width, request.height) if source else (snap(request.width), snap(request.height)))
        if source is not None:
            source = source.resize((width, height), Image.Resampling.LANCZOS)
        mask = mask_from_alpha(request.mask, (width, height)) if request.mask is not None else None
        steps = img2img_steps(request.num_inference_steps, request.strength, loaded.family) if source is not None else request.num_inference_steps
        skeleton = letterbox(request.pose_skeleton, (width, height)) if pose else None

        # Hires fix: the img2img pipeline on the same weights (and LoRAs),
        # asked for a schedule long enough to run the hires steps exactly.
        hires = request.hr_scale is not None and source is None
        hires_steps = 0
        if hires:
            hires_width, hires_height = hires_size(width, height, request.hr_scale)
            hires_schedule_steps = hires_schedule(request.hr_steps or request.num_inference_steps, request.hr_denoise, loaded.family)
            hires_steps = img2img_steps(hires_schedule_steps, request.hr_denoise, loaded.family)
            hires_pipe = self._variant("img2img", pose)
            hires_pipe.scheduler = samplers.configure(loaded.base_scheduler, request.sampler, request.scheduler)
            hires_skeleton = letterbox(request.pose_skeleton, (hires_width, hires_height)) if pose else None
        total_steps = steps + hires_steps

        _tile_large(pipe.vae, width, height)

        with loaded.lora_keeper.applied(pipe, request.loras):
            device = getattr(pipe, "_execution_device", self.plan.device)
            embeds = encode_sdxl(pipe, request.prompt, request.negative_prompt, device)
            seeds = self._seeds(request)
            generator_device = "cpu" if self.plan.offload != "none" else self.plan.device
            done = 0
            # With hires fix, one picture at a time: each gets its second pass
            # before the next, and only one large canvas is on the GPU.
            batch_size = 1 if hires else self.pose_batch_size if pose else self.batch_size
            while done < len(seeds):
                batch = seeds[done : done + batch_size]
                emit("start", {"index": done, "total": len(seeds), "steps": total_steps, "run_id": run_id})

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
                if skeleton is not None:
                    # txt2img takes the control picture as `image`; the others use that for the source.
                    arguments["image" if source is None else "control_image"] = skeleton
                    arguments["controlnet_conditioning_scale"] = request.pose_strength
                started = time.time()
                try:
                    images = pipe(**arguments).images
                except torch.cuda.OutOfMemoryError:
                    # Whatever else is on the GPU decides what fits; halve the
                    # batch and try the same images again, down to one at a time.
                    torch.cuda.empty_cache()
                    if len(batch) == 1:
                        raise
                    batch_size = max(1, len(batch) // 2)
                    if pose:
                        self.pose_batch_size = batch_size
                    else:
                        self.batch_size = batch_size
                    print(f"[engine] out of memory at batch {len(batch)}; now {batch_size}", flush=True)
                    continue
                if cancel.is_set():
                    raise Cancelled()
                if hires:
                    seed = batch[0]

                    def on_hires_step(pipeline, step, timestep, kwargs, first=done):
                        if cancel.is_set():
                            pipeline._interrupt = True
                        emit("step", {"index": first, "step": steps + step + 1})
                        return kwargs

                    hires_arguments = {
                        **embeds,
                        "image": images[0].resize((hires_width, hires_height), Image.Resampling.LANCZOS),
                        "strength": request.hr_denoise,
                        "num_inference_steps": hires_schedule_steps,
                        "guidance_scale": request.guidance_scale,
                        "generator": torch.Generator(generator_device).manual_seed(seed),
                        "callback_on_step_end": on_hires_step,
                    }
                    if hires_skeleton is not None:
                        hires_arguments.update(control_image=hires_skeleton, controlnet_conditioning_scale=request.pose_strength)
                    _tile_large(hires_pipe.vae, hires_width, hires_height)
                    try:
                        images = hires_pipe(**hires_arguments).images
                    finally:
                        _tile_large(pipe.vae, width, height)
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
                        "steps_observed": total_steps,
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
        steps = img2img_steps(request.num_inference_steps, request.strength, loaded.family) if source is not None else request.num_inference_steps
        hires = request.hr_scale is not None and source is None
        hires_steps = 0
        if hires:
            hires_width, hires_height = hires_size(width, height, request.hr_scale, 16)
            hires_schedule_steps = hires_schedule(request.hr_steps or request.num_inference_steps, request.hr_denoise, loaded.family)
            hires_steps = img2img_steps(hires_schedule_steps, request.hr_denoise, loaded.family)
        total_steps = steps + hires_steps

        guider = getattr(pipe, "guider", None)
        if guider is not None and hasattr(guider, "guidance_scale"):
            guider.guidance_scale = float(request.guidance_scale)
        # The modular pipeline has no step callback; count the transformer's
        # forward passes instead (one per guidance condition per step).
        per_step = max(1, int(getattr(guider, "num_conditions", 1) or 1))
        # `offset`: the steps already run for this picture (hires fix's second pass follows the first).
        state = {"forwards": 0, "index": 0, "offset": 0}

        def hook(module, args):
            if cancel.is_set():
                raise Cancelled()
            state["forwards"] += 1
            if state["forwards"] % per_step == 0:
                emit("step", {"index": state["index"], "step": state["offset"] + state["forwards"] // per_step})

        scopes = contextlib.ExitStack()
        try:
            if request.pose_skeleton is not None:
                if loaded.pose_adapter is None:
                    loaded.pose_adapter = pose_control.AnimaPoseAdapter(pipe, self.controls_dir)
                # Once around all the images: loading the LoRA is the slow part.
                skeleton = letterbox(request.pose_skeleton, (width, height))
                scopes.enter_context(loaded.pose_adapter.applied(skeleton, request.pose_strength))
            # After the pose adapter, so it stays on beside the prompt's LoRAs.
            scopes.enter_context(loaded.lora_keeper.applied(pipe, request.loras))
        except BaseException:
            # A LoRA that would not load must not leave the pose adapter on.
            scopes.close()
            raise
        handle = pipe.transformer.register_forward_pre_hook(hook)
        try:
            seeds = self._seeds(request)
            for index, seed in enumerate(seeds):
                state.update(forwards=0, index=index, offset=0)
                emit("start", {"index": index, "total": len(seeds), "steps": total_steps, "run_id": run_id})
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
                if hires:
                    state.update(forwards=0, offset=steps)
                    output = pipe(
                        **{
                            **arguments,
                            "width": hires_width,
                            "height": hires_height,
                            "image": image.resize((hires_width, hires_height), Image.Resampling.LANCZOS),
                            "strength": request.hr_denoise,
                            "num_inference_steps": hires_schedule_steps,
                            "generator": torch.Generator(self.plan.device).manual_seed(seed),
                        }
                    )
                    image = output.images[0] if hasattr(output, "images") else output.get("images")[0]
                emit("image", {
                    "index": index,
                    "total": len(seeds),
                    "seed": seed,
                    "image_base64": encode_png(image),
                    "steps_observed": total_steps,
                    "timings": {"image": time.time() - started},
                })
        finally:
            handle.remove()
            scopes.close()
