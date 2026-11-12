"""Inpainting on Anima without a model: diffusers' own flow-match scheduler,
stepped the way Anima's img2img steps it, with made-up model outputs.
"""

from __future__ import annotations

import contextlib
import threading
from pathlib import Path

import numpy as np
import pytest
import torch
from diffusers import FlowMatchEulerDiscreteScheduler
from PIL import Image

from latentry_engine import anima_inpaint, core, pictures
from latentry_engine.core import Engine, GenerateRequest
from latentry_engine.gpu import GpuPlan
from latentry_engine.models import FAMILY_ANIMA
from latentry_engine.pipelines import EngineError, Loaded


def scheduler() -> FlowMatchEulerDiscreteScheduler:
    return FlowMatchEulerDiscreteScheduler(shift=3.0, use_dynamic_shifting=False)


def img2img(scheduler, source: torch.Tensor, steps: int, strength: float, seed: int = 1) -> torch.Tensor:
    """What Anima's img2img does with the scheduler: noise the source once, then step."""
    scheduler.set_timesteps(steps)
    start = steps - int(steps * strength)
    timesteps = scheduler.timesteps[start:]
    scheduler.set_begin_index(start)
    generator = torch.Generator().manual_seed(seed)
    noise = torch.randn(source.shape, generator=generator)
    latents = scheduler.scale_noise(source, timesteps[:1].repeat(source.shape[0]), noise)
    for t in timesteps:
        output = torch.randn(source.shape, generator=generator)
        latents = scheduler.step(output, t, latents, return_dict=False)[0]
    return latents


