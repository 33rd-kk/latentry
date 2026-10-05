"""Drawing skeletons the way pose-conditioned models were trained to read them.

- "dwpose": rtmlib's COCO-WholeBody drawing (thin coloured lines and dots),
  the usual input of DWPose-trained models such as Anima-Control-Pose.
- "openpose": the 18 OpenPose body points with thick limbs that grow with
  the canvas, as xinsir/controlnet-openpose-sdxl-1.0 was trained. Body only:
  hands and face were not in its training skeletons.
  `_draw_openpose_body` follows the draw_bodypose function on that model's
  card (Apache-2.0), itself a modification of controlnet_aux's (Apache-2.0);
  see NOTICE.

Both on black, at the output's own size.
"""

from __future__ import annotations

import math
from typing import Literal

import numpy as np
from PIL import Image

from .detect import KEYPOINT_THRESHOLD

Style = Literal["dwpose", "openpose"]
STYLES: tuple[Style, ...] = ("dwpose", "openpose")

# OpenPose's 18-point limbs (1-based, as published) and its colours (RGB).
_OPENPOSE_LIMBS = [
    (2, 3), (2, 6), (3, 4), (4, 5), (6, 7), (7, 8), (2, 9), (9, 10), (10, 11),
    (2, 12), (12, 13), (13, 14), (2, 1), (1, 15), (15, 17), (1, 16), (16, 18),
]
_OPENPOSE_COLOURS = [
    (255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0), (170, 255, 0), (85, 255, 0),
    (0, 255, 0), (0, 255, 85), (0, 255, 170), (0, 255, 255), (0, 170, 255), (0, 85, 255),
    (0, 0, 255), (85, 0, 255), (170, 0, 255), (255, 0, 255), (255, 0, 170), (255, 0, 85),
]


def render(keypoints: np.ndarray, scores: np.ndarray, size: tuple[int, int], style: Style = "dwpose") -> Image.Image:
    """`keypoints` (N, 133, 2) in the canvas's pixels with `scores` (N, 133), on a `size` canvas."""
    if style not in STYLES:
        raise ValueError(f"Unknown skeleton style {style!r}; one of {', '.join(STYLES)}")
    width, height = size
    canvas = np.zeros((height, width, 3), np.uint8)
    if style == "openpose":
        from rtmlib.tools.pose_estimation.post_processings import convert_coco_to_openpose

        body, body_scores = convert_coco_to_openpose(keypoints, scores)
        for person, person_scores in zip(body[:, :18], body_scores[:, :18]):
            _draw_openpose_body(canvas, person, person_scores)
        return Image.fromarray(canvas)

    import cv2
    from rtmlib import draw_skeleton

    canvas = draw_skeleton(canvas, keypoints, scores, openpose_skeleton=False, kpt_thr=KEYPOINT_THRESHOLD)
    return Image.fromarray(cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB))


def _draw_openpose_body(canvas: np.ndarray, points: np.ndarray, scores: np.ndarray) -> None:
    """One person's 18 points onto an RGB canvas, in place."""
    import cv2

    height, width = canvas.shape[:2]
    longest = max(width, height)
    # The card's steps: 1x under 500 px, then one more per 1000 px.
    ratio = 1.0 if longest < 500 else 2.0 if longest < 1000 else min(7.0, 3.0 + (longest - 1000) // 1000)
    seen = scores >= KEYPOINT_THRESHOLD
    for (first, second), colour in zip(_OPENPOSE_LIMBS, _OPENPOSE_COLOURS):
        a, b = first - 1, second - 1
        if not (seen[a] and seen[b]):
            continue
        (x0, y0), (x1, y1) = points[a], points[b]
        length = math.hypot(x1 - x0, y1 - y0)
        angle = math.degrees(math.atan2(y0 - y1, x0 - x1))
        polygon = cv2.ellipse2Poly(
            (int((x0 + x1) / 2), int((y0 + y1) / 2)), (int(length / 2), int(4 * ratio)), int(angle), 0, 360, 1
        )
        cv2.fillConvexPoly(canvas, polygon, [int(c * 0.6) for c in colour])
    for point, colour, shown in zip(points, _OPENPOSE_COLOURS, seen):
        if shown:
            cv2.circle(canvas, (int(point[0]), int(point[1])), int(4 * ratio), colour, thickness=-1)


def letterbox(skeleton: Image.Image, size: tuple[int, int]) -> Image.Image:
    """A skeleton drawn for another size, scaled uniformly and centred on a black
    `size` canvas, so it lines up with the output however it was drawn."""
    if skeleton.size == size:
        return skeleton.convert("RGB")
    scale = min(size[0] / skeleton.width, size[1] / skeleton.height)
    resized = skeleton.convert("RGB").resize(
        (max(1, round(skeleton.width * scale)), max(1, round(skeleton.height * scale))), Image.Resampling.BILINEAR
    )
    canvas = Image.new("RGB", size, (0, 0, 0))
    canvas.paste(resized, ((size[0] - resized.width) // 2, (size[1] - resized.height) // 2))
    return canvas
