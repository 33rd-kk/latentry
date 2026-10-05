# Changelog

## 0.2.0 (2026-10-05)

First public release.

- **Generate**: text-to-image, img2img (variation, or a picture as a pose
  reference), inpainting with a painted mask, one form per backend with
  model profiles (Anima, SDXL, Illustrious / NoobAI, Pony, generic).
- **Pose**: pick whose pose in a group picture, turn it in 3D and frame it
  (zoom, move) in a view that shows exactly the skeleton the run will follow
  ([poseorbit](https://github.com/33rd-kk/poseorbit)).
- **Built-in engine**: installed and run from the Setup page, one per NVIDIA
  GPU, stock diffusers; SDXL with an OpenPose ControlNet and Anima with its
  pose adapter.
- **Backends you already run**: any server speaking
  [docs/backend-api.md](docs/backend-api.md), and AUTOMATIC1111 / Forge.
- **Gallery**: search by prompt, tags, model and file name; WD14 tagging on
  the CPU; send a picture's settings or tags back to the form.
- **Safety**: same-origin and private-network-only `/api`, per-IP budgets,
  settings editable from this machine only by default.
