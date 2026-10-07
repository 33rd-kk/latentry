# Changelog

## Unreleased

- **Generate**: prompts are sent in the tag spelling of the profile's model
  family: underscores for SDXL, Illustrious / NoobAI and Pony, spaces for
  Anima, as typed for generic. Settings or tags sent from the gallery arrive
  in that spelling. Each profile's spelling, and the tags it never respells
  (`score_*` by default), can be changed on Settings.
- **Generate**: **Share across backends** next to the prompt chooses
  whether the prompt and artist are kept per backend (the default) or shared
  by every backend. The negative prompt stays per backend.
- **Fixed**: sending a Pony picture's settings to the form no longer turns
  `score_9` into `score 9`.
- `long_hair` and `long hair` now count as the same tag when tags are added
  to a prompt.
- **Settings**: a backend token is only sent to the server it was set up
  for (same scheme, host and port). **Test** no longer lends a saved token to
  another address; changing a backend's address asks for its token again (or
  for it to be removed); and `GEN_TOKEN_<ID>` only applies while
  `GEN_BACKENDS` lists that id at the same address, so a backend added only on
  the Settings page needs its token typed there.
- **Secret mode** now also keeps a run to the page that started it (no
  other tab, reload or device picks it up, and the server forgets it a minute
  after it ends), keeps what the gallery sends to the form out of browser
  storage, and blurs the gallery picker and hides WD14 tags. Pictures are
  still saved to the gallery folder.
- **Gallery**: pictures and thumbnails are no longer kept in the browser's
  cache.
- **Security**: whether a request comes from this machine (for changing
  settings) is decided by the connection's real address too, so a program on
  the LAN can no longer pass by writing `Host` and `X-Forwarded-For`.
- `npm start`, `npm run dev` and `npm run build` turn Next.js's anonymous
  usage reports off, and the engine runs with Hugging Face's off and without
  the other backends' tokens in its environment.
- **Settings**: the wildcards in a profile's never-respelled tags are matched
  without a regular expression, so a pattern with many `*` can no longer
  freeze the generate page on a long tag.

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
