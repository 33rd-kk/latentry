"""Hires fix on SDXL, without a model: a stand-in pipeline records what each
pass is asked for, so the second pass's size, schedule, seed and progress
can be checked on the CPU.
"""

from __future__ import annotations

import contextlib
import threading
from pathlib import Path

import pytest
import torch
from PIL import Image

from latentry_engine import core, pictures
from latentry_engine.core import Engine, EngineError, GenerateRequest
from latentry_engine.gpu import GpuPlan
from latentry_engine.models import FAMILY_ANIMA, FAMILY_SDXL
from latentry_engine.pipelines import Loaded


class StandInVae:
    def __init__(self) -> None:
        self.tiled: list[bool] = []

    def enable_tiling(self) -> None:
        self.tiled.append(True)

    def disable_tiling(self) -> None:
        self.tiled.append(False)


class StandInPipe:
    """Runs the steps it would (img2img: only the tail) and answers a grey picture."""

    def __init__(self, vae: StandInVae) -> None:
        self.vae = vae
        self.scheduler = None
        self.calls: list[dict] = []

    def __call__(self, **arguments):
        self.calls.append(arguments)
        source = arguments.get("image")
        runs = arguments["num_inference_steps"]
        if isinstance(source, Image.Image) and "strength" in arguments:
            runs = pictures.img2img_steps(runs, arguments["strength"], FAMILY_SDXL)
        for step in range(runs):
            arguments["callback_on_step_end"](self, step, 0, {})
        size = source.size if isinstance(source, Image.Image) and "strength" in arguments else (arguments["width"], arguments["height"])
        return type("Output", (), {"images": [Image.new("RGB", size, (128, 128, 128))]})()


PLAN = GpuPlan(device="cpu", dtype=torch.float32, name="cpu", vram_gib=0, total_gib=0, offload="none", max_batch=4, max_pose_batch=2)


@pytest.fixture
def engine(monkeypatch: pytest.MonkeyPatch):
    vae = StandInVae()
    first, second = StandInPipe(vae), StandInPipe(vae)
    engine = Engine(PLAN, Path("controls"))
    engine.loaded = Loaded(info=None, family=FAMILY_SDXL, pipe=first, base_scheduler=None)
    engine.loaded.lora_keeper = type("Keeper", (), {"applied": staticmethod(lambda pipe, calls: contextlib.nullcontext())})()
    monkeypatch.setattr(engine, "_variant", lambda kind, pose=False: first if kind == "txt2img" else second)
    monkeypatch.setattr(core, "encode_sdxl", lambda pipe, prompt, negative, device: {"prompt_embeds": "embeds"})
    monkeypatch.setattr(core.samplers, "configure", lambda base, sampler, schedule: "scheduler")
    return engine, first, second, vae


def run(engine: Engine, request: GenerateRequest) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    engine.generate(request, lambda event, data: events.append((event, data)), threading.Event(), "run")
    return events


def test_the_second_pass_redraws_the_upscaled_picture(engine) -> None:
    engine, _first, second, vae = engine
    events = run(engine, GenerateRequest(prompt="x", width=832, height=1216, seed=7, num_inference_steps=20, hr_scale=2, hr_steps=10, hr_denoise=0.4))
    hires = second.calls[0]
    assert hires["image"].size == (1664, 2432)
    assert (hires["strength"], hires["num_inference_steps"]) == (0.4, pictures.hires_schedule(10, 0.4, FAMILY_SDXL))
    assert hires["generator"].initial_seed() == 7 and hires["prompt_embeds"] == "embeds"
    assert second.scheduler == "scheduler"
    # One bar: 20 steps, then the 10 the second pass runs.
    assert [data["steps"] for event, data in events if event == "start"] == [30]
    assert [data["step"] for event, data in events if event == "step"] == list(range(1, 31))
    image = next(data for event, data in events if event == "image")
    assert pictures.decode_image(image["image_base64"]).size == (1664, 2432)
    assert image["steps_observed"] == 30
    # The hires pass always encodes and decodes in tiles; the first pass does not at this size.
    assert vae.tiled == [False, True, False]


def test_hires_fix_takes_one_picture_at_a_time(engine) -> None:
    engine, first, second, _ = engine
    events = run(engine, GenerateRequest(prompt="x", width=512, height=512, seed=3, image_count=3, num_inference_steps=4, hr_scale=2))
    assert [call["num_images_per_prompt"] for call in first.calls] == [1, 1, 1]
    assert [call["generator"].initial_seed() for call in second.calls] == [3, 4, 5]
    # 0 hires steps: as many as the first pass.
    assert [data["steps"] for event, data in events if event == "start"] == [8, 8, 8]
    assert [data["index"] for event, data in events if event == "image"] == [0, 1, 2]


def test_without_hires_fix_nothing_changes(engine) -> None:
    engine, first, second, _ = engine
    events = run(engine, GenerateRequest(prompt="x", width=512, height=512, image_count=3, num_inference_steps=4))
    assert second.calls == [] and [call["num_images_per_prompt"] for call in first.calls] == [3]
    assert [data["steps"] for event, data in events if event == "start"] == [4]


def test_hires_fix_is_refused_where_it_cannot_run(engine) -> None:
    engine, *_ = engine
    with pytest.raises(EngineError, match="source image"):
        run(engine, GenerateRequest(prompt="x", init_image=Image.new("RGB", (64, 64)), hr_scale=2))
    engine.loaded.family = FAMILY_ANIMA
    engine._pose_supported = lambda: True
    with pytest.raises(EngineError, match="Anima"):
        run(engine, GenerateRequest(prompt="x", pose_skeleton=Image.new("RGB", (64, 64)), hr_scale=2))


def test_health_offers_hires_fix_with_lanczos(engine) -> None:
    engine, *_ = engine
    capabilities = engine.capabilities()
    assert (capabilities["hires"], capabilities["upscalers"]) == (True, ["Lanczos"])
