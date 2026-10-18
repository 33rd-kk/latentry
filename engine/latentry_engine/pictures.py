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


# Hires fix's size is not snapped to 2048 like a first pass: Latentry allows
# up to 4096 a side, and decodes large canvases tile by tile.
MAX_HIRES_SIDE = 4096
# The most steps a schedule is asked for, so a low denoise cannot ask for
# thousands (the schedulers train on 1000 timesteps).
MAX_SCHEDULE_STEPS = 1000


def hires_size(width: int, height: int, scale: float, multiple: int = 8) -> tuple[int, int]:
    """The size hires fix redraws at: each side scaled and rounded to the multiple (Latentry's hiresSize)."""

    def side(value: int) -> int:
        return max(multiple, min(MAX_HIRES_SIDE, round(value * scale / multiple) * multiple))

    return side(width), side(height)


def hires_schedule(steps: int, denoise: float, family: str) -> int:
    """The step count to ask img2img for so that it runs `steps` at `denoise`.

    A1111 and ComfyUI run exactly the hires steps asked for; diffusers' img2img
    runs only the tail of its schedule, so it is asked for a longer one."""
    asked = steps
    while asked < MAX_SCHEDULE_STEPS and img2img_steps(asked, denoise, family) < steps:
        asked += 1
    return asked
