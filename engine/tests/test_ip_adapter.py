"""IP-Adapter on SDXL without a model: when the adapter is put in and taken
out, and what the pipelines are asked for."""

from __future__ import annotations

import contextlib
import threading
from pathlib import Path

import pytest
import torch
from PIL import Image

from latentry_engine import core, ip_adapter
from latentry_engine.core import Engine, EngineError, GenerateRequest
from latentry_engine.gpu import GpuPlan
from latentry_engine.models import FAMILY_ANIMA, FAMILY_SDXL
from latentry_engine.pipelines import Loaded

PLAN = GpuPlan(device="cpu", dtype=torch.float32, name="cpu", vram_gib=0, total_gib=0, offload="none", max_batch=4, max_pose_batch=2)
REFERENCE = Image.new("RGBA", (64, 48), (200, 100, 50, 255))


class StandInPipe:
    def __init__(self, name: str) -> None:
        self.name = name
        self.calls: list[dict] = []
        self.scales: list[float] = []
        self.image_encoder = None
        self.feature_extractor = None
        self.vae = type("Vae", (), {"enable_tiling": lambda self: None, "disable_tiling": lambda self: None})()

    def set_ip_adapter_scale(self, scale) -> None:
        self.scales.append(scale)

    def register_modules(self, **modules) -> None:
        for name, module in modules.items():
            setattr(self, name, module)

    def __call__(self, **arguments):
        self.calls.append(arguments)
        source = arguments.get("image")
        size = source.size if isinstance(source, Image.Image) else (arguments.get("width", 64), arguments.get("height", 64))
        return type("Output", (), {"images": [Image.new("RGB", size) for _ in range(arguments.get("num_images_per_prompt", 1))]})()


@pytest.fixture
def engine(monkeypatch: pytest.MonkeyPatch):
    base = StandInPipe("base")
    pipes: dict[tuple[str, str | None], StandInPipe] = {("txt2img", None): base}
    events: list[str] = []

    def variant(kind, control=None):
        return pipes.setdefault((kind, control), StandInPipe(f"{kind}+{control}"))

    def load(pipe, controls_dir):
        events.append("load")
        pipe.image_encoder, pipe.feature_extractor = "encoder", "extractor"

    def unload(pipe):
        events.append("unload")
        pipe.image_encoder = pipe.feature_extractor = None

    base.unload_ip_adapter = lambda: unload(base)
    engine = Engine(PLAN, Path("controls"))
    engine.loaded = Loaded(info=None, family=FAMILY_SDXL, pipe=base, base_scheduler=None)
    engine.loaded.lora_keeper = type("Keeper", (), {"applied": staticmethod(lambda pipe, calls: contextlib.nullcontext())})()
    monkeypatch.setattr(engine, "_variant", variant)
    monkeypatch.setattr(ip_adapter, "load", load)
    monkeypatch.setattr(core, "encode_sdxl", lambda pipe, prompt, negative, device: {"prompt_embeds": "embeds"})
    monkeypatch.setattr(core.samplers, "configure", lambda base, sampler, schedule, family=None: "scheduler")
    # The engine's own variants, as the cache would hold them.
    engine.loaded.variants = pipes
    return engine, pipes, events


def run(engine: Engine, request: GenerateRequest) -> None:
    engine.generate(request, lambda event, data: None, threading.Event(), "run")


def test_sdxl_offers_it_and_anima_says_why_not(engine) -> None:
    engine, _, _ = engine
    assert engine.capabilities()["ip_adapter"] is True and "ip_adapter" not in engine.capabilities()["unavailable"]
    engine.loaded.family = FAMILY_ANIMA
    engine._pose_supported = lambda: True
    assert engine.capabilities()["ip_adapter"] is False and "SDXL" in engine.capabilities()["unavailable"]["ip_adapter"]
    with pytest.raises(EngineError, match="SDXL"):
        run(engine, GenerateRequest(prompt="x", ip_image=REFERENCE))


def test_a_reference_is_loaded_once_and_passed_with_its_scale(engine) -> None:
    engine, pipes, events = engine
    run(engine, GenerateRequest(prompt="x", width=512, height=512, ip_image=REFERENCE, ip_scale=0.7))
    run(engine, GenerateRequest(prompt="x", width=512, height=512, ip_image=REFERENCE, ip_scale=0.4))
    base = pipes[("txt2img", None)]
    assert events == ["load"]
    assert base.scales == [0.7, 0.4]
    assert [call["ip_adapter_image"].mode for call in base.calls] == ["RGB", "RGB"]


def test_a_run_without_one_takes_it_out_so_it_is_drawn_as_without(engine) -> None:
    engine, pipes, events = engine
    run(engine, GenerateRequest(prompt="x", width=512, height=512, ip_image=REFERENCE))
    run(engine, GenerateRequest(prompt="x", width=512, height=512))
    assert events == ["load", "unload"] and engine.loaded.ip_adapter is False
    assert "ip_adapter_image" not in pipes[("txt2img", None)].calls[-1]
    run(engine, GenerateRequest(prompt="x", width=512, height=512))
    assert events == ["load", "unload"]


def test_other_pipelines_get_the_encoder_and_lose_it_again(engine) -> None:
    engine, pipes, _ = engine
    source = Image.new("RGB", (512, 512))
    run(engine, GenerateRequest(prompt="x", init_image=source, strength=0.5, ip_image=REFERENCE, control_kind="depth", control_image=Image.new("L", (64, 64))))
    union = pipes[("img2img", "union")]
    assert union.image_encoder == "encoder" and "ip_adapter_image" in union.calls[0] and union.calls[0]["control_mode"] == [1]
    run(engine, GenerateRequest(prompt="x", width=512, height=512))
    assert union.image_encoder is None


def test_hires_fix_passes_the_reference_to_its_second_pass(engine) -> None:
    engine, pipes, _ = engine
    run(engine, GenerateRequest(prompt="x", width=512, height=512, num_inference_steps=4, hr_scale=2, hr_denoise=0.4, ip_image=REFERENCE))
    second = pipes[("img2img", None)]
    assert second.image_encoder == "encoder" and "ip_adapter_image" in second.calls[0]


def test_upscale_refuses_a_reference(engine) -> None:
    engine, _, _ = engine
    with pytest.raises(EngineError, match="reference"):
        run(engine, GenerateRequest(prompt="x", init_image=Image.new("RGB", (64, 64)), upscale=True, hr_scale=2, ip_image=REFERENCE))


def test_share_and_unload_hand_the_encoder_over_and_back() -> None:
    base, other = StandInPipe("base"), StandInPipe("other")
    base.image_encoder, base.feature_extractor = "encoder", "extractor"
    ip_adapter.share(base, other)
    ip_adapter.share(base, base)
    assert (other.image_encoder, other.feature_extractor) == ("encoder", "extractor")
    unloaded: list[str] = []
    base.unload_ip_adapter = lambda: unloaded.append("base")
    ip_adapter.unload(base, [base, other])
    assert unloaded == ["base"] and other.image_encoder is None


def test_the_weights_are_pinned() -> None:
    assert ip_adapter.IP_ADAPTER_REVISION == "018e402774aeeddd60609b4ecdb7e298259dc729"
    assert set(ip_adapter.IP_ADAPTER_FILES) == {
        "sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors",
        "models/image_encoder/config.json",
        "models/image_encoder/model.safetensors",
    }
    assert all(len(sha) == 64 for sha in ip_adapter.IP_ADAPTER_FILES.values())
