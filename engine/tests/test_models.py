"""The models folder: telling SDXL and Anima models apart from their headers.

Only the standard library is needed: the .safetensors files here are headers
with no tensors behind them, which is all the scan reads.
"""

from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

from latentry_engine import models


def write_safetensors(path: Path, keys: list[str]) -> Path:
    header = {key: {"dtype": "F16", "shape": [1], "data_offsets": [0, 2]} for key in keys}
    header["__metadata__"] = {"format": "pt"}
    data = json.dumps(header).encode()
    path.write_bytes(struct.pack("<Q", len(data)) + data)
    return path


def write_diffusers(folder: Path, class_name: str) -> Path:
    folder.mkdir()
    (folder / "model_index.json").write_text(json.dumps({"_class_name": class_name}), encoding="utf-8")
    (folder / "unet.bin").write_bytes(b"x" * 10)
    return folder


def test_sdxl_checkpoint_by_its_second_text_encoder(tmp_path: Path) -> None:
    sdxl = write_safetensors(tmp_path / "sdxl.safetensors", ["conditioner.embedders.1.model.ln_final.weight", "model.diffusion_model.out.0.weight"])
    other = write_safetensors(tmp_path / "sd15.safetensors", ["cond_stage_model.transformer.text_model.final_layer_norm.weight"])
    assert models._checkpoint_family(sdxl) == models.FAMILY_SDXL
    assert models._checkpoint_family(other) is None


def test_metadata_is_not_a_tensor(tmp_path: Path) -> None:
    path = write_safetensors(tmp_path / "a.safetensors", ["a", "b"])
    assert models._safetensors_keys(path) == ["a", "b"]


def test_broken_or_oversized_headers_are_no_family(tmp_path: Path) -> None:
    truncated = tmp_path / "truncated.safetensors"
    truncated.write_bytes(b"\x01\x02")
    not_json = tmp_path / "not-json.safetensors"
    not_json.write_bytes(struct.pack("<Q", 4) + b"nope")
    huge = tmp_path / "huge.safetensors"
    huge.write_bytes(struct.pack("<Q", 200_000_000) + b"{}")
    for path in (truncated, not_json, huge):
        assert models._checkpoint_family(path) is None


def test_diffusers_folders_by_pipeline_class(tmp_path: Path) -> None:
    assert models._diffusers_family(write_diffusers(tmp_path / "xl", "StableDiffusionXLPipeline")) == models.FAMILY_SDXL
    assert models._diffusers_family(write_diffusers(tmp_path / "anima", "AnimaPipeline")) == models.FAMILY_ANIMA
    assert models._diffusers_family(write_diffusers(tmp_path / "flux", "FluxPipeline")) is None


def test_scan_lists_models_by_name_and_skips_the_rest(tmp_path: Path) -> None:
    write_safetensors(tmp_path / "Zeta.safetensors", ["conditioner.embedders.1.x"])
    write_safetensors(tmp_path / "alpha.safetensors", ["something.else"])
    write_safetensors(tmp_path / ".hidden.safetensors", ["conditioner.embedders.1.x"])
    write_diffusers(tmp_path / "anima-folder", "AnimaPipeline")
    (tmp_path / "notes.txt").write_text("not a model", encoding="utf-8")
    (tmp_path / "empty-folder").mkdir()

    found = models.scan(tmp_path)
    assert [model.id for model in found] == ["alpha.safetensors", "anima-folder", "Zeta.safetensors"]
    assert [model.family for model in found] == [None, models.FAMILY_ANIMA, models.FAMILY_SDXL]
    assert found[1].size_bytes == 10 + len((tmp_path / "anima-folder" / "model_index.json").read_bytes())


def test_find_and_a_missing_folder(tmp_path: Path) -> None:
    write_safetensors(tmp_path / "one.safetensors", ["conditioner.embedders.1.x"])
    assert models.find(tmp_path, "one.safetensors") is not None
    assert models.find(tmp_path, "two.safetensors") is None
    assert models.scan(tmp_path / "missing") == []


# ── Downloads are checked against their pins ──

COMMIT = "0123456789abcdef0123456789abcdef01234567"


class FakeResponse:
    def __init__(self, body: bytes) -> None:
        self.body = body
        self.status_code = 200
        self.headers = {"content-length": str(len(body))}

    def __enter__(self):
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def raise_for_status(self) -> None:
        return None

    def iter_content(self, chunk_size: int):
        yield self.body


def fetch_one_file(tmp_path: Path, monkeypatch, body: bytes, sha256: str) -> tuple[models.Download, list[str]]:
    import huggingface_hub
    import requests

    asked: list[str] = []
    monkeypatch.setattr(huggingface_hub, "hf_hub_url", lambda repo, filename, revision: f"https://hf.example/{repo}/resolve/{revision}/{filename}")
    monkeypatch.setattr(requests, "get", lambda url, **kwargs: asked.append(url) or FakeResponse(body))
    downloads = models.Downloads(tmp_path)
    item = models.Download("one", "owner/name", "model.safetensors", COMMIT, sha256)
    downloads._run(item)
    return item, asked


def test_a_single_file_is_kept_only_when_its_hash_matches(tmp_path: Path, monkeypatch) -> None:
    body = b"weights"
    item, asked = fetch_one_file(tmp_path, monkeypatch, body, hashlib.sha256(body).hexdigest())
    assert item.state == "done" and (tmp_path / "model.safetensors").read_bytes() == body
    assert asked == [f"https://hf.example/owner/name/resolve/{COMMIT}/model.safetensors"], "the pinned commit, not main"


def test_a_single_file_with_the_wrong_hash_leaves_nothing(tmp_path: Path, monkeypatch) -> None:
    item, _ = fetch_one_file(tmp_path, monkeypatch, b"tampered", hashlib.sha256(b"weights").hexdigest())
    assert item.state == "error" and "SHA-256" in (item.error or "")
    assert list(tmp_path.iterdir()) == []


def test_verify_files_removes_what_does_not_match(tmp_path: Path) -> None:
    (tmp_path / "unet").mkdir()
    (tmp_path / "unet" / "good.safetensors").write_bytes(b"good")
    (tmp_path / "unet" / "bad.safetensors").write_bytes(b"bad")
    expected = {
        "unet/good.safetensors": hashlib.sha256(b"good").hexdigest(),
        "unet/bad.safetensors": hashlib.sha256(b"something else").hexdigest(),
        "unet/missing.safetensors": hashlib.sha256(b"x").hexdigest(),
    }
    assert models.verify_files(tmp_path, expected) == ["unet/bad.safetensors", "unet/missing.safetensors"]
    assert (tmp_path / "unet" / "good.safetensors").exists()
    assert not (tmp_path / "unet" / "bad.safetensors").exists()


def test_start_refuses_a_branch_or_a_file_without_its_hash(tmp_path: Path) -> None:
    downloads = models.Downloads(tmp_path)
    for args in [("owner/name", None, "main"), ("owner/name", "model.safetensors", COMMIT), ("owner/name", "model.safetensors", COMMIT, "abc")]:
        try:
            downloads.start(*args)
        except ValueError:
            continue
        raise AssertionError(f"started {args}")
    assert downloads.items == {}