def half_mask(width: int, height: int) -> Image.Image:
    """The right half painted: white = redraw."""
    mask = Image.new("L", (width, height), 0)
    mask.paste(255, (width // 2, 0, width, height))
    return mask


@pytest.mark.parametrize("shape", [(1, 4, 8, 8), (1, 4, 1, 8, 8)])
@pytest.mark.parametrize("strength", [1.0, 0.6])
def test_outside_the_mask_the_source_comes_back_exactly(shape, strength) -> None:
    source = torch.randn(shape, generator=torch.Generator().manual_seed(0))
    run = scheduler()
    with anima_inpaint.masked(run, half_mask(64, 64)):
        latents = img2img(run, source, steps=12, strength=strength)
    left, right = latents[..., :4], latents[..., 4:]
    assert torch.equal(left, source[..., :4])
    assert not torch.allclose(right, source[..., 4:])


def test_without_the_mask_the_same_run_redraws_everything() -> None:
    source = torch.randn((1, 4, 8, 8), generator=torch.Generator().manual_seed(0))
    latents = img2img(scheduler(), source, steps=12, strength=1.0)
    assert not torch.allclose(latents[..., :4], source[..., :4])


def test_the_scheduler_is_put_back_after_the_run_and_after_an_error() -> None:
    run = scheduler()
    with anima_inpaint.masked(run, half_mask(64, 64)):
        assert "step" in run.__dict__ and "scale_noise" in run.__dict__
    assert "step" not in run.__dict__ and "scale_noise" not in run.__dict__
    with pytest.raises(RuntimeError), anima_inpaint.masked(run, half_mask(64, 64)):
        raise RuntimeError("cancelled")
    assert "step" not in run.__dict__ and "scale_noise" not in run.__dict__
    # Stepping again afterwards is the scheduler's own: nothing of the mask is left.
    source = torch.randn((1, 4, 8, 8), generator=torch.Generator().manual_seed(0))
    assert torch.equal(img2img(run, source, 6, 1.0), img2img(scheduler(), source, 6, 1.0))


def test_a_step_without_a_noised_source_is_refused() -> None:
    run = scheduler()
    run.set_timesteps(4)
    with anima_inpaint.masked(run, half_mask(64, 64)), pytest.raises(EngineError, match="source picture"):
        run.step(torch.zeros(1, 4, 8, 8), run.timesteps[0], torch.zeros(1, 4, 8, 8), return_dict=False)


def test_a_latent_cell_is_redrawn_when_any_of_it_is_painted() -> None:
    mask = Image.new("L", (64, 64), 0)
    mask.paste(255, (9, 9, 11, 11))  # 4 pixels inside cell (1, 1)
    cells = anima_inpaint.latent_mask(mask, (8, 8))
    assert cells[1, 1] == 1 and cells.sum() == 1


# ── Through the engine, with a stand-in Anima pipeline ──────────────────────


class Transformer:
    # 28 layers, as the Anima v1.0 models the pose adapter fits.
    config = type("Config", (), {"num_layers": 28})()

    def register_forward_pre_hook(self, hook):
        return type("Handle", (), {"remove": lambda self: None})()


class StandInAnima:
    """Anima's img2img on 1/8-size latents made from the picture, decoded back by scaling up."""

    def __init__(self) -> None:
        self.scheduler = None
        self.transformer = Transformer()
        self.latents: list[torch.Tensor] = []

    def __call__(self, **arguments):
        image = arguments["image"]
        width, height = image.size
        small = np.asarray(image.convert("L").resize((width // 8, height // 8)), dtype=np.float32)
        source = torch.from_numpy(small).reshape(1, 1, 1, height // 8, width // 8) / 255
        latents = img2img(self.scheduler, source, arguments["num_inference_steps"], arguments["strength"], arguments["generator"].initial_seed())
        self.latents.append((latents, source))
        grey = (latents.clamp(0, 1)[0, 0, 0] * 255).to(torch.uint8).numpy()
        return type("Output", (), {"images": [Image.fromarray(grey, "L").convert("RGB").resize((width, height))]})()


PLAN = GpuPlan(device="cpu", dtype=torch.float32, name="cpu", vram_gib=0, total_gib=0, offload="none", max_batch=4, max_pose_batch=2)


@pytest.fixture
def anima(monkeypatch: pytest.MonkeyPatch):
    pipe = StandInAnima()
    engine = Engine(PLAN, Path("controls"))
    engine.loaded = Loaded(info=None, family=FAMILY_ANIMA, pipe=pipe, base_scheduler=None)
    engine.loaded.lora_keeper = type("Keeper", (), {"applied": staticmethod(lambda pipe, calls: contextlib.nullcontext())})()
    shared = scheduler()
    monkeypatch.setattr(core.samplers, "configure", lambda base, sampler, schedule, family=None: shared)
    return engine, pipe, shared


def test_anima_offers_inpainting(anima) -> None:
    engine, *_ = anima
    capabilities = engine.capabilities()
    assert capabilities["inpaint"] is True and "inpaint" not in capabilities["unavailable"]


def test_an_anima_inpaint_redraws_only_the_mask(anima) -> None:
    engine, pipe, shared = anima
    source = Image.new("RGB", (256, 256), (40, 160, 90))
    mask = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    mask.paste((255, 255, 255, 255), (128, 0, 256, 256))
    events: list[tuple[str, dict]] = []
    request = GenerateRequest(prompt="x", width=256, height=256, seed=3, image_count=2, num_inference_steps=10, init_image=source, strength=1.0, mask=mask, mask_blur=0)
    engine.generate(request, lambda event, data: events.append((event, data)), threading.Event(), "run")
    # In the latents: the left half is the source's, the right half was drawn.
    for latents, start in pipe.latents:
        assert torch.equal(latents[..., :16], start[..., :16])
        assert not torch.allclose(latents[..., 16:], start[..., 16:])
    # In the picture: the left half is the source's pixels, exactly.
    pictures_out = [pictures.decode_image(data["image_base64"]) for event, data in events if event == "image"]
    assert len(pictures_out) == 2
    for picture in pictures_out:
        assert picture.crop((0, 0, 128, 256)).tobytes() == source.crop((0, 0, 128, 256)).tobytes()
    # The shared scheduler is the scheduler's own again.
    assert "step" not in shared.__dict__


def test_an_anima_img2img_without_a_mask_is_unchanged(anima) -> None:
    engine, pipe, _shared = anima
    source = Image.new("RGB", (256, 256), (40, 160, 90))
    request = GenerateRequest(prompt="x", width=256, height=256, seed=3, num_inference_steps=10, init_image=source, strength=1.0)
    engine.generate(request, lambda event, data: None, threading.Event(), "run")
    latents, start = pipe.latents[0]
    assert not torch.allclose(latents[..., :16], start[..., :16])
