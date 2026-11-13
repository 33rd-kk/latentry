"""Control pictures (canny, depth, line art) on SDXL, without a model: which
ControlNet a run gets, and what the union pipeline is asked for."""

from __future__ import annotations

import contextlib
import threading
from pathlib import Path

import pytest
import torch
from PIL import Image

from latentry_engine import core, pipelines, pose_control
from latentry_engine.core import Engine, EngineError, GenerateRequest, union_arguments
from latentry_engine.gpu import GpuPlan
from latentry_engine.models import FAMILY_ANIMA, FAMILY_SDXL
from latentry_engine.pipelines import Loaded

PLAN = GpuPlan(device="cpu", dtype=torch.float32, name="cpu", vram_gib=0, total_gib=0, offload="none", max_batch=4, max_pose_batch=2)


class StandInPipe:
    """Records each call and answers a grey picture of the asked size."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.calls: list[dict] = []
        self.vae = type("Vae", (), {"enable_tiling": lambda self: None, "disable_tiling": lambda self: None})()

    def __call__(self, **arguments):
        self.calls.append(arguments)
        source = arguments.get("image")
        size = source.size if isinstance(source, Image.Image) else (arguments.get("width", 64), arguments.get("height", 64))
        count = arguments.get("num_images_per_prompt", 1)
        return type("Output", (), {"images": [Image.new("RGB", size, (128, 128, 128)) for _ in range(count)]})()


@pytest.fixture
def engine(monkeypatch: pytest.MonkeyPatch):
    pipes: dict[tuple[str, str | None], StandInPipe] = {}

    def variant(kind, control=None):
        return pipes.setdefault((kind, control), StandInPipe(f"{kind}+{control}"))

    engine = Engine(PLAN, Path("controls"))
    engine.loaded = Loaded(info=None, family=FAMILY_SDXL, pipe=StandInPipe("base"), base_scheduler=None)
    engine.loaded.lora_keeper = type("Keeper", (), {"applied": staticmethod(lambda pipe, calls: contextlib.nullcontext())})()
    monkeypatch.setattr(engine, "_variant", variant)
    monkeypatch.setattr(core, "encode_sdxl", lambda pipe, prompt, negative, device: {"prompt_embeds": "embeds"})
    monkeypatch.setattr(core.samplers, "configure", lambda base, sampler, schedule, family=None: "scheduler")
    return engine, pipes


def run(engine: Engine, request: GenerateRequest) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    engine.generate(request, lambda event, data: events.append((event, data)), threading.Event(), "run")
    return events


EDGES = Image.new("L", (40, 30), 0)
SKELETON = Image.new("RGB", (40, 60), (0, 0, 0))


def test_sdxl_lists_the_control_kinds_and_anima_says_why_not(engine) -> None:
    engine, _ = engine
    assert engine.capabilities()["control_kinds"] == ["canny", "depth", "lineart"]
    assert "control" not in engine.capabilities()["unavailable"]
    engine.loaded.family = FAMILY_ANIMA
    engine._pose_supported = lambda: True
    assert engine.capabilities()["control_kinds"] == []
    assert "SDXL" in engine.capabilities()["unavailable"]["control"]
    with pytest.raises(EngineError, match="SDXL"):
        run(engine, GenerateRequest(prompt="x", control_kind="canny", control_image=EDGES))


def test_a_control_picture_goes_to_the_union_pipeline_with_its_mode_and_strength(engine) -> None:
    engine, pipes = engine
    run(engine, GenerateRequest(prompt="x", width=512, height=512, control_kind="depth", control_image=EDGES, control_strength=0.7))
    call = pipes[("txt2img", "union")].calls[0]
    assert call["control_mode"] == [1] and call["controlnet_conditioning_scale"] == 0.7
    # Letterboxed onto the run's size, in colour, under control_image (not `image`, even for txt2img).
    assert [picture.size for picture in call["control_image"]] == [(512, 512)] and call["control_image"][0].mode == "RGB"
    assert "image" not in call


def test_with_a_pose_too_both_go_to_the_union_model_each_at_its_own_strength(engine) -> None:
    engine, pipes = engine
    source = Image.new("RGB", (512, 512), (10, 20, 30))
    run(engine, GenerateRequest(prompt="x", init_image=source, strength=0.5, pose_skeleton=SKELETON, pose_strength=1.1, control_kind="canny", control_image=EDGES, control_strength=0.6))
    call = pipes[("img2img", "union2")].calls[0]
    # Flat: diffusers wraps each item for its two union nets itself.
    assert call["control_mode"] == [0, 3]
    assert call["controlnet_conditioning_scale"] == [1.1, 0.6]
    # Both letterboxed onto the run's size: the source fitted to the form's area (1024 x 1024 by default).
    assert [picture.size for picture in call["control_image"]] == [(1024, 1024), (1024, 1024)]
    assert call["image"] is not None and call["strength"] == 0.5


def test_a_pose_alone_keeps_the_openpose_controlnet(engine) -> None:
    engine, pipes = engine
    run(engine, GenerateRequest(prompt="x", width=512, height=512, pose_skeleton=SKELETON))
    assert list(pipes) == [("txt2img", "pose")]
    assert "control_mode" not in pipes[("txt2img", "pose")].calls[0]


def test_hires_fix_letterboxes_the_control_picture_again_for_the_second_pass(engine) -> None:
    engine, pipes = engine
    run(engine, GenerateRequest(prompt="x", width=512, height=512, num_inference_steps=4, hr_scale=2, hr_denoise=0.4, control_kind="lineart", control_image=EDGES))
    second = pipes[("img2img", "union")].calls[0]
    assert [picture.size for picture in second["control_image"]] == [(1024, 1024)] and second["control_mode"] == [3]


def test_upscale_refuses_a_control_picture(engine) -> None:
    engine, _ = engine
    with pytest.raises(EngineError, match="control picture or a reference"):
        run(engine, GenerateRequest(prompt="x", init_image=Image.new("RGB", (64, 64)), upscale=True, hr_scale=2, control_kind="canny", control_image=EDGES))


def test_union_arguments_name_the_kinds_modes() -> None:
    request = GenerateRequest(prompt="x", control_kind="lineart", control_image=EDGES, control_strength=0.9)
    assert union_arguments(None, EDGES, request) == {"control_image": [EDGES], "control_mode": [3], "controlnet_conditioning_scale": 0.9}


# ── The pipeline cache ──────────────────────────────────────────────────────


class Net:
    def __init__(self, name: str) -> None:
        self.name = name
        self.where = "cpu"

    def to(self, device):
        self.where = str(device)
        return self


def test_variants_load_each_controlnet_once_and_keep_only_the_one_in_use_on_the_gpu(monkeypatch: pytest.MonkeyPatch) -> None:
    loads: list[str] = []
    made: list[tuple[str, str]] = []
    monkeypatch.setattr(pose_control, "load_sdxl_controlnet", lambda folder, dtype: loads.append("pose") or Net("pose"))
    monkeypatch.setattr(pose_control, "load_sdxl_union", lambda folder, dtype: loads.append("union") or Net("union"))
    monkeypatch.setattr(pose_control, "sdxl_pose_pipeline", lambda kind, base, net, dtype: made.append((kind, "pose")) or f"{kind}+pose")
    monkeypatch.setattr(pose_control, "sdxl_union_pipeline", lambda kind, base, net, dtype: made.append((kind, type(net).__name__)) or f"{kind}+{type(net).__name__}")
    monkeypatch.setattr("diffusers.models.MultiControlNetUnionModel", lambda nets: type("MultiControlNetUnionModel", (), {"nets": nets})())
    gpu = GpuPlan(device="cuda", dtype=torch.float16, name="gpu", vram_gib=16, total_gib=16, offload="none", max_batch=4, max_pose_batch=2)
    loaded = Loaded(info=None, family=FAMILY_SDXL, pipe="base", base_scheduler=None)

    assert pipelines.variant(loaded, "txt2img", gpu, Path("c"), "union") == "txt2img+Net"
    assert (loaded.union.where, loaded.controlnet) == ("cuda", None)
    assert pipelines.variant(loaded, "txt2img", gpu, Path("c"), "union2") == "txt2img+MultiControlNetUnionModel"
    assert pipelines.variant(loaded, "txt2img", gpu, Path("c"), True) == "txt2img+pose"
    # The pose ControlNet in use: the union one waits on the CPU.
    assert (loaded.controlnet.where, loaded.union.where) == ("cuda", "cpu")
    pipelines.variant(loaded, "txt2img", gpu, Path("c"), "union")
    assert (loaded.controlnet.where, loaded.union.where) == ("cpu", "cuda")
    assert loads == ["union", "pose"]
    assert made == [("txt2img", "Net"), ("txt2img", "MultiControlNetUnionModel"), ("txt2img", "pose")]
    with pytest.raises(ValueError):
        pipelines.variant(loaded, "txt2img", gpu, Path("c"), "blur")


def test_the_union_weights_are_pinned() -> None:
    assert pose_control.SDXL_UNION_REVISION == "801a4a3fa3d4c936f4feea95b98607bc6726f80c"
    assert set(pose_control.SDXL_UNION_FILES) == {"config.json", "diffusion_pytorch_model.safetensors"}
    assert all(len(sha) == 64 for sha in pose_control.SDXL_UNION_FILES.values())
    assert pose_control.UNION_MODES == {"pose": 0, "depth": 1, "canny": 3, "lineart": 3}
