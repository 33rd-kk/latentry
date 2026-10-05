"""Finding people in a picture: their 133 whole-body keypoints and, on request,
how far each keypoint sits in front of or behind the figure.

One YOLOX person detector feeds two keypoint models on the same boxes:

- RTMW-DW-x-l (DWPose, COCO-WholeBody 133 points) for x and y. Skeleton-
  conditioned models are commonly trained on skeletons from this detector,
  so one drawn from it looks like their training data.
- RTMW3D-x for depth only, when asked. Its own x and y are close to DWPose's
  (median 17 px apart on an 832x1216 picture) but not equal; taking x and y
  from DWPose keeps a front view of the 3D pose identical to the 2D one.

Both run on the CPU with onnxruntime through rtmlib: about 0.7 s for one
person at 832x1216, all three models together.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

# A keypoint counts as seen at this score: rtmlib's default drawing cut-off.
KEYPOINT_THRESHOLD = 0.3
# Of the 17 body keypoints, how many must be seen for a detection to be a person.
MIN_BODY_KEYPOINTS = 8

# The ONNX files: (Hugging Face repository, path in it, local name). All are
# OpenMMLab models under Apache-2.0. The first two come zipped from rtmlib's
# own mirror of OpenMMLab's downloads (download.openmmlab.com has been
# unreliable); the onnx inside is kept, renamed.
DETECTOR_FILE = ("Tau-J/RTMPose", "rtmposev1/onnx_sdk/yolox_m_8xb8-300e_humanart-c2c7a14a.zip", "yolox_m_8xb8-300e_humanart-c2c7a14a.onnx")
POSE_2D_FILE = ("Tau-J/RTMPose", "rtmw/onnx_sdk/rtmw-dw-x-l_simcc-cocktail14_270e-256x192_20231122.zip", "rtmw-dw-x-l_simcc-cocktail14_270e-256x192_20231122.onnx")
POSE_3D_FILE = ("Soykaf/RTMW3D-x", "onnx/rtmw3d-x_8xb64_cocktail14-384x288-b0a0eab7_20240626.onnx", "rtmw3d-x_8xb64_cocktail14-384x288-b0a0eab7_20240626.onnx")
# Where the files go when the caller names no folder.
DEFAULT_WEIGHTS_DIR = Path.home() / ".cache" / "poseorbit"

# RTMW3D's depth: 288 bins (its input width) spanning +-Z_RANGE metres around
# the hips, as its SimCC3D codec was trained. rtmlib's own conversion divides
# by the input height instead, so the bins are read here directly.
DEPTH_BINS = 288
Z_RANGE = 2.1744869
# Shoulders-to-hips length used to turn metres into the picture's pixels.
# Adult figures measure about this; the result only sets how deep a turned
# pose looks, so being off by a little shows as a slightly flatter or deeper
# figure, not a broken one.
TORSO_METRES = 0.5


class NoPersonError(ValueError):
    """The picture has nobody in it that is seen well enough to follow."""


@dataclass
class Person:
    """One detected figure, in the picture's pixels."""

    keypoints: np.ndarray  # (133, 2) x, y
    scores: np.ndarray  # (133,)
    # Each keypoint's distance behind the hips' plane, in the same pixels as x
    # and y (positive = away from the viewer); None unless depth was asked for.
    depth: np.ndarray | None = None

    @property
    def visible(self) -> int:
        """How many of the 17 body keypoints are seen: how sure this is a person."""
        return int((self.scores[:17] >= KEYPOINT_THRESHOLD).sum())

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        """(x0, y0, x1, y1) around the keypoints that would be drawn."""
        shown = self.keypoints[self.scores >= KEYPOINT_THRESHOLD]
        x0, y0 = shown.min(axis=0)
        x1, y1 = shown.max(axis=0)
        return float(x0), float(y0), float(x1), float(y1)

    @property
    def points_3d(self) -> np.ndarray:
        """(133, 3): x, y and depth, all in pixels. Flat (depth 0) without depth."""
        depth = self.depth if self.depth is not None else np.zeros(len(self.keypoints))
        return np.column_stack([self.keypoints, depth])


def model_file(spec: tuple[str, str, str], weights_dir: Path | None) -> str:
    """A local path to one of the ONNX files, downloading it the first time.

    Kept as `<weights_dir>/<local name>` (default ~/.cache/poseorbit).
    """
    import shutil
    import zipfile

    from huggingface_hub import hf_hub_download

    repo, filename, name = spec
    folder = weights_dir or DEFAULT_WEIGHTS_DIR
    local = folder / name
    if local.is_file() and local.stat().st_size > 1_000_000:
        return str(local)
    folder.mkdir(parents=True, exist_ok=True)
    downloaded = hf_hub_download(repo, filename)
    partial = local.with_suffix(".part")
    if filename.endswith(".zip"):
        with zipfile.ZipFile(downloaded) as archive:
            member = next(item for item in archive.namelist() if item.endswith(".onnx"))
            with archive.open(member) as source, open(partial, "wb") as target:
                shutil.copyfileobj(source, target)
    else:
        shutil.copyfile(downloaded, partial)
    partial.replace(local)
    return str(local)


