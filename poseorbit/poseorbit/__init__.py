"""poseorbit: find the people in a picture, pick one (or everyone), turn the
pose in 3D, and draw the skeleton a pose-conditioned image model follows.

    from poseorbit import Detector, Camera, pose

    detector = Detector()
    result = pose(detector, picture, size=(832, 1216), person=0,
                  camera=Camera(yaw=45), style="openpose")
    result.skeleton.save("skeleton.png")
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image

from .detect import KEYPOINT_THRESHOLD, Detector, NoPersonError, Person, most_confident
from .draw import STYLES, Style, letterbox, render
from .geometry import MAX_PITCH, MAX_YAW, MAX_ZOOM, MIN_ZOOM, Camera, Framing, fit, frame, scene_centre, view

__version__ = "0.1.0"

# Person index meaning "everyone detected", for a group pose.
ALL_PEOPLE = -1

__all__ = [
    "ALL_PEOPLE",
    "Camera",
    "Detector",
    "Framing",
    "KEYPOINT_THRESHOLD",
    "MAX_PITCH",
    "MAX_YAW",
    "MAX_ZOOM",
    "MIN_ZOOM",
    "NoPersonError",
    "Person",
    "PoseResult",
    "STYLES",
    "Style",
    "letterbox",
    "pose",
    "render",
]


@dataclass
class PoseResult:
    skeleton: Image.Image
    # Everyone detected, left to right, and which of them was drawn (ALL_PEOPLE for all).
    people: list[Person]
    person: int
    # The camera and framing actually used, after clamping.
    camera: Camera
    framing: Framing
    # The drawn people's body joints (of 17 each) that are seen and inside the
    # canvas, for the one with the most: few left (a close-up) means a
    # body-only skeleton has little to follow.
    joints_in_frame: int


def chosen(people: list[Person], person: int | None) -> tuple[int, list[Person]]:
    """`person` resolved (None = the most confident) and the people it means."""
    if person is None:
        person = most_confident(people)
    if person == ALL_PEOPLE:
        return person, people
    if 0 <= person < len(people):
        return person, [people[person]]
    raise ValueError(f"No person {person}: {len(people)} found.")


def pose(
    detector: Detector,
    image: Image.Image,
    size: tuple[int, int],
    person: int | None = None,
    camera: Camera | None = None,
    style: Style = "dwpose",
    depth: bool = False,
    framing: Framing | None = None,
) -> PoseResult:
    """Detect, choose, turn and draw in one call.

    `person` is an index into the left-to-right order, ALL_PEOPLE for
    everyone, None for the most confident. A `camera` other than the front
    view needs depth, so it is detected then whatever `depth` says. The
    skeleton is drawn at `size` (the output's width, height), letterboxed,
    then `framing` zooms and moves it on that canvas.
    """
    camera = (camera or Camera()).clamped()
    framing = (framing or Framing()).clamped()
    people = detector.detect(image, depth=depth or not camera.is_front)
    person, drawn = chosen(people, person)
    points = np.stack([p.points_3d for p in drawn])
    if camera.is_front:
        flat = points[..., :2]
    else:
        # Everyone turns around one shared centre, so a group keeps its layout.
        flat = view(points, scene_centre(points), camera)
    keypoints = frame(fit(flat, (image.width, image.height), size), size, framing)
    scores = np.stack([p.scores for p in drawn])
    inside = (keypoints >= 0).all(axis=-1) & (keypoints < np.array(size)).all(axis=-1)
    joints = int(((scores[:, :17] >= KEYPOINT_THRESHOLD) & inside[:, :17]).sum(axis=1).max())
    return PoseResult(render(keypoints, scores, size, style), people, person, camera, framing, joints)
