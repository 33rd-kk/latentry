# Changelog

## 0.1.0 (2026-10-05)

First release.

- Find people with YOLOX and DWPose (133 whole-body keypoints), left to
  right; choose one, or everyone.
- Depth for every keypoint from RTMW3D-x on the same boxes; turn the pose
  with an orthographic camera (yaw ±90°, pitch ±45°).
- Frame the output canvas: zoom ×0.5 to ×6 around any point.
- Draw `dwpose` (rtmlib's COCO-WholeBody) or `openpose` (thick, body-only, as
  xinsir's SDXL ControlNet was trained) skeletons, letterboxed onto the
  output's size.
- Library, `python -m poseorbit draw`, and `python -m poseorbit serve`
  (`POST /api/pose`, optional Bearer token).