def depth_in_pixels(depth_bins: np.ndarray, keypoints: np.ndarray, scores: np.ndarray) -> np.ndarray:
    """RTMW3D's depth bins for one person as pixels of the picture, relative to the hips.

    The model gives depth in metres; the picture is in pixels. The scale comes
    from the torso: its length on screen is the true length foreshortened by
    how far the shoulders lean toward or away from the viewer, which the depth
    itself says, so a figure bending over is not mistaken for a small one.
    """
    metres = (depth_bins / (DEPTH_BINS / 2) - 1) * Z_RANGE
    shoulders = keypoints[[5, 6]].mean(axis=0)
    hips = keypoints[[11, 12]].mean(axis=0)
    seen = scores[[5, 6, 11, 12]].min() >= KEYPOINT_THRESHOLD
    hips_depth = metres[[11, 12]].mean()
    if not seen:
        # No torso to measure: fall back to the figure's height as ~1.6 m.
        shown = keypoints[scores >= KEYPOINT_THRESHOLD]
        height = float(np.ptp(shown[:, 1])) if len(shown) else 1.0
        return (metres - hips_depth) * max(height, 1.0) / 1.6
    lean = metres[[5, 6]].mean() - hips_depth
    on_screen = float(np.hypot(*(shoulders - hips)))
    # Never let the lean eat more than 70% of the torso: past that the
    # estimate is noise, and dividing by almost nothing would explode.
    along = max(TORSO_METRES**2 - lean**2, (0.3 * TORSO_METRES) ** 2) ** 0.5
    pixels_per_metre = max(on_screen, 1.0) / along
    return (metres - hips_depth) * pixels_per_metre


class Detector:
    """Loads its models on first use and is safe to share between threads."""

    def __init__(self, weights_dir: Path | None = None, device: str = "cpu"):
        self.weights_dir = weights_dir
        self.device = device
        self._lock = threading.Lock()
        self._boxes = None
        self._pose_2d = None
        self._pose_3d = None

    def _models(self, depth: bool):
        import onnxruntime
        from rtmlib import RTMPose, RTMPose3d, YOLOX

        # RTMW3D's file carries unused initialisers, and onnxruntime warns
        # about each one on every load; errors still show.
        onnxruntime.set_default_logger_severity(3)
        options = {"backend": "onnxruntime", "device": self.device}
        if self._boxes is None:
            self._boxes = YOLOX(model_file(DETECTOR_FILE, self.weights_dir), model_input_size=(640, 640), **options)
            self._pose_2d = RTMPose(model_file(POSE_2D_FILE, self.weights_dir), model_input_size=(192, 256), **options)
        if depth and self._pose_3d is None:
            self._pose_3d = RTMPose3d(model_file(POSE_3D_FILE, self.weights_dir), model_input_size=(288, 384), **options)
        return self._boxes, self._pose_2d, self._pose_3d

    def detect(self, image: Image.Image, depth: bool = False) -> list[Person]:
        """Everyone in `image`, ordered left to right by the centre of the figure,
        so the same picture always numbers its people the same way.

        Raises NoPersonError when nobody is seen well enough.
        """
        import cv2

        bgr = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)
        with self._lock:
            boxes_model, pose_2d, pose_3d = self._models(depth)
            boxes = boxes_model(bgr)
            if len(boxes) == 0:
                raise NoPersonError("Nobody was found in the picture.")
            keypoints, scores = pose_2d(bgr, bboxes=boxes)
            depth_bins = pose_3d(bgr, bboxes=boxes)[2][..., 2] if depth else None
        # rtmlib returns a "person" even for a blank picture, just with every
        # score low: measured, a white canvas gave 2 of 17 body keypoints over
        # the threshold and noise 0, against 17 for real figures. Half the body
        # is the bar, so a skeleton made of guesses is refused, not followed --
        # per person, so a crowd's half-hidden extras don't become pickable ghosts.
        people = []
        for index in range(len(keypoints)):
            person = Person(np.asarray(keypoints[index], float), np.asarray(scores[index], float))
            if person.visible < MIN_BODY_KEYPOINTS:
                continue
            if depth_bins is not None:
                person.depth = depth_in_pixels(np.asarray(depth_bins[index], float), person.keypoints, person.scores)
            people.append(person)
        if not people:
            raise NoPersonError("Nobody was found in the picture.")
        people.sort(key=lambda person: (person.bbox[0] + person.bbox[2]) / 2)
        return people


def most_confident(people: list[Person]) -> int:
    return max(range(len(people)), key=lambda index: people[index].visible)
