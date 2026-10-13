"""Loading models: a folder that would read a pickle is refused before anything loads."""

from __future__ import annotations

import re
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


def test_the_sdxl_config_pin_is_well_formed() -> None:
    assert re.fullmatch(r"[0-9a-f]{40}", pipelines.SDXL_CONFIG_REVISION)
    assert all(re.fullmatch(r"[0-9a-f]{64}", value) for value in pipelines.SDXL_CONFIG_FILES.values())
    # Text configs and tokenizers only: never a weight file.
    assert all(name.endswith((".json", ".txt")) for name in pipelines.SDXL_CONFIG_FILES)
    assert {"model_index.json", "unet/config.json", "tokenizer_2/vocab.json"} <= set(pipelines.SDXL_CONFIG_FILES)


def test_sdxl_config_fetches_each_pinned_file_into_the_controls_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str, str, str, Path]] = []
    monkeypatch.setattr(pipelines.pose_control, "pinned_download", lambda *args: calls.append(args))
    folder = pipelines.sdxl_config(tmp_path)
    assert folder == tmp_path / "sdxl-base-config"
    assert [call[2] for call in calls] == list(pipelines.SDXL_CONFIG_FILES)
    assert all(call[:2] == (pipelines.SDXL_CONFIG_REPO, pipelines.SDXL_CONFIG_REVISION) and call[4] == folder for call in calls)
