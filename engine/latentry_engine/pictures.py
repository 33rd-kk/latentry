"""Pictures in and out of a run: base64 PNGs, transparency, masks, and the
size and step count a run really uses. No model or GPU needed."""

from __future__ import annotations

import base64
import io

from PIL import Image

from .models import FAMILY_SDXL


def decode_image(data: str) -> Image.Image:
    if data.startswith("data:"):
        data = data.split(",", 1)[1]
    image = Image.open(io.BytesIO(base64.b64decode(data)))
    image.load()
    return image


def encode_png(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def flatten(image: Image.Image) -> Image.Image:
    """RGB, with transparency on white (what an illustration's empty background means)."""
    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
        background = Image.new("RGB", image.size, (255, 255, 255))
        background.paste(image, mask=image.getchannel("A"))
        return background
    return image.convert("RGB")


def mask_from_alpha(mask: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Latentry's mask: painted (opaque) pixels are redrawn. As L, white = redraw."""
    mask = mask.convert("RGBA").getchannel("A") if mask.mode in ("RGBA", "LA", "P") else mask.convert("L")
    return mask.resize(size, Image.Resampling.LANCZOS)


def snap(value: float, multiple: int = 8) -> int:
    return max(256, min(2048, round(value / multiple) * multiple))


def fit_to_image(source: Image.Image, width: int, height: int, multiple: int = 8) -> tuple[int, int]:
    """The source's aspect ratio at the requested pixel area (Latentry's fitToImage)."""
    area = max(256 * 256, width * height)
    aspect = source.width / source.height
    fitted_height = (area / aspect) ** 0.5
    return snap(fitted_height * aspect, multiple), snap(fitted_height, multiple)


def img2img_steps(steps: int, strength: float, family: str) -> int:
    """How many steps img2img really runs: what each pipeline's get_timesteps
    keeps. The SDXL pipelines truncate steps * strength (28 at 0.85 is 23);
    Anima's modular one truncates the skipped part instead (24)."""
    if family == FAMILY_SDXL:
        return max(1, min(int(steps * strength), steps))
    init = min(steps * strength, steps)
    return max(1, steps - int(max(steps - init, 0)))
