# Changelog

## Unreleased

- **Secret mode**: a character saved while it is on is kept in that tab,
  marked *temporary*, and dropped when secret mode is turned off. Before, it
  showed in the list without being saved and vanished on the next reload.
- **Backends**: when a backend cannot use the source image, inpaint mask or
  skeleton pose, the form now says why and what would turn it on, instead of
  just leaving it out. The same goes for a pose without the 3D view, and for
  a skeleton dropped after switching to a backend without pose. Servers can
  give their own reason in a new optional `/api/health` field, `unavailable`.
- Latentry now needs **Node.js 22.19 or newer** (was 22.12), for undici 8.

## 0.3.0 (2026-10-07)

**Upgrading from 0.2.0**: a backend token is now only sent to the server it
was set up for. A `GEN_TOKEN_<ID>` applies only while `GEN_BACKENDS` lists
that id at the same address (scheme, host and port); a backend added only on
the Settings page needs its token typed there. Moving a backend to another
address on Settings asks for its token again.

**Security**

- Backend tokens could be sent to another address by anyone who can change
  settings: **Test** lent a saved token to any URL, and a backend kept its
  token when its address changed. Tokens now stay with their server.
- "Only from this machine" (the default `SETTINGS_EDIT=local`) went by the
  `Host` and `X-Forwarded-For` headers, which a program on the LAN can
  write. It now also checks the address the connection really came from.
- `npm start`, `npm run dev` and `npm run build` turn Next.js's anonymous
  usage reports off; the engine runs with Hugging Face's off and without the
  other backends' tokens in its environment.

**Secret mode**

- Easy to see: while it is on, the header shows a filled **Secret** pill.
- A run started in secret mode stays on the page that started it: no other
  tab, reload or device picks it up, and the server forgets it a minute
  after it ends.
- What the gallery sends to the form is no longer written to browser
  storage; the gallery picker blurs pictures and WD14 tags are hidden too.
- In the gallery panel, **Show for this picture** reveals one picture's
  prompt, settings and tags while it is on screen, and analysing a picture
  says how many tags were found while they are hidden.
- A new [manual page](https://33rd-kk.github.io/latentry/guide/secret-mode/)
  says what it hides, and what it does not: pictures are still saved to the
  gallery folder with their prompt, and shown in the gallery.

**Generate**

- Prompts are sent in the tag spelling of the profile's model family:
  underscores for SDXL, Illustrious / NoobAI and Pony, spaces for Anima, as
  typed for generic. Settings or tags sent from the gallery arrive in that
  spelling. Each profile's spelling, and the tags it never respells
  (`score_*` by default), can be changed on Settings.
- **Share across backends** next to the prompt keeps one prompt and artist
  for every backend; the negative prompt stays per backend.
- `long_hair` and `long hair` count as the same tag when tags are added to a
  prompt.

**Gallery**

- Pictures and thumbnails are no longer kept in the browser's cache.
- A card's full tag list folds back with **Show less** (bigger on touch
  screens), a click or tap outside the card, or Esc.

**Fixed**

- SDXL img2img counted one step too many whenever steps × strength was not
  a whole number, so a batch stopped at e.g. 23/24 until its pictures came.
- Sending a Pony picture's settings to the form no longer turns `score_9`
  into `score 9`.

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
