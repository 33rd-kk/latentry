"""Pictures in and out of a run, without a model: base64 PNGs, transparency
on white, masks from a painted layer, and the size and step count a run
really uses.
"""

from __future__ import annotations

import base64
import io

import pytest
from PIL import Image

from latentry_engine import pictures
from latentry_engine.models import FAMILY_ANIMA, FAMILY_SDXL


def test_png_round_trip_with_and_without_a_data_url():
    image = Image.new("RGB", (3, 2), (10, 20, 30))
    encoded = pictures.encode_png(image)
    assert base64.b64decode(encoded)[:8] == b"\x89PNG\r\n\x1a\n"
    for data in (encoded, f"data:image/png;base64,{encoded}"):
        decoded = pictures.decode_image(data)
        assert decoded.size == (3, 2)
        assert decoded.convert("RGB").getpixel((0, 0)) == (10, 20, 30)


def test_flatten_puts_transparency_on_white():
    image = Image.new("RGBA", (2, 1), (0, 0, 0, 0))
    image.putpixel((1, 0), (255, 0, 0, 255))
    flat = pictures.flatten(image)
    assert flat.mode == "RGB"
    assert flat.getpixel((0, 0)) == (255, 255, 255)
    assert flat.getpixel((1, 0)) == (255, 0, 0)
    assert pictures.flatten(Image.new("L", (1, 1), 128)).getpixel((0, 0)) == (128, 128, 128)


def test_mask_from_alpha_redraws_the_painted_pixels():
    painted = Image.new("RGBA", (4, 4), (0, 0, 0, 0))
    painted.putpixel((0, 0), (255, 0, 0, 255))
    mask = pictures.mask_from_alpha(painted, (4, 4))
    assert mask.mode == "L"
    assert mask.getpixel((0, 0)) == 255
    assert mask.getpixel((3, 3)) == 0
    # A grey mask is read as is, and resized to the run's size.
    grey = pictures.mask_from_alpha(Image.new("L", (2, 2), 200), (8, 6))
    assert grey.size == (8, 6)
    assert grey.getpixel((4, 3)) == 200


def test_snap_rounds_to_the_multiple_within_the_limits():
    assert pictures.snap(1021) == 1024
    assert pictures.snap(1030, 16) == 1024
    assert pictures.snap(10) == 256
    assert pictures.snap(9999) == 2048


def test_fit_to_image_keeps_the_source_aspect_at_the_requested_area():
    wide = Image.new("RGB", (200, 100))
    width, height = pictures.fit_to_image(wide, 1024, 1024)
    assert (width, height) == (1448, 728)
    assert width % 8 == 0 and height % 8 == 0
    # 1448.2 / 16 rounds up to 91 sixteens; 724.1 / 16 down to 45.
    assert pictures.fit_to_image(wide, 1024, 1024, 16) == (1456, 720)
    assert pictures.fit_to_image(Image.new("RGB", (64, 64)), 100, 100) == (256, 256)


def test_hires_size_scales_past_the_first_pass_limit():
    # Latentry's hiresSize: 832 x 1216 at 1.5 is 1248 x 1824 (multiples of 8).
    assert pictures.hires_size(832, 1216, 1.5) == (1248, 1824)
    assert pictures.hires_size(832, 1216, 1.5, 16) == (1248, 1824)
    # Past snap()'s 2048, up to 4096 a side.
    assert pictures.hires_size(1024, 1536, 2) == (2048, 3072)
    assert pictures.hires_size(2048, 2048, 4) == (4096, 4096)


@pytest.mark.parametrize("family", [FAMILY_SDXL, FAMILY_ANIMA])
@pytest.mark.parametrize("steps,denoise", [(10, 0.4), (28, 0.35), (20, 1.0), (1, 0.05), (30, 0.55)])
def test_hires_schedule_runs_the_steps_asked_for(family, steps, denoise):
    asked = pictures.hires_schedule(steps, denoise, family)
    assert pictures.img2img_steps(asked, denoise, family) == steps
    # The shortest schedule that does.
    assert asked == steps or pictures.img2img_steps(asked - 1, denoise, family) < steps


def test_hires_schedule_stops_at_the_schedulers_length():
    asked = pictures.hires_schedule(200, 0.01, FAMILY_SDXL)
    assert asked == pictures.MAX_SCHEDULE_STEPS
    assert pictures.img2img_steps(asked, 0.01, FAMILY_SDXL) == 10


def test_img2img_steps_follow_each_pipeline():
    assert pictures.img2img_steps(28, 0.85, FAMILY_SDXL) == 23
    assert pictures.img2img_steps(28, 0.85, FAMILY_ANIMA) == 24
    assert pictures.img2img_steps(28, 1.5, FAMILY_SDXL) == 28
    assert pictures.img2img_steps(28, 0.0, FAMILY_SDXL) == 1
    assert pictures.img2img_steps(28, 0.0, FAMILY_ANIMA) == 1


def test_decode_image_reads_the_whole_file():
    buffer = io.BytesIO()
    Image.new("RGB", (5, 5), (1, 2, 3)).save(buffer, format="PNG")
    decoded = pictures.decode_image(base64.b64encode(buffer.getvalue()).decode("ascii"))
    # Loaded, so the bytes behind it can go.
    assert decoded.getpixel((4, 4)) == (1, 2, 3)
