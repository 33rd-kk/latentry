"""LoRAs: finding them in `<models>/loras/`, reading `<lora:name:weight>`
calls out of a prompt, and putting them on the pipeline for one run.

    models/loras/
      style.safetensors              called as <lora:style:0.8>
      characters/hero.safetensors    called as <lora:hero>, folders are only for tidiness

A LoRA's name is its file name without the extension, as in A1111, so a
prompt written for the web UI works here unchanged. The calls are taken out
of the prompt before it is encoded: left in, they would be read as words.

LoRAs are on only for the run that calls them, like the pose adapter: the
next run without them comes out exactly as if they had never been loaded.

Nothing about a LoRA is written anywhere by the engine. Its hash (the one
A1111 writes as "Lora hashes") is worked out only when a run asks for it,
and kept in memory only.
"""

from __future__ import annotations

import contextlib
import hashlib
import re
import struct
from dataclasses import dataclass
from pathlib import Path

from .models import FAMILY_ANIMA, FAMILY_SDXL, safetensors_header

# SD 1.x LoRAs: recognised so they can be refused by name; no model here runs them.
FAMILY_SD15 = "sd15"

CALL = re.compile(r"<(?:lora|lyco):([^:>]+)(?::([^:>]*))?[^>]*>", re.IGNORECASE)
LICENSE_KEYS = ("modelspec.license", "license")
ADAPTER_PREFIX = "lora_"


class LoraError(ValueError):
    """A call that cannot be applied, with a message worth showing as is."""


@dataclass(frozen=True)
class LoraFile:
    name: str
    path: Path
    family: str | None  # None: could not tell; diffusers decides when it loads
    size_bytes: int
    license: str | None = None

    def describe(self) -> dict:
        return {"name": self.name, "family": self.family, "size_bytes": self.size_bytes, "license": self.license}


@dataclass(frozen=True)
class LoraCall:
    name: str
    weight: float
    path: Path


def loras_dir(models_dir: Path) -> Path:
    return models_dir / "loras"


def family_of(keys: list[str], metadata: dict[str, str]) -> str | None:
    """Which model family a LoRA was trained for, from its tensor names
    (kohya, diffusers and ComfyUI layouts) and kohya's metadata."""
    hints = " ".join(metadata.get(key, "") for key in ("ss_base_model_version", "modelspec.architecture")).lower()
    if "anima" in hints or any(key.startswith(("diffusion_model.blocks.", "diffusion_model.llm_adapter.", "transformer.transformer_blocks.", "text_conditioner.")) for key in keys):
        return FAMILY_ANIMA
    if "sdxl" in hints or "stable-diffusion-xl" in hints:
        return FAMILY_SDXL
    if any(key.startswith(("lora_te1_", "lora_te2_", "text_encoder_2.", "lora_unet_input_blocks_", "lora_unet_output_blocks_", "lora_unet_middle_block_")) for key in keys):
        return FAMILY_SDXL
    if any(key.startswith(("lora_te_", "lora_unet_down_blocks_", "lora_unet_up_blocks_")) for key in keys):
        return FAMILY_SD15
    if any(key.startswith("unet.") for key in keys):
        return FAMILY_SDXL
    return None


def _describe(path: Path) -> LoraFile:
    try:
        keys, metadata = safetensors_header(path)
    except (OSError, ValueError, struct.error):
        keys, metadata = [], {}
    licence = next((metadata[key].strip()[:200] for key in LICENSE_KEYS if metadata.get(key, "").strip()), None)
    return LoraFile(path.stem, path, family_of(keys, metadata), path.stat().st_size, licence)


def scan(models_dir: Path) -> list[LoraFile]:
    """Every LoRA under `<models>/loras/`, by name. Where two files share a
    name, the first in path order is the one a call gets."""
    folder = loras_dir(models_dir)
    if not folder.is_dir():
        return []
    found: dict[str, LoraFile] = {}
    for path in sorted(folder.rglob("*.safetensors"), key=lambda item: str(item).lower()):
        if any(part.startswith(".") for part in path.relative_to(folder).parts) or not path.is_file():
            continue
        found.setdefault(path.stem.lower(), _describe(path))
    return sorted(found.values(), key=lambda lora: lora.name.lower())


