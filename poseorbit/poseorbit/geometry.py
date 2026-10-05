"""Seeing a pose from another angle, and fitting it onto the output's canvas.

Coordinates are the picture's: x right, y down, and depth (z) away from the
viewer, all in pixels. The camera orbits the figure: `yaw` swings it to the
viewer's right, `pitch` raises it. The view is orthographic, as the detector's
depth is (it has no notion of how far the original camera stood), so turning
never makes a figure bigger or smaller.

A browser viewer that wants to match this puts the camera, around the same
centre and in a y-up, z-toward-viewer frame (three.js's), at
(sin yaw cos pitch, sin pitch, cos yaw cos pitch) and reads the angles back the
same way: yaw = atan2(x, z), pitch = atan2(y, hypot(x, z)).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

# How far the camera may swing. The depth comes from one picture, so a large
# turn shows its guesses: past a side view, limbs' front and back order goes
# wrong more often than not. Clients should hold their controls to these.
MAX_YAW = 90.0
MAX_PITCH = 45.0


@dataclass(frozen=True)
class Camera:
    yaw: float = 0.0  # degrees, + = camera to the viewer's right
    pitch: float = 0.0  # degrees, + = camera above

    def clamped(self) -> "Camera":
        return Camera(
            yaw=float(np.clip(self.yaw, -MAX_YAW, MAX_YAW)),
            pitch=float(np.clip(self.pitch, -MAX_PITCH, MAX_PITCH)),
        )

    @property
    def is_front(self) -> bool:
        return abs(self.yaw) < 1e-6 and abs(self.pitch) < 1e-6


def view(points: np.ndarray, centre: np.ndarray, camera: Camera) -> np.ndarray:
    """(..., 3) points seen from `camera` orbiting `centre`: (..., 2) on screen.

    The front view (yaw 0, pitch 0) returns x and y unchanged.
    """
    yaw, pitch = math.radians(camera.yaw), math.radians(camera.pitch)
    # Where the camera stands, as a unit vector from the centre (y down, z away).
    position = np.array([math.sin(yaw) * math.cos(pitch), -math.sin(pitch), -math.cos(yaw) * math.cos(pitch)])
    forward = -position
    right = np.cross([0.0, 1.0, 0.0], forward)
    right /= np.linalg.norm(right)
    down = np.cross(forward, right)
    relative = points - centre
    return np.stack([relative @ right, relative @ down], axis=-1) + centre[:2]


def scene_centre(points: np.ndarray) -> np.ndarray:
    """The point to orbit: the middle of everyone's hips, at the hips' depth.

    `points` is (N, 133, 3). Depth is relative to each person's own hips, so
    every person turns in place; the centre's x and y are shared so a group
    keeps its arrangement.
    """
    hips = points[:, [11, 12]].reshape(-1, 3).mean(axis=0)
    return np.array([hips[0], hips[1], 0.0])


def fit(keypoints: np.ndarray, source: tuple[int, int], size: tuple[int, int]) -> np.ndarray:
    """Keypoints from a `source`-sized picture placed on a `size` canvas, scaled
    uniformly and centred (letterboxed) -- never stretched, so a landscape
    reference does not come out as a squashed figure on a portrait canvas."""
    scale = min(size[0] / source[0], size[1] / source[1])
    offset = (np.array(size) - np.array(source) * scale) / 2
    return keypoints * scale + offset
