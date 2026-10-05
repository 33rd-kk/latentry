import numpy as np
import pytest

from poseorbit import ALL_PEOPLE, Camera, Person
from poseorbit.detect import depth_in_pixels
from poseorbit.geometry import MAX_PITCH, MAX_YAW, MAX_ZOOM, MIN_ZOOM, Framing, fit, frame, scene_centre, view
from poseorbit import chosen


def test_front_view_is_unchanged():
    points = np.random.default_rng(0).uniform(0, 500, (133, 3))
    assert np.allclose(view(points, np.array([250.0, 250.0, 0.0]), Camera()), points[:, :2])


def test_yaw_180_mirrors_left_and_right():
    centre = np.array([100.0, 100.0, 0.0])
    points = np.array([[150.0, 80.0, 0.0], [100.0, 100.0, 30.0]])
    # 180 is past the limit, so use view directly (no clamping there).
    seen = view(points, centre, Camera(yaw=180))
    assert np.allclose(seen[0], [50.0, 80.0])
    assert np.allclose(seen[1], [100.0, 100.0])


def test_yaw_90_puts_depth_on_screen():
    # Camera swung round to the viewer's right, looking back left: what was
    # nearer the viewer (negative depth) is now on the camera's left, and the
    # +x side of the figure faces the camera, so it lands in the middle.
    centre = np.zeros(3)
    near = view(np.array([[0.0, 0.0, -40.0]]), centre, Camera(yaw=90))[0]
    side = view(np.array([[40.0, 0.0, 0.0]]), centre, Camera(yaw=90))[0]
    assert np.allclose(near, [-40.0, 0.0])
    assert np.allclose(side, [0.0, 0.0], atol=1e-9)


def test_pitch_up_shows_the_top():
    # Camera raised: a point nearer the viewer appears lower on screen (y down).
    seen = view(np.array([[0.0, 0.0, -40.0]]), np.zeros(3), Camera(pitch=45))[0]
    assert seen[1] > 0


def test_camera_is_clamped():
    camera = Camera(yaw=500, pitch=-500).clamped()
    assert camera.yaw == MAX_YAW and camera.pitch == -MAX_PITCH


def test_fit_letterboxes_without_stretching():
    # A square picture onto a tall canvas: scaled by width, centred vertically.
    points = fit(np.array([[0.0, 0.0], [100.0, 100.0]]), (100, 100), (200, 400))
    assert np.allclose(points, [[0, 100], [200, 300]])


def test_scene_centre_is_between_everyones_hips():
    people = np.zeros((2, 133, 3))
    people[0, [11, 12]] = [[10, 50, 5], [20, 50, 5]]
    people[1, [11, 12]] = [[110, 70, -5], [120, 70, -5]]
    assert np.allclose(scene_centre(people), [65, 60, 0])


def test_depth_is_relative_to_the_hips_and_scaled_by_the_torso():
    keypoints = np.zeros((133, 2))
    keypoints[[5, 6]] = [[90, 0], [110, 0]]  # shoulders
    keypoints[[11, 12]] = [[90, 100], [110, 100]]  # hips: torso 100 px on screen
    scores = np.ones(133)
    bins = np.full(133, 144.0)  # every point at the hips' depth
    bins[0] = 144 + 144 / 2.1744869 * 0.25  # the nose 0.25 m behind
    depth = depth_in_pixels(bins, keypoints, scores)
    assert depth[11] == pytest.approx(0)
    # Upright torso: 100 px per 0.5 m, so 0.25 m is 50 px.
    assert depth[0] == pytest.approx(50, rel=1e-3)


def _person(x: float) -> Person:
    keypoints = np.tile([x, 0.0], (133, 1))
    return Person(keypoints, np.ones(133))


def test_choosing_people():
    people = [_person(10), _person(20)]
    assert chosen(people, 1) == (1, [people[1]])
    assert chosen(people, ALL_PEOPLE) == (ALL_PEOPLE, people)
    with pytest.raises(ValueError):
        chosen(people, 2)


def test_whole_framing_changes_nothing():
    points = np.array([[10.0, 20.0], [300.0, 400.0]])
    assert np.allclose(frame(points, (832, 1216), Framing()), points)


def test_framing_centres_and_zooms():
    # Zoom 4 on the canvas point (0.5, 0.25): that point moves to the middle,
    # and a point 10 px right of it lands 40 px right of the middle.
    size = (800, 1200)
    seen = frame(np.array([[400.0, 300.0], [410.0, 300.0]]), size, Framing(zoom=4, x=0.5, y=0.25))
    assert np.allclose(seen, [[400, 600], [440, 600]])


def test_pulling_back_shrinks_around_the_middle():
    seen = frame(np.array([[0.0, 0.0]]), (800, 1200), Framing(zoom=0.5))
    assert np.allclose(seen, [[200, 300]])


def test_framing_is_clamped():
    framing = Framing(zoom=100, x=-1, y=2).clamped()
    assert (framing.zoom, framing.x, framing.y) == (MAX_ZOOM, 0.0, 1.0)
    assert Framing(zoom=0.01).clamped().zoom == MIN_ZOOM
