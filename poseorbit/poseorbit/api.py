"""The `/api/pose` request and answer, independent of any web framework, so
poseorbit's own server and a generation server that embeds poseorbit speak
exactly the same JSON.

Request:
    { "image_base64": "...", "width": 832, "height": 1216,
      "person": 0,                          # optional; -1 = everyone, absent = most confident
      "want_3d": true,                      # optional; answer with each person's 3D points
      "camera": { "yaw": 30, "pitch": 10 }, # optional; degrees, see geometry.py
      "style": "openpose" }                 # optional; "dwpose" (default) or "openpose"

Answer:
    { "skeleton_base64": "...png...", "width": 832, "height": 1216, "person": 0,
      "camera": { "yaw": 30, "pitch": 10 }, "style": "openpose",
      "limits": { "yaw": 90, "pitch": 45 },
      "people": [ { "bbox": [x0, y0, x1, y1],                # fractions of the picture
                    "points_3d": [[x, y, z], ...],          # with want_3d: 133 points, fractions of the picture's width
                    "scores": [...] } ] }                   # with want_3d: 133 scores
"""

from __future__ import annotations

import base64
import io
import math
from typing import Any

from PIL import Image

from . import ALL_PEOPLE, MAX_PITCH, MAX_YAW, STYLES, Camera, Detector, pose
from .draw import Style


class BadRequest(ValueError):
    """The request is wrong; answer 400 with the message."""


def decode_image(data: str) -> Image.Image:
    if data.startswith("data:"):
        data = data.split(",", 1)[1]
    try:
        image = Image.open(io.BytesIO(base64.b64decode(data)))
        image.load()
    except Exception as error:  # noqa: BLE001 - any decode failure is the caller's input
        raise BadRequest("The picture could not be read.") from error
    return image


def encode_png(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise BadRequest(f"{name} must be a number")
    return float(value)


def parse_camera(value: Any) -> Camera | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise BadRequest("camera must be an object { yaw, pitch }")
    return Camera(
        yaw=_number(value.get("yaw", 0), "camera.yaw"),
        pitch=_number(value.get("pitch", 0), "camera.pitch"),
    ).clamped()


def handle(detector: Detector, body: dict[str, Any], default_style: Style = "dwpose") -> dict[str, Any]:
    """Answers one request. Raises BadRequest (and NoPersonError, a ValueError) for a 400."""
    data = body.get("image_base64")
    if not isinstance(data, str) or not data:
        raise BadRequest("image_base64 is required")
    image = decode_image(data)
    width = int(_number(body.get("width", image.width), "width"))
    height = int(_number(body.get("height", image.height), "height"))
    if not (64 <= width <= 4096 and 64 <= height <= 4096):
        raise BadRequest("width and height must be 64-4096")
    person = body.get("person")
    if person is not None and (isinstance(person, bool) or not isinstance(person, int) or person < ALL_PEOPLE):
        raise BadRequest("person must be an index, or -1 for everyone")
    style = body.get("style") or default_style
    if style not in STYLES:
        raise BadRequest(f"style must be one of {', '.join(STYLES)}")
    want_3d = body.get("want_3d") is True

    result = pose(detector, image, (width, height), person, parse_camera(body.get("camera")), style, depth=want_3d)
    people = []
    for found in result.people:
        x0, y0, x1, y1 = found.bbox
        # Keypoints can be guessed past the edge (feet below the frame); the
        # box is for drawing over the picture, so it stays inside it.
        box = [x0 / image.width, y0 / image.height, x1 / image.width, y1 / image.height]
        entry: dict[str, Any] = {"bbox": [round(min(1.0, max(0.0, edge)), 5) for edge in box]}
        if want_3d:
            # One unit for all three axes (the picture's width), so a viewer
            # can draw them without knowing the picture's size or aspect.
            entry["points_3d"] = (found.points_3d / image.width).round(5).tolist()
            entry["scores"] = found.scores.round(3).tolist()
        people.append(entry)
    return {
        "skeleton_base64": encode_png(result.skeleton),
        "width": width,
        "height": height,
        "person": result.person,
        "camera": {"yaw": result.camera.yaw, "pitch": result.camera.pitch},
        "style": style,
        "limits": {"yaw": MAX_YAW, "pitch": MAX_PITCH},
        "people": people,
    }
