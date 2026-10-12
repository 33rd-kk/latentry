"""LoRAs: finding them in `<models>/loras/`, reading `<lora:name:weight>`
calls out of a prompt, and putting them on the pipeline for a run.

    models/loras/
      style.safetensors              called as <lora:style:0.8>
      characters/hero.safetensors    called as <lora:hero>, folders are only for tidiness

A LoRA's name is its file name without the extension, as in A1111, so a
prompt written for the web UI works here unchanged. The calls are taken out
of the prompt before it is encoded: left in, they would be read as words.

LoRAs are on only for the run that calls them. Putting one into the model is
the slow part (about 1.5 s on SDXL), so the last few used stay in it between
runs (LoraKeeper, up to LATENTRY_LORA_KEEP, default 4), switched off: a
switched-off LoRA layer runs only the model's own layer, so the next run
without them comes out exactly as if they had never been loaded. They go
with the model when it is unloaded or switched.

Nothing about a LoRA is written anywhere by the engine. Its hash (the one
A1111 writes as "Lora hashes") is worked out only when a run asks for it,
and kept in memory only.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import re
import struct
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

from .models import FAMILY_ANIMA, FAMILY_SDXL, safetensors_header

# SD 1.x LoRAs: recognised so they can be refused by name; no model here runs them.
FAMILY_SD15 = "sd15"

# Each part stops where the next one starts, and none runs past a "<", so an
# unclosed call cannot make a match backtrack (CodeQL py/polynomial-redos).
CALL = re.compile(r"<(?:lora|lyco):([^:<>]+)(?::([^:<>]*))?(?::[^<>]*)?>", re.IGNORECASE)
LICENSE_KEYS = ("modelspec.license", "license")
ADAPTER_PREFIX = "lora_"
DEFAULT_KEEP = 4


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
    # What a removed call leaves behind: empty items between commas, and
    # doubled spaces. Split and joined rather than matched, to stay linear.
    items = [_single_spaces(item) for item in CALL.sub("", prompt).split(",") if item.strip()]
    return ",".join(items).strip(), list(calls.values())


def _single_spaces(text: str) -> str:
    """Runs of spaces and tabs as one space; newlines kept."""
    out: list[str] = []
    for char in text.replace("\t", " "):
        if char != " " or not out or out[-1] != " ":
            out.append(char)
    return "".join(out)


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


def adapter_names(pipe) -> list[str]:
    names: list[str] = []
    for adapters in pipe.get_list_adapters().values():
        names.extend(name for name in adapters if name not in names)
    return names


def keep_limit() -> int:
    """LATENTRY_LORA_KEEP: how many LoRAs stay in the model between runs; 0
    takes each one out after its run."""
    wanted = os.environ.get("LATENTRY_LORA_KEEP", "").strip()
    try:
        return max(0, int(wanted)) if wanted else DEFAULT_KEEP
    except ValueError:
        return DEFAULT_KEEP


class LoraKeeper:
    """The LoRAs left in one loaded model between runs, by file (path, size,
    mtime: a changed file is loaded again as a new adapter), the last used at
    the end. One per model (pipelines.Loaded), so they go with it."""

    def __init__(self) -> None:
        self._kept: OrderedDict[tuple[str, int, int], str] = OrderedDict()
        self._count = 0

    @contextlib.contextmanager
    def applied(self, pipe, calls: list[LoraCall]):
        """Within the block, `pipe` runs with `calls` at their weights and no
        other kept LoRA. Adapters put on by others (the Anima pose adapter)
        stay on at full weight."""
        present = adapter_names(pipe)
        # Whatever took every LoRA out since (unload_lora_weights) took ours too.
        self._kept = OrderedDict((key, name) for key, name in self._kept.items() if name in present)
        if not calls and not self._kept:
            yield
            return
        others = [name for name in present if name not in self._kept.values()]
        names: list[str] = []
        try:
            for call in calls:
                names.append(self._load(pipe, call))
            if names or others:
                # Every layer on, then only these: a layer added by this
                # load starts on, older ones may have been switched off.
                pipe.enable_lora()
                pipe.set_adapters(others + names, [1.0] * len(others) + [call.weight for call in calls])
            else:
                pipe.disable_lora()
            yield
        finally:
            self._settle(pipe, others)

    def _load(self, pipe, call: LoraCall) -> str:
        try:
            stat = call.path.stat()
            key = (str(call.path), stat.st_size, stat.st_mtime_ns)
            if key not in self._kept:
                name = f"{ADAPTER_PREFIX}{self._count}"
                self._count += 1
                pipe.load_lora_weights(str(call.path), adapter_name=name)
                self._kept[key] = name
        except Exception as error:
            # diffusers says why in its own words, which can include the
            # file's path: those go to the log, not to the client.
            print(f"[engine] applying LoRA {call.name} failed: {error!r}", flush=True)
            raise LoraError(f"The LoRA {call.name} could not be applied to this model ({type(error).__name__}). The engine's log has the details.") from error
        self._kept.move_to_end(key)
        return self._kept[key]

    def _settle(self, pipe, others: list[str]) -> None:
        """After a run: keep the last used up to the limit, switched off, and
        take out the rest (and anything half loaded)."""
        limit = keep_limit()
        while len(self._kept) > limit:
            self._kept.popitem(last=False)
        kept = set(self._kept.values())
        if not kept and not others:
            # Nothing to keep: take the LoRA layers out entirely.
            if adapter_names(pipe):
                pipe.unload_lora_weights()
            return
        leaving = [name for name in adapter_names(pipe) if name not in kept and name not in others]
        if leaving:
            pipe.delete_adapters(leaving)
        if others:
            pipe.set_adapters(others, [1.0] * len(others))
        else:
            pipe.disable_lora()
