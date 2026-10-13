"""Pose control's first-use downloads: from a fixed commit, checked against a
SHA-256, against a stand-in for huggingface_hub that records what it is asked.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import huggingface_hub
import pytest

from latentry_engine import pose_control

GOOD = b"pinned weights"
GOOD_SHA256 = hashlib.sha256(GOOD).hexdigest()
REVISION = "0" * 40


@pytest.fixture
def hub(monkeypatch: pytest.MonkeyPatch):
    """Stands in for hf_hub_download: writes `served` into local_dir, as the real one does."""
    calls: list[dict] = []
    state = {"served": GOOD}

    def fake(repo_id: str, filename: str, *, revision: str, local_dir: Path) -> str:
        calls.append({"repo": repo_id, "filename": filename, "revision": revision})
        path = Path(local_dir) / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(state["served"])
        return str(path)

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", fake)
    monkeypatch.setattr(pose_control, "_checked", set())
    return calls, state


def test_a_matching_file_is_used_without_a_download(tmp_path: Path, hub) -> None:
    calls, _ = hub
    (tmp_path / "w.safetensors").write_bytes(GOOD)
    assert pose_control.pinned_download("o/r", REVISION, "w.safetensors", GOOD_SHA256, tmp_path) == tmp_path / "w.safetensors"
    assert calls == []


def test_a_file_that_does_not_match_is_fetched_again_from_the_pinned_commit(tmp_path: Path, hub) -> None:
    calls, _ = hub
    (tmp_path / "w.safetensors").write_bytes(b"from main, before the pin")
    path = pose_control.pinned_download("o/r", REVISION, "w.safetensors", GOOD_SHA256, tmp_path)
    assert path.read_bytes() == GOOD
    assert calls == [{"repo": "o/r", "filename": "w.safetensors", "revision": REVISION}]


def test_a_download_that_does_not_match_is_removed_and_refused(tmp_path: Path, hub) -> None:
    _, state = hub
    state["served"] = b"something else"
    with pytest.raises(RuntimeError, match="pinned SHA-256") as caught:
        pose_control.pinned_download("o/r", REVISION, "w.safetensors", GOOD_SHA256, tmp_path)
    assert not (tmp_path / "w.safetensors").exists()
    # The message names the repository file, never a folder on this machine.
    assert str(tmp_path) not in str(caught.value)


def test_a_checked_file_is_not_hashed_again(tmp_path: Path, hub, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "w.safetensors").write_bytes(GOOD)
    pose_control.pinned_download("o/r", REVISION, "w.safetensors", GOOD_SHA256, tmp_path)
    monkeypatch.setattr(pose_control, "sha256_of", lambda _path: pytest.fail("hashed twice"))
    pose_control.pinned_download("o/r", REVISION, "w.safetensors", GOOD_SHA256, tmp_path)


def test_the_pins_are_well_formed() -> None:
    commit, sha256 = re.compile(r"[0-9a-f]{40}"), re.compile(r"[0-9a-f]{64}")
    assert commit.fullmatch(pose_control.ANIMA_ADAPTER_REVISION)
    assert commit.fullmatch(pose_control.SDXL_CONTROLNET_REVISION)
    assert sha256.fullmatch(pose_control.ANIMA_ADAPTER_SHA256)
    assert set(pose_control.SDXL_CONTROLNET_FILES) == {"config.json", "diffusion_pytorch_model.safetensors"}
    assert all(sha256.fullmatch(value) for value in pose_control.SDXL_CONTROLNET_FILES.values())
