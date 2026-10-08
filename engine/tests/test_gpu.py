"""How much of the GPU the engine plans to use: offload and batch size."""

from __future__ import annotations

import pytest

from latentry_engine import gpu


@pytest.fixture(autouse=True)
def no_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LATENTRY_OFFLOAD", raising=False)
    monkeypatch.delenv("LATENTRY_MAX_BATCH", raising=False)


@pytest.mark.parametrize(
    ("device", "vram", "expected"),
    [
        ("cuda", 16, "none"),
        ("cuda", 11.5, "none"),
        ("cuda", 8, "model"),
        ("cuda", 6, "sequential"),
        ("mps", 0, "none"),
        ("cpu", 0, "none"),
    ],
)
def test_offload_by_vram(device: str, vram: float, expected: str) -> None:
    assert gpu._pick_offload(device, vram) == expected


def test_offload_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LATENTRY_OFFLOAD", " Model ")
    assert gpu._pick_offload("cuda", 24) == "model"
    monkeypatch.setenv("LATENTRY_OFFLOAD", "fast")  # not a mode: ignored
    assert gpu._pick_offload("cuda", 24) == "none"


@pytest.mark.parametrize(
    ("device", "vram", "offload", "expected"),
    [
        ("cuda", 16, "none", 5),
        ("cuda", 24, "none", 8),
        ("cuda", 40, "none", 8),
        ("cuda", 9, "none", 1),
        ("cuda", 16, "model", 1),
        ("cpu", 0, "none", 1),
    ],
)
def test_batch_by_vram(device: str, vram: float, offload: str, expected: int) -> None:
    assert gpu._pick_batch(device, vram, offload) == expected


def test_batch_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LATENTRY_MAX_BATCH", "3")
    assert gpu._pick_batch("cpu", 0, "none") == 3
    monkeypatch.setenv("LATENTRY_MAX_BATCH", "0")  # not a size: ignored
    assert gpu._pick_batch("cpu", 0, "none") == 1
