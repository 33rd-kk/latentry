# Changelog

## Unreleased

- **Generate**: prompts are sent in the tag spelling of the profile's model
  family: underscores for SDXL, Illustrious / NoobAI and Pony, spaces for
  Anima, as typed for generic. Settings or tags sent from the gallery arrive
  in that spelling. Each profile's spelling, and the tags it never respells
  (`score_*` by default), can be changed on Settings.
- **Fixed**: sending a Pony picture's settings to the form no longer turns
  `score_9` into `score 9`.
- `long_hair` and `long hair` now count as the same tag when tags are added
  to a prompt.

## 0.2.0 (2026-10-06)

First public release. The manual: https://33rd-kk.github.io/latentry/

- **Generate**: text-to-image, img2img (variation, or a picture as a pose
  reference), inpainting with a painted mask, one form per backend with
  model profiles (Anima, SDXL, Illustrious / NoobAI, Pony, generic).
- **Pose**: pick whose pose in a group picture, turn it in 3D and frame it
  (zoom, move) in a view that shows exactly the skeleton the run will follow
  ([poseorbit](https://github.com/33rd-kk/poseorbit)).
- **Built-in engine**: installed and run from the Setup page, one per NVIDIA
  GPU, stock diffusers; SDXL with an OpenPose ControlNet and Anima with its
  pose adapter.
- **Backends you already run**: any server speaking the
  [backend API](https://33rd-kk.github.io/latentry/backend-api/), and
  AUTOMATIC1111 / Forge.
- **Gallery**: search by prompt, tags, model and file name; WD14 tagging on
  the CPU; send a picture's settings or tags back to the form.
- **Safety**: listens on this computer only unless `LATENTRY_HOST` opens it
  to the network; same-origin and private-network-only `/api`, per-IP
  budgets, settings editable from this machine only by default; gallery
  pictures are read through the file that was checked to be in its folder.
- **Install**: `install.sh` / `install.ps1` show the Latentry logo, build, and
  say which address to open; pose detection comes from
  [poseorbit on PyPI](https://pypi.org/project/poseorbit/).
