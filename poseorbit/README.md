# poseorbit

Find the people in a picture, pick one (or everyone), turn the pose in 3D,
and draw the skeleton a pose-conditioned image model follows.

- **Detect**: a YOLOX person detector and DWPose (RTMW-DW-x-l, 133
  whole-body keypoints) through [rtmlib](https://github.com/Tau-J/rtmlib),
  on the CPU with onnxruntime. People come back left to right, so an index
  names the same person every time.
- **Depth** (optional): RTMW3D-x on the same boxes adds how far each keypoint
  is in front of or behind the hips.
- **Turn**: an orthographic camera orbiting the figure, `yaw` up to ±90° and
  `pitch` up to ±45°. Past that, depth from a single picture is mostly guesswork.
- **Draw**: `dwpose` (rtmlib's COCO-WholeBody drawing, as Anima-Control-Pose
  was trained on) or `openpose` (the OpenPose layout OpenPose ControlNets
  were trained on), on black, letterboxed onto the output's size.

No torch. The ONNX files (about 700 MB in total, all Apache-2.0) download from
Hugging Face on first use into `~/.cache/poseorbit`, or a `weights_dir` you pass.

## Use

```python
from PIL import Image
from poseorbit import Camera, Detector, pose

detector = Detector()                      # or Detector(Path("weights"))
result = pose(detector, Image.open("ref.png"), size=(832, 1216),
              person=0, camera=Camera(yaw=40, pitch=10), style="openpose")
result.skeleton.save("skeleton.png")
[p.bbox for p in result.people]            # everyone found, in the picture's pixels
```

```sh
python -m poseorbit draw ref.png skeleton.png --size 832x1216 --yaw 40
pip install "poseorbit[server]" && python -m poseorbit serve --port 7870
```

The server answers `POST /api/pose`; `poseorbit/api.py` documents the JSON.
A generation server can embed the same handler (`poseorbit.api.handle`), so
both speak the same API.

## Coordinates

x right, y down, depth away from the viewer, all in the picture's pixels.
The camera at (`yaw`, `pitch`) stands at
`(sin yaw · cos pitch, −sin pitch, −cos yaw · cos pitch)` from the centre
(y down, z away). In a y-up, z-toward-viewer frame such as three.js that is
`(sin yaw · cos pitch, sin pitch, cos yaw · cos pitch)`, so a 3D viewer can
show exactly the view the server will draw.

## Test

```sh
pip install -e ".[test]" && pytest
```

Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE) for the third-party
work it builds on. The model files (OpenMMLab's YOLOX, RTMW and RTMW3D) are
Apache-2.0 too, and are downloaded, not shipped.