def calls_in(prompt: str) -> tuple[str, list[tuple[str, float]]]:
    """The prompt without its `<lora:…>` / `<lyco:…>` calls, and the calls
    as (name, weight): the first number after the name, else 1. A name
    called twice keeps its first weight."""
    calls: dict[str, tuple[str, float]] = {}
    for match in CALL.finditer(prompt):
        name = re.split(r"[\\/]", match.group(1).strip())[-1]
        name = re.sub(r"\.(safetensors|ckpt|pt|pth|bin)$", "", name, flags=re.IGNORECASE).strip()
        try:
            weight = float(match.group(2)) if match.group(2) and match.group(2).strip() else 1.0
        except ValueError:
            weight = 1.0
        if name:
            calls.setdefault(name.lower(), (name, weight))
    cleaned = CALL.sub("", prompt)
    # What a removed call leaves behind: ", ," and doubled spaces.
    cleaned = re.sub(r"\s*,(\s*,)+", ",", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned).strip().strip(",").strip()
    return cleaned, list(calls.values())


def resolve(prompt: str, models_dir: Path, family: str) -> tuple[str, list[LoraCall]]:
    """The prompt to encode and the LoRAs to put on for it. Refuses a call
    to a LoRA that is not there, or that was made for another model family:
    run without it, the picture would not be what the prompt asked for."""
    cleaned, calls = calls_in(prompt)
    if not calls:
        return prompt, []
    available = {lora.name.lower(): lora for lora in scan(models_dir)}
    missing = [name for name, _ in calls if name.lower() not in available]
    if missing:
        raise LoraError(f"No LoRA named {', '.join(missing)} in the models folder's loras folder.")
    resolved: list[LoraCall] = []
    for name, weight in calls:
        lora = available[name.lower()]
        if lora.family is not None and lora.family != family:
            raise LoraError(f"The LoRA {lora.name} was made for {lora.family.upper()} models, not the loaded {family.upper()} model.")
        if weight != 0:
            resolved.append(LoraCall(lora.name, weight, lora.path))
    return cleaned, resolved


_hashes: dict[tuple[str, int, int], str] = {}


def addnet_hash(path: Path) -> str:
    """A1111's "Lora hashes" value: the first 12 hex digits of the SHA-256 of
    the tensor data (the file after its header). Kept in memory only."""
    stat = path.stat()
    key = (str(path), stat.st_size, stat.st_mtime_ns)
    if key not in _hashes:
        digest = hashlib.sha256()
        with path.open("rb") as file:
            (length,) = struct.unpack("<Q", file.read(8))
            file.seek(8 + length)
            for chunk in iter(lambda: file.read(1 << 20), b""):
                digest.update(chunk)
        _hashes[key] = digest.hexdigest()[:12]
    return _hashes[key]


def applied_list(calls: list[LoraCall], with_hashes: bool) -> list[dict]:
    """What the `image` event says was applied."""
    return [
        {"name": call.name, "weight": call.weight, **({"hash": addnet_hash(call.path)} if with_hashes else {})}
        for call in calls
    ]


def _adapter_names(pipe) -> list[str]:
    names: list[str] = []
    for adapters in pipe.get_list_adapters().values():
        names.extend(name for name in adapters if name not in names)
    return names


@contextlib.contextmanager
def applied(pipe, calls: list[LoraCall]):
    """Within the block, `pipe` runs with `calls` at their weights. Adapters
    already on (the Anima pose adapter) stay on at full weight."""
    if not calls:
        yield
        return
    others = _adapter_names(pipe)
    names = [f"{ADAPTER_PREFIX}{index}" for index in range(len(calls))]
    try:
        for name, call in zip(names, calls):
            try:
                pipe.load_lora_weights(str(call.path), adapter_name=name)
            except Exception as error:  # noqa: BLE001 - diffusers says why in its own words
                raise LoraError(f"The LoRA {call.name} could not be applied to this model: {error}") from error
        pipe.set_adapters(others + names, [1.0] * len(others) + [call.weight for call in calls])
        yield
    finally:
        loaded = [name for name in _adapter_names(pipe) if name in names]
        if not others:
            # Nothing else on: take the LoRA layers out entirely.
            pipe.unload_lora_weights()
        else:
            if loaded:
                pipe.delete_adapters(loaded)
            pipe.set_adapters(others, [1.0] * len(others))
