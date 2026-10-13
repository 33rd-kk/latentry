"""Making a run follow a skeleton: the model-specific half of pose control.

Finding people and drawing their skeleton is poseorbit's (CPU, no torch);
this module applies the drawn skeleton to the loaded model:

- Anima (28-layer v1.0 transformers): Claquasse/Anima-Control-Pose, a rank-16
  LoRA plus a `control_embedder` that patch-embeds the skeleton's VAE latent
  and adds it to the transformer's patch embed on every forward. The method
  is the adapter author's (their ComfyUI node and model card), re-implemented
  here on diffusers; the measurements (raw latent, strength 1.0: body-PCK
  0.82 against 0.00 without) come from the diffusers server this replaces.
  Skeletons are drawn "dwpose", as it was trained. The adapter's weights are
  under CircleStone Labs' non-commercial licence: they are downloaded on
  first use, never shipped with Latentry.
- SDXL: xinsir/controlnet-openpose-sdxl-1.0 through diffusers' own ControlNet
  pipelines, built from the loaded pipeline's components. Skeletons are drawn
  "openpose".

Weights download on first use into `<models>/controls/`, from a fixed commit
of their repository, and each file is checked against its SHA-256 before it
is used (re-pin with `node scripts/pin-downloads.mjs hf <repo> <files>`).
"""

from __future__ import annotations

import contextlib
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from .loras import adapter_names
from .models import sha256_of

ANIMA_ADAPTER_REPO = "Claquasse/Anima-Control-Pose"
ANIMA_ADAPTER_REVISION = "8f559771d5a49a02fa03f7df2a05ccb7eecb3a2a"
ANIMA_ADAPTER_FILE = "anima_pose_preview2.safetensors"
ANIMA_ADAPTER_SHA256 = "c10fa11628e9b1bf16dfe095ac5c6dc4ddd9ae77d7fe023d0a1857f7e29c516f"
ANIMA_LAYERS = 28
ANIMA_ADAPTER_NAME = "anima_pose"

SDXL_CONTROLNET_REPO = "xinsir/controlnet-openpose-sdxl-1.0"
SDXL_CONTROLNET_REVISION = "23f966cd5cfdd3f7729c903e243d87152162d2b7"
SDXL_CONTROLNET_FILES = {
    "config.json": "b5b8f9a7619c9452f19407ef73a01ce3f061fcf932de43ddbaca336d12d02801",
    "diffusion_pytorch_model.safetensors": "b8524e557a7df60d081f5d4a0eb109967d107df217943bf88c2d99b9ebcc06c5",
}

# Files already checked, by (path, size, mtime_ns): hashing the 2.5 GB
# ControlNet on every model load would cost seconds. Kept in memory only.
_checked: set[tuple[str, int, int]] = set()


def controls_dir(models_dir: Path) -> Path:
    return models_dir / "controls"


def _matches(path: Path, sha256: str) -> bool:
    if not path.is_file():
        return False
    stat = path.stat()
    key = (str(path), stat.st_size, stat.st_mtime_ns)
    if key not in _checked:
        if sha256_of(path) != sha256:
            return False
        _checked.add(key)
    return True


def pinned_download(repo: str, revision: str, filename: str, sha256: str, folder: Path) -> Path:
    """`filename` from `repo` at `revision`, checked against `sha256`.

    A file already there that does not match (one fetched from `main` before
    the pin, or a damaged one) is removed and fetched again; a download that
    does not match is removed, never used.
    """
    from huggingface_hub import hf_hub_download

    local = folder / filename
    if _matches(local, sha256):
        return local
    local.unlink(missing_ok=True)
    downloaded = Path(hf_hub_download(repo, filename, revision=revision, local_dir=folder))
    if not _matches(downloaded, sha256):
        downloaded.unlink(missing_ok=True)
        raise RuntimeError(f"{repo}/{filename} does not match its pinned SHA-256")
    return downloaded


# ── Anima ───────────────────────────────────────────────────────────────────


