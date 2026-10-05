"""The /api/pose handler without models: a stand-in detector returns fixed people."""

import base64
import io

import numpy as np
import pytest
from PIL import Image

from poseorbit import MAX_YAW, MAX_ZOOM, NoPersonError, Person
from poseorbit.api import BadRequest, handle


def _person(x: float) -> Person:
    """A standing figure centred at x on a 400x600 picture, all points seen."""
    keypoints = np.zeros((133, 2))
    keypoints[:, 0] = x
    keypoints[:, 1] = 150  # hands, feet and face around the head
    keypoints[:17, 1] = np.linspace(100, 650, 17)  # body, head to feet; the feet run past the bottom edge
    keypoints[[5, 11], 0] = x + 20  # left shoulder and hip
    keypoints[[6, 12], 0] = x - 20  # right shoulder and hip
    return Person(keypoints, np.ones(133), depth=np.zeros(133))


class StubDetector:
    def __init__(self, people):
        self.people = people
        self.asked_depth = None

    def detect(self, image, depth=False):
        self.asked_depth = depth
        if not self.people:
            raise NoPersonError("Nobody was found in the picture.")
        return self.people


def _picture() -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (400, 600), "white").save(buffer, "PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def test_an_answer_has_everything_a_client_needs():
    answer = handle(StubDetector([_person(100), _person(300)]), {"image_base64": _picture(), "width": 832, "height": 1216})
    assert answer["width"] == 832 and answer["height"] == 1216
    assert answer["person"] in (0, 1)
    assert answer["camera"] == {"yaw": 0.0, "pitch": 0.0, "framing": {"zoom": 1.0, "x": 0.5, "y": 0.5}}
    assert answer["limits"] == {"yaw": 90.0, "pitch": 45.0, "zoom": [0.5, 6.0]}
    assert answer["style"] == "dwpose"
    assert len(answer["people"]) == 2
    assert all("points_3d" not in person for person in answer["people"])
    skeleton = Image.open(io.BytesIO(base64.b64decode(answer["skeleton_base64"])))
    assert skeleton.size == (832, 1216)


def test_boxes_stay_inside_the_picture():
    answer = handle(StubDetector([_person(200)]), {"image_base64": _picture()})
    assert all(0 <= edge <= 1 for edge in answer["people"][0]["bbox"])


def test_want_3d_adds_points_in_picture_widths():
    detector = StubDetector([_person(200)])
    answer = handle(detector, {"image_base64": _picture(), "want_3d": True})
    assert detector.asked_depth is True
    points = answer["people"][0]["points_3d"]
    assert len(points) == 133 and len(points[0]) == 3
    assert points[0][0] == pytest.approx(200 / 400)


def test_camera_and_framing_are_clamped():
    answer = handle(
        StubDetector([_person(200)]),
        {"image_base64": _picture(), "camera": {"yaw": 500, "framing": {"zoom": 100, "x": 2}}},
    )
    assert answer["camera"]["yaw"] == MAX_YAW
    assert answer["camera"]["framing"]["zoom"] == MAX_ZOOM
    assert answer["camera"]["framing"]["x"] == 1.0


def test_zooming_in_leaves_fewer_joints_in_frame():
    body = {"image_base64": _picture(), "width": 400, "height": 600}
    whole = handle(StubDetector([_person(200)]), body)
    close = handle(StubDetector([_person(200)]), {**body, "camera": {"framing": {"zoom": 6, "y": 0.2}}})
    assert close["joints_in_frame"] < whole["joints_in_frame"]


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"image_base64": ""},
        {"image_base64": "not a picture"},
        {"image_base64": "PIC", "width": 10},
        {"image_base64": "PIC", "person": -2},
        {"image_base64": "PIC", "person": True},
        {"image_base64": "PIC", "style": "sketch"},
        {"image_base64": "PIC", "camera": 5},
        {"image_base64": "PIC", "camera": {"yaw": "left"}},
        {"image_base64": "PIC", "camera": {"framing": {"zoom": float("nan")}}},
    ],
)
def test_bad_requests_are_refused(body):
    if body.get("image_base64") == "PIC":
        body = {**body, "image_base64": _picture()}
    with pytest.raises(BadRequest):
        handle(StubDetector([_person(200)]), body)


def test_nobody_and_a_person_past_the_end_are_refused():
    with pytest.raises(NoPersonError):
        handle(StubDetector([]), {"image_base64": _picture()})
    with pytest.raises(ValueError):
        handle(StubDetector([_person(200)]), {"image_base64": _picture(), "person": 3})
