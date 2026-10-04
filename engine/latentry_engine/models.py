"""The models folder: what is in it, what kind each one is, and downloading more.

Everything the engine can load lives in one folder:

    models/
      some-checkpoint.safetensors      a single-file SDXL checkpoint (A1111/Civitai style)
      some-model/model_index.json      a diffusers-format model (Hugging Face style)

A model's id is its path inside the folder, so the same id means the same
files on every start.
"""

from __future__ import annotations

import json
import os
import struct
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

FAMILY_SDXL = "sdxl"
FAMILY_ANIMA = "anima"


@dataclass
class ModelInfo:
    id: str
    name: str
    family: str | None  # None: found, but not a kind this engine can run
    path: Path
    size_bytes: int

    def describe(self) -> dict:
        return {"id": self.id, "name": self.name, "family": self.family, "size_bytes": self.size_bytes}


def _safetensors_keys(path: Path) -> list[str]:
    """The tensor names in a .safetensors file, from its JSON header only."""
    with path.open("rb") as file:
        (length,) = struct.unpack("<Q", file.read(8))
        if length > 100_000_000:
            return []
        header = json.loads(file.read(length))
    return [key for key in header if key != "__metadata__"]


def _checkpoint_family(path: Path) -> str | None:
    try:
        keys = _safetensors_keys(path)
    except (OSError, ValueError, struct.error):
        return None
    # SDXL checkpoints carry two text encoders under conditioner.embedders.
    if any(key.startswith("conditioner.embedders.1.") for key in keys):
        return FAMILY_SDXL
    return None


INDEX_FILES = ("model_index.json", "modular_model_index.json")


def _diffusers_family(folder: Path) -> str | None:
    for index_file in INDEX_FILES:
        try:
            index = json.loads((folder / index_file).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        name = str(index.get("_class_name", ""))
        if "StableDiffusionXL" in name:
            return FAMILY_SDXL
        if "Anima" in name:
            return FAMILY_ANIMA
    return None


def _folder_size(folder: Path) -> int:
    return sum(file.stat().st_size for file in folder.rglob("*") if file.is_file())


def scan(models_dir: Path) -> list[ModelInfo]:
    found: list[ModelInfo] = []
    if not models_dir.is_dir():
        return found
    for entry in sorted(models_dir.iterdir(), key=lambda item: item.name.lower()):
        if entry.name.startswith("."):
            continue
        if entry.is_file() and entry.suffix.lower() == ".safetensors":
            found.append(ModelInfo(entry.name, entry.stem, _checkpoint_family(entry), entry, entry.stat().st_size))
        elif entry.is_dir() and any((entry / index_file).exists() for index_file in INDEX_FILES):
            found.append(ModelInfo(entry.name, entry.name, _diffusers_family(entry), entry, _folder_size(entry)))
    return found


def find(models_dir: Path, model_id: str) -> ModelInfo | None:
    return next((model for model in scan(models_dir) if model.id == model_id), None)


# ── Downloads ────────────────────────────────────────────────────────────────


@dataclass
class Download:
    id: str
    repo_id: str
    filename: str | None
    state: str = "queued"  # queued | downloading | done | error
    done_bytes: int = 0
    total_bytes: int = 0
    error: str | None = None
    model_id: str | None = None
    started: float = field(default_factory=time.time)

    def describe(self) -> dict:
        return {
            "id": self.id,
            "repo_id": self.repo_id,
            "filename": self.filename,
            "state": self.state,
            "done_bytes": self.done_bytes,
            "total_bytes": self.total_bytes,
            "error": self.error,
            "model_id": self.model_id,
        }


class Downloads:
    """Hugging Face downloads into the models folder, one at a time, with progress."""

    def __init__(self, models_dir: Path):
        self.models_dir = models_dir
        self.items: dict[str, Download] = {}
        self._lock = threading.Lock()

    def start(self, repo_id: str, filename: str | None) -> Download:
        item = Download(uuid.uuid4().hex, repo_id, filename)
        self.items[item.id] = item
        threading.Thread(target=self._run, args=(item,), daemon=True).start()
        return item

    def _run(self, item: Download) -> None:
        with self._lock:
            try:
                item.state = "downloading"
                self.models_dir.mkdir(parents=True, exist_ok=True)
                if item.filename:
                    self._file(item)
                else:
                    self._repo(item)
                item.state = "done"
            except Exception as error:  # noqa: BLE001 - reported to the page as is
                item.state = "error"
                item.error = str(error)

    def _file(self, item: Download) -> None:
        """One file (a single-file checkpoint), streamed so progress is exact."""
        import requests
        from huggingface_hub import hf_hub_url

        url = hf_hub_url(item.repo_id, item.filename)
        headers = {"Authorization": f"Bearer {os.environ['HF_TOKEN']}"} if os.environ.get("HF_TOKEN") else {}
        target = self.models_dir / Path(item.filename).name
        partial = target.with_name(target.name + ".part")
        with requests.get(url, headers=headers, stream=True, timeout=60) as response:
            if response.status_code in (401, 403):
                raise RuntimeError("This model needs a Hugging Face token or accepting its license on huggingface.co (set HF_TOKEN).")
            response.raise_for_status()
            item.total_bytes = int(response.headers.get("content-length") or 0)
            with partial.open("wb") as file:
                for chunk in response.iter_content(chunk_size=1 << 20):
                    file.write(chunk)
                    item.done_bytes += len(chunk)
        partial.replace(target)
        item.model_id = target.name

    def _repo(self, item: Download) -> None:
        """A diffusers-format repository into its own folder."""
        from huggingface_hub import HfApi, snapshot_download

        api = HfApi(token=os.environ.get("HF_TOKEN") or None)
        info = api.model_info(item.repo_id, files_metadata=True)
        wanted = [
            sibling for sibling in info.siblings or []
            # Skip duplicate weight formats a diffusers load never reads.
            if not sibling.rfilename.endswith((".ckpt", ".bin", ".msgpack", ".onnx", ".pb", ".h5"))
            and "/onnx/" not in f"/{sibling.rfilename}"
        ]
        item.total_bytes = sum(sibling.size or 0 for sibling in wanted)
        target = self.models_dir / item.repo_id.split("/")[-1]

        def progress() -> None:
            while item.state == "downloading":
                if target.exists():
                    item.done_bytes = min(item.total_bytes, _folder_size(target))
                time.sleep(1)

        threading.Thread(target=progress, daemon=True).start()
        snapshot_download(
            item.repo_id,
            local_dir=target,
            allow_patterns=[sibling.rfilename for sibling in wanted],
            token=os.environ.get("HF_TOKEN") or None,
        )
        item.done_bytes = item.total_bytes
        item.model_id = target.name
