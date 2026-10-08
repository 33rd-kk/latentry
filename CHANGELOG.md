# Changelog

## Unreleased

- **img2img**: a detailed source picture with a mask no longer fails with
  "Invalid JSON body". Latentry accepted only the first 10MB of a request
  and cut the rest. It now takes up to 48MB, and above that the page says the
  pictures are too large before sending them.
- **Generate page**: a slider moved away from its default shows a reset
  arrow next to its label, which puts it back to the profile's value. This
  covers width, height, steps, image count, CFG and both strengths.
- **LoRA**: on a backend that does not load LoRAs (anything but an A1111
  web UI), a `<lora:…>` or `<lyco:…>` tag in the prompt shows a note that it
  is read as plain words.
- **Pairing**: a phone or another computer must now be paired before it can
  use Latentry. On this computer, **Settings > Phones and other computers >
  Add a device** shows a code (one use, 10 minutes) to type on the other
  device, with a name if you like; it then stays paired for 30 days. The
  same card lists the paired devices with when each ends, and removes one or
  all of them. A paired device's Settings page shows when its pairing ends
  and can unpair it, and every page warns from three days before. The list
  keeps no record of use and is stored encrypted. The key can be kept in the
  system keychain and passed in `LATENTRY_PAIRING_KEY`; the network guide
  shows how on Windows, macOS and Linux. This computer needs nothing. `LATENTRY_PAIRING=off` turns it off,
  for a reverse proxy that does its own login.
- **Security**: the per-device request limits count the address a
  connection really comes from, and believe `X-Forwarded-For` only from this
  computer. Stopping a run takes that run's id. The engine answers only
  requests addressed to this computer, and run by hand it refuses to listen
  beyond it without `LATENTRY_ENGINE_TOKEN`.
- **Secret mode** blurs every picture until you choose to show it: the
  gallery's viewer (one picture at a time, with **Show for this picture**,
  blurred again on the next one or when it closes), the generate page's
  results and their full-size view (**Show results**, per run), the source
  picture in its preview and the mask editor (strokes stay sharp), and the
  picture you pick a pose's person from (its numbered boxes stay sharp).
  On the generate page each has a **Show** / **Blur** button, so a picture
  can be blurred again, on a phone too. The full-size viewer has its own
  secret-mode switch in the bar, so it can be turned on without closing
  the picture; turning it on blurs anything shown before.
- **From gallery** (source and pose pictures) opens in place, under its
  button, instead of as a dialog over the page, so the header and its
  secret-mode switch stay one tap away while you choose.
- **Engine**: the token in `LATENTRY_ENGINE_TOKEN` is compared in constant
  time. The engine has tests (models folder, GPU plan, the HTTP API's token
  and input checks), which CI runs without a GPU or a model.

## 0.4.0 (2026-10-08)

**Upgrading from 0.3.0**: Latentry now needs **Node.js 22.19 or newer** (was
22.12), for undici 8. Update Node.js first, then update Latentry as usual.

**Gallery**

- Order pictures oldest first, by name, by file size, by when they were made
  or by pixel count. Filter them by shape, file type, age, resolution, model,
  where the settings came from, and whether they have WD14 tags.
- The search box takes settings as `key:value` (`model:noobai`, `steps:>=30`,
  `w:1024`), and leaves pictures out with a leading `-` (`-smile`,
  `-"long hair"`, `-model:pony`).
- **Stack** pictures that share a prompt or a seed into one card, and open a
  stack to see them. **Compare** two selected pictures with a slider (or side
  by side), their differing settings and the prompt tags only one has.
- Settings are read from JPEG and WebP too (A1111 / Forge's EXIF, ComfyUI's
  WebP), along with the LoRAs a picture used, which the viewer lists. Before,
  only PNGs had settings. Only the headers are read, and from EXIF only the
  fields that hold settings.
- **Show in folder** and **Open in default app** in the viewer open a
  picture in this computer's file manager (selected) or its picture app.
  They appear only when the browser runs on the same computer, and never act
  on a file outside the gallery folders. The gallery still has no delete,
  move or rename, by design.
- The order and filters are not kept in the browser; what the gallery reads
  to sort a folder stays in memory.

**Privacy**

- A finished run's pictures and prompt leave Latentry's memory once no page
  may load them any more (an hour, a minute for a secret run), instead of
  staying until that backend's next run.
- The engine reads a single-file SDXL model's config files from Hugging
  Face's cache after the first load, instead of asking the Hub each time.
- Prompt fields and search boxes no longer use the browser's spell check
  (which some browsers do online) or autofill.
- Secret mode: a character saved while it is on is kept in that tab, marked
  *temporary*, and dropped when secret mode is turned off (before, it
  vanished on the next reload). A comparison shown with **Show** is hidden
  again when it is closed.
- A new [Privacy](https://33rd-kk.github.io/latentry/guide/privacy/) page in
  the manual lists what goes over the network and what is kept where, and
  the Secret mode page covers Compare, Download and what turning it off
  keeps.

**Backends and install**

- When a backend cannot use the source image, inpaint mask or skeleton pose,
  the form says why and what would turn it on, instead of just leaving it
  out. The same goes for a pose without the 3D view, and for a skeleton
  dropped after switching to a backend without pose. Servers can give their
  own reason in a new optional `/api/health` field, `unavailable`.
- `install.sh --no-engine` (`install.ps1 -NoEngine`) is for servers you
  already run: it turns off the built-in engine in a new `.env.local` and
  points you to Settings instead of the Setup page.

**Look**

- README and manual lead with what Latentry is for: private, local image
  generation, and a gallery that remembers how every picture was made. A new
  banner, also drawn by the logo that the install scripts and `npm start`
  print, which fits a 120-column terminal.
- Dark mode: the 3D pose view and the skeleton preview have a visible edge,
  dialogs dim the page behind them, and sliders show their whole track. The
  3D view's floor grid is a little brighter in both themes.

**Fixed**

- Viewing a WebP or JPEG in the gallery no longer keeps the file open, so it
  can be renamed or deleted elsewhere while Latentry runs.

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
