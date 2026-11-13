"""IP-Adapter on SDXL: a reference picture's look (colours, style, the
character's appearance) as a condition beside the prompt.

h94/IP-Adapter's "plus" SDXL adapter with its ViT-H image encoder, both
Apache-2.0, downloaded on first use into `<models>/controls/ip-adapter/`
from a fixed commit, each file checked against its SHA-256 (as the pose and
union ControlNets are, pose_control.pinned_download).

It is loaded into the model's UNet only while runs use it: a run without a
reference unloads it again, so that run is exactly as it would be without
it. The UNet is shared by every pipeline made from the model (img2img,
inpaint, the ControlNet twins), so each one used only needs the image
encoder handed over (`share`).
"""

from __future__ import annotations

from pathlib import Path

from . import pose_control

IP_ADAPTER_REPO = "h94/IP-Adapter"
IP_ADAPTER_REVISION = "018e402774aeeddd60609b4ecdb7e298259dc729"
IP_ADAPTER_WEIGHT = "sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors"
IP_ADAPTER_ENCODER = "models/image_encoder"
IP_ADAPTER_FILES = {
    IP_ADAPTER_WEIGHT: "3f5062b8400c94b7159665b21ba5c62acdcd7682262743d7f2aefedef00e6581",
    f"{IP_ADAPTER_ENCODER}/config.json": "625d37b31afbf2f0792a87846b3654ee23f20568409e35b78a1f795b04e1a7a1",
    f"{IP_ADAPTER_ENCODER}/model.safetensors": "6ca9667da1ca9e0b0f75e46bb030f7e011f44f86cbfb8d5a36590fcd7507b030",
}


def folder(controls_dir: Path) -> Path:
    """Where the adapter and its encoder are kept, in the repository's own layout."""
    return controls_dir / "ip-adapter"


def fetch(controls_dir: Path) -> Path:
    """The pinned files, downloaded on first use and checked; the folder they are in."""
    target = folder(controls_dir)
    for filename, sha256 in IP_ADAPTER_FILES.items():
        pose_control.pinned_download(IP_ADAPTER_REPO, IP_ADAPTER_REVISION, filename, sha256, target)
    return target


def load(pipe, controls_dir: Path) -> None:
    """Puts the adapter into the model's UNet and the image encoder on `pipe`."""
    target = fetch(controls_dir)
    subfolder, weight = IP_ADAPTER_WEIGHT.split("/")
    pipe.load_ip_adapter(str(target), subfolder=subfolder, weight_name=weight, image_encoder_folder=IP_ADAPTER_ENCODER, local_files_only=True)


def share(base, pipe) -> None:
    """Hands `base`'s image encoder to another pipeline made from the same model."""
    if pipe is base:
        return
    pipe.register_modules(image_encoder=base.image_encoder, feature_extractor=base.feature_extractor)


def unload(base, others) -> None:
    """Takes the adapter out of the UNet, and the encoder off every pipeline that had it."""
    base.unload_ip_adapter()
    for pipe in others:
        if pipe is not base and getattr(pipe, "image_encoder", None) is not None:
            pipe.register_modules(image_encoder=None, feature_extractor=None)