class ControlEmbedder(torch.nn.Module):
    """The adapter's control_embedder: a patch embed for the 16-channel control latent."""

    def __init__(self, in_channels: int = 16, patch: tuple[int, int, int] = (1, 2, 2), dim: int = 2048):
        super().__init__()
        self.patch = patch
        self.proj = torch.nn.Linear(in_channels * patch[0] * patch[1] * patch[2], dim)

    def forward(self, latent: torch.Tensor) -> torch.Tensor:
        # Same reshape as diffusers' CosmosPatchEmbed (and ComfyUI's einops
        # "b c (t r) (h m) (w n) -> b t h w (c r m n)").
        batch, channels, frames, height, width = latent.shape
        p_t, p_h, p_w = self.patch
        latent = latent.reshape(batch, channels, frames // p_t, p_t, height // p_h, p_h, width // p_w, p_w)
        latent = latent.permute(0, 2, 4, 6, 1, 3, 5, 7).flatten(4, 7)
        return self.proj(latent)


def anima_supported(pipe) -> bool:
    """Only 28-layer (v1.0) transformers: the LoRA is keyed per block, and the
    40-layer preview has no mapping onto it."""
    return int(pipe.transformer.config.num_layers) == ANIMA_LAYERS


class AnimaPoseAdapter:
    """Holds the adapter's weights (CPU) and applies them to `pipe` for one run at a time.

    The LoRA and the hook are on only inside `applied`, so ordinary runs never
    see them and come out exactly as before. Prompt LoRAs kept in the model
    between runs (loras.LoraKeeper) stay in when it goes.
    """

    def __init__(self, pipe, folder: Path):
        self.pipe = pipe
        self.folder = folder
        self._lora: dict[str, torch.Tensor] | None = None
        self._embedder: ControlEmbedder | None = None

    def _load(self) -> None:
        if self._lora is not None:
            return
        from safetensors.torch import load_file

        state = load_file(
            str(pinned_download(ANIMA_ADAPTER_REPO, ANIMA_ADAPTER_REVISION, ANIMA_ADAPTER_FILE, ANIMA_ADAPTER_SHA256, self.folder))
        )
        embedder_state = {
            key.split("control_embedder.", 1)[1]: value for key, value in state.items() if "control_embedder." in key
        }
        if not embedder_state:
            raise RuntimeError(f"{ANIMA_ADAPTER_FILE} has no control_embedder weights")
        embedder = ControlEmbedder(dim=int(embedder_state["proj.weight"].shape[0]))
        embedder.load_state_dict(embedder_state)
        self._embedder = embedder.eval()
        self._lora = {key: value for key, value in state.items() if "control_embedder." not in key}

    @torch.no_grad()
    def _control_latent(self, skeleton: Image.Image) -> torch.Tensor:
        """The skeleton through the pipeline's VAE, (1, 16, 1, h, w), not
        normalised: what ComfyUI's node feeds, and measured at least as good."""
        vae = self.pipe.vae
        pixels = torch.from_numpy(np.asarray(skeleton.convert("RGB"), np.float32) / 127.5 - 1.0)
        pixels = pixels.permute(2, 0, 1)[None, :, None].to(vae.device, vae.dtype)
        return vae.encode(pixels).latent_dist.mode()

    @contextlib.contextmanager
    def applied(self, skeleton: Image.Image, strength: float):
        """Within the block, `pipe` follows `skeleton` (drawn at the run's size) at `strength`."""
        self._load()
        transformer = self.pipe.transformer
        latent = self._control_latent(skeleton)
        embedder = self._embedder.to(transformer.device, transformer.dtype)
        tokens = strength * embedder(latent.to(transformer.dtype))

        def add_control(_module, _inputs, output):
            # Cond and uncond forwards both get it, as in ComfyUI, where they
            # share one batched call.
            return output + tokens.to(output.device, output.dtype)

        self.pipe.load_lora_weights(dict(self._lora), adapter_name=ANIMA_ADAPTER_NAME)
        # On, and alone, even where kept prompt LoRAs left their layers switched off.
        self.pipe.enable_lora()
        self.pipe.set_adapters([ANIMA_ADAPTER_NAME], [1.0])
        handle = transformer.patch_embed.register_forward_hook(add_control)
        try:
            yield
        finally:
            handle.remove()
            if any(name != ANIMA_ADAPTER_NAME for name in adapter_names(self.pipe)):
                self.pipe.delete_adapters([ANIMA_ADAPTER_NAME])
            else:
                self.pipe.unload_lora_weights()
            self._embedder.to("cpu")


# ── SDXL ────────────────────────────────────────────────────────────────────


def load_sdxl_controlnet(folder: Path, dtype: torch.dtype):
    """The OpenPose ControlNet (2.5 GB in fp16), downloaded on first use."""
    from diffusers import ControlNetModel

    target = folder / SDXL_CONTROLNET_REPO.split("/")[1]
    for filename, sha256 in SDXL_CONTROLNET_FILES.items():
        pinned_download(SDXL_CONTROLNET_REPO, SDXL_CONTROLNET_REVISION, filename, sha256, target)
    return ControlNetModel.from_pretrained(str(target), torch_dtype=dtype, use_safetensors=True)


def sdxl_pose_pipeline(kind: str, base, controlnet, dtype: torch.dtype):
    """The ControlNet twin of a txt2img / img2img / inpaint pipeline, sharing its weights.

    `dtype` must be the weights' own: without it, from_pipe casts the new
    pipeline to float32, and since the modules are shared, the loaded model
    with them (measured on SDXL: 9 GB of weights became 18).
    """
    from diffusers import (
        StableDiffusionXLControlNetImg2ImgPipeline,
        StableDiffusionXLControlNetInpaintPipeline,
        StableDiffusionXLControlNetPipeline,
    )

    cls = {
        "txt2img": StableDiffusionXLControlNetPipeline,
        "img2img": StableDiffusionXLControlNetImg2ImgPipeline,
        "inpaint": StableDiffusionXLControlNetInpaintPipeline,
    }[kind]
    pipe = cls.from_pipe(base, controlnet=controlnet, torch_dtype=dtype)
    pipe.set_progress_bar_config(disable=True)
    return pipe
