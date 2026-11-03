"""Another VAE and CLIP skip, without a model: the VAE folder, swapping a
pipeline's VAE (with stand-ins), and which CLIP layer the prompt is read from.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
import torch

from latentry_engine import pipelines, prompts, vaes
from latentry_engine.models import FAMILY_ANIMA, FAMILY_SDXL, ModelInfo


def test_the_vae_folder_lists_safetensors_by_name(tmp_path: Path) -> None:
    assert vaes.scan(tmp_path) == []
    folder = vaes.vae_dir(tmp_path)
    (folder / "sub").mkdir(parents=True)
    for name in ["b.safetensors", "A.safetensors", ".hidden.safetensors", "c.ckpt", "sub/d.safetensors"]:
        (folder / name).write_bytes(b"x")
    assert vaes.scan(tmp_path) == ["A.safetensors", "b.safetensors"]
    assert vaes.find(tmp_path, "b.safetensors") == folder / "b.safetensors"
    # Only a name the folder lists: never a path out of it, nor another kind of file.
    for name in ["../b.safetensors", "sub/d.safetensors", "c.ckpt", "B.SAFETENSORS", ""]:
        assert vaes.find(tmp_path, name) is None


class FakeVae:
    def __init__(self, name: str) -> None:
        self.name = name
        self.device = None

    def to(self, device: str) -> FakeVae:
        self.device = device
        return self


class FakePipe:
    def __init__(self, vae: FakeVae) -> None:
        self.vae = vae

    def register_modules(self, **modules) -> None:
        for key, value in modules.items():
            setattr(self, key, value)


def loaded_with(family: str) -> pipelines.Loaded:
    own = FakeVae("own")
    info = ModelInfo("m", "m", family, Path("m.safetensors"), 1)
    loaded = pipelines.Loaded(info, family, FakePipe(own), None, own_vae=own)
    loaded.variants["img2img"] = object()
    return loaded


PLAN = SimpleNamespace(offload="none", device="cuda", dtype=torch.float16)


def test_use_vae_swaps_the_vae_and_remakes_the_variants(tmp_path: Path) -> None:
    loaded = loaded_with(FAMILY_SDXL)
    loads: list[Path] = []

    def load(path: Path, plan, controls_dir) -> FakeVae:
        loads.append(path)
        return FakeVae(path.name)

    pipelines.use_vae(loaded, "fix.safetensors", tmp_path / "fix.safetensors", PLAN, tmp_path, load=load)
    assert loaded.pipe.vae.name == "fix.safetensors" and loaded.pipe.vae.device == "cuda"
    assert loaded.variants == {} and loaded.vae_name == "fix.safetensors"

    # The same one again: nothing is loaded.
    loaded.variants["img2img"] = object()
    pipelines.use_vae(loaded, "fix.safetensors", tmp_path / "fix.safetensors", PLAN, tmp_path, load=load)
    assert len(loads) == 1 and "img2img" in loaded.variants

    # Back to the checkpoint's own, kept all along.
    pipelines.use_vae(loaded, None, None, PLAN, tmp_path, load=load)
    assert loaded.pipe.vae is loaded.own_vae and loaded.vae_name is None and loaded.variants == {}
    assert len(loads) == 1


def test_use_vae_leaves_anima_alone_and_needs_a_file(tmp_path: Path) -> None:
    anima = loaded_with(FAMILY_ANIMA)
    pipelines.use_vae(anima, "fix.safetensors", tmp_path / "fix.safetensors", PLAN, tmp_path, load=lambda *_: pytest.fail("loaded"))
    assert anima.pipe.vae is anima.own_vae

    with pytest.raises(pipelines.EngineError, match="no VAE named"):
        pipelines.use_vae(loaded_with(FAMILY_SDXL), "gone.safetensors", None, PLAN, tmp_path)


class FakeTokenizer:
    bos_token_id, eos_token_id, pad_token_id = 0, 1, 1


class FakeEncoder:
    """Hidden states whose every value says which one it is: 0 the embeddings, then layers 1–12."""

    def __call__(self, ids, output_hidden_states: bool):
        states = tuple(torch.full((1, ids.shape[1], 4), float(layer)) for layer in range(13))
        return SimpleNamespace(hidden_states=states, __getitem__=None)


@pytest.mark.parametrize(("clip_skip", "layer"), [(1, 12), (2, 11), (3, 10), (12, 1), (40, 1), (0, 12)])
def test_clip_skip_counts_layers_from_the_last(clip_skip: int, layer: int) -> None:
    hidden, _ = prompts._encode(FakeEncoder(), FakeTokenizer(), [[5, 6]], "cpu", want_pooled=False, clip_skip=clip_skip)
    assert hidden.flatten()[0].item() == layer


def test_without_clip_skip_sdxl_reads_the_layer_before_the_last() -> None:
    hidden, _ = prompts._encode(FakeEncoder(), FakeTokenizer(), [[5]], "cpu", want_pooled=False)
    assert hidden.flatten()[0].item() == 11
    assert prompts.DEFAULT_CLIP_SKIP == 2
