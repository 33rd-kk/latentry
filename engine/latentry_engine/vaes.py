"""VAEs to draw with instead of a checkpoint's own: `<models>/vae/*.safetensors`.

Named by file name only, so the API never takes a path: a name the folder
does not hold is no VAE. Only SDXL checkpoints take one (Anima's VAE is a
different kind), and only .safetensors files are read, which cannot run code.
"""

from __future__ import annotations

from pathlib import Path


def vae_dir(models_dir: Path) -> Path:
    return models_dir / "vae"


def scan(models_dir: Path) -> list[str]:
    """The VAE files' names, directly in `<models>/vae/`, in name order."""
    folder = vae_dir(models_dir)
    if not folder.is_dir():
        return []
    return sorted(
        (entry.name for entry in folder.iterdir() if entry.is_file() and entry.suffix.lower() == ".safetensors" and not entry.name.startswith(".")),
        key=str.lower,
    )


def find(models_dir: Path, name: str) -> Path | None:
    """The file of a VAE the folder holds, by its exact name; None for anything else."""
    return vae_dir(models_dir) / name if name in scan(models_dir) else None
