# poseorbit

**Take the pose from a picture, pick whose, look at it from another angle or
closer in, and get the skeleton your image model follows.**

poseorbit finds every person in a picture, lets you choose one (or everyone),
turns the whole-body pose (hands and face included) in 3D, frames it (from a
face close-up to room around the figure), and draws the skeleton in the exact style a pose-conditioned model was trained on. It is a
small Python package: CPU only, no torch, usable as a library, a command, or
an HTTP server.

```python
from PIL import Image
from poseorbit import Camera, Detector, Framing, pose

result = pose(Detector(), Image.open("group.png"), size=(832, 1216),
              person=1, camera=Camera(yaw=40, pitch=10),
              framing=Framing(zoom=2, x=0.5, y=0.35), style="openpose")
result.skeleton.save("skeleton.png")   # feed this to your ControlNet / pose adapter
```

## What sets it apart

Turning a pose in 3D for ControlNet is not new: 3D OpenPose editors let you
pose a mannequin by hand, and some ComfyUI node packs lift a detected body to
3D. poseorbit's choices are different:

- **Depth for all 133 whole-body points, from one picture.** x and y come
  from DWPose (RTMW-DW-x-l) and depth from RTMW3D-x, run on the *same*
  person boxes. Hands and face turn with the body instead of staying flat or
  being dropped, and the front view is pixel-identical to plain 2D detection.
- **Choose a person in a group.** Everyone found comes back left to right
  with a box, so index 1 is the same person on every call; draw one of them
  or all of them, turned together around a shared centre so the group keeps
  its layout.
- **Drawn for the model that will read it.** `dwpose` is rtmlib's
  COCO-WholeBody drawing (thin lines, hands and face), the usual input of
  DWPose-trained adapters. `openpose` is the thick, body-only drawing
  xinsir's OpenPose ControlNet for SDXL was trained on, line width growing
  with the canvas as its model card specifies.
- **Framing, not just turning.** Zoom from ×0.5 to ×6 around any point of
  the output canvas: a face or upper-body close-up from a full-body
  reference, or a smaller figure with room around it. The answer says how
  many body joints are left in the frame, so a client can warn when a
  body-only skeleton has little to follow.
- **What you preview is what is followed.** The camera is orthographic and
  the whole mapping (turn, letterbox, framing) is specified (below), so a
  browser viewer can show exactly what the server will draw; Latentry's
  three.js view is tested to match it within 0.05 px.
- **No framework attached.** No ComfyUI or web UI required, no torch, no
  GPU: a library, `python -m poseorbit draw`, or `python -m poseorbit serve`
  answering `POST /api/pose`. A generation server can embed the same handler
  so both speak one API.
- **Guard rails from measurement.** Turning is held to ±90° yaw and ±45°
  pitch, where single-picture depth is still mostly right; detections with
  fewer than 8 of 17 body joints seen are not offered as people (a blank
  canvas otherwise "finds" one).

### Measured

Generated with the skeleton (body-PCK@0.1 of the re-detected output against
the skeleton; 1.0 = every body joint within 10% of the diagonal), 832×1216,
same seed with and without:

| Model | Pose | Without | With |
|---|---|---|---|
| Illustrious XL 2.0 + xinsir OpenPose ControlNet (`openpose`) | walking, front | 0.76 | **0.94** |
| same | standing, front | 0.47 | **0.76** |
| same | walking, turned yaw 45° / yaw −60° pitch 15° | — | **0.94 / 0.88** |
| Anima Base 1.0 + Anima-Control-Pose (`dwpose`) | walking, front | 0.06 | **0.71** |
| same | walking, turned yaw 45° | — | **0.94** |

Framed, scored on the body and face points left in the frame (prompt says
"upper body" or "portrait, close-up" in both runs):

| Model | Framing | Without | With |
|---|---|---|---|
| Illustrious XL 2.0 + xinsir ControlNet | upper body, ×2 | 0.02 | **1.00** |
| same | face, ×5 (7 body joints left) | 0.48 | **0.99** |
| Anima Base 1.0 + Anima-Control-Pose | upper body ×2 / face ×5 | 0.93 / 0.97 | 0.93 / 0.99 |

Anima already centres a close-up by itself, so the score barely moves; with
the skeleton the head's tilt and turn follow the reference.

Detection takes about 0.7 s for one person on a desktop CPU (all three models).

## Install

```sh
pip install -e .                 # library and command
pip install -e ".[server]"       # plus the HTTP server
```

The model files (about 700 MB) download from Hugging Face on first use into
`~/.cache/poseorbit`, or the `weights_dir` you give `Detector`.

## Use

```sh
python -m poseorbit draw ref.png skeleton.png --size 832x1216 --person -1 --yaw 40 --style openpose
python -m poseorbit draw ref.png face.png --size 832x1216 --zoom 5 --centre 0.62,0.2
python -m poseorbit serve --port 7870      # POSEORBIT_TOKEN=... to require a Bearer token
```

`person` is an index into the left-to-right order, `-1` for everyone, or
omitted for the most confident. `poseorbit/api.py` documents the HTTP JSON;
with `want_3d` the answer carries each person's 133 3D points for a viewer.

## Coordinates

x right, y down, depth away from the viewer, all in the picture's pixels
(the API scales them by the picture's width). The camera at (`yaw`, `pitch`)
stands at `(sin yaw · cos pitch, −sin pitch, −cos yaw · cos pitch)` from the
centre (the middle of the drawn people's hips). In a y-up, z-toward-viewer
frame such as three.js that is `(sin yaw · cos pitch, sin pitch, cos yaw ·
cos pitch)`.

The turned picture is letterboxed onto the output canvas, then framed:
canvas point `(x, y)` (fractions) goes to the middle and everything scales
by `zoom` around it. Framing never moves the point the camera orbits.

## Limits

- Depth is estimated from a single picture: past a side view, which limb is
  in front gets unreliable. That is why the camera is limited.
- Chosen from a group, a person is drawn where they stand in the picture,
  letterboxed onto the output; a small figure gives a small skeleton, which
  models tend to follow loosely.
- Some models do not tell front from back by the skeleton alone; the face
  points help, the prompt decides the rest.

## Used by

Latentry, a local web UI for diffusion backends, uses poseorbit for its pose
slot and 3D pose view.

## Test

```sh
pip install -e ".[test]" && pytest
```

## License

Apache-2.0. See [LICENSE](LICENSE), and [NOTICE](NOTICE) for the third-party
work poseorbit builds on (rtmlib; the OpenPose drawing from xinsir's model
card and controlnet_aux). The model files (OpenMMLab's YOLOX, RTMW and RTMW3D,
Apache-2.0) are downloaded, not shipped.
