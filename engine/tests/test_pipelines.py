"""Loading models: a folder that would read a pickle is refused before anything loads."""

from __future__ import annotations

from pathlib import Path

import pytest

from latentry_engine import pipelines
from latentry_engine.models import ModelInfo


def test_a_folder_with_pickle_only_weights_is_refused(tmp_path: Path) -> None:
    folder = tmp_path / "model"
    (folder / "unet").mkdir(parents=True)
    (folder / "unet" / "diffusion_pytorch_model.bin").write_bytes(b"x")
    info = ModelInfo("model", "model", None, folder, 1)
    with pytest.raises(pipelines.EngineError, match=r"only in a pickle format .* in unet"):
        pipelines.refuse_pickles(info)

    (folder / "unet" / "diffusion_pytorch_model.safetensors").write_bytes(b"x")
    pipelines.refuse_pickles(info)
