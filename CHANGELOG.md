# Changelog

## Unreleased

- **The guide checked against the app**: browser tests now walk through
  what the guide says about Generate, the gallery, pose, secret mode, Setup
  and pairing. Where they disagreed, the guide was corrected: a secret run's
  pictures are saved to the gallery (the threat model said they were not),
  and Settings now describes the folders' display names and the pairing
  card, and the guide's Setup page the switch for the LoRA list on paired
  devices.
- **Fixed**: a prompt typed just before switching backends was lost from
  the first backend's form.
- **Fixed**: once secret mode was turned off, the saved-characters box went
  blank instead of saying there are none.
- **Screen readers** now hear a name for every slider on Generate, for the
  gallery's filter menus and for the saved-characters menu.
- **New screenshots in the guide**: the gallery and its viewer as they look
  now, filters, Compare, hires fix, upscaling a source, secret mode on
  Generate, pairing a phone, the 3D view, Setup with the engine running and
  a ComfyUI workflow; the README's gallery and viewer shots are retaken too.
  `npm run docs:screenshots` retakes them from a clean Latentry, with public
  example pictures or a gallery the engine draws for the purpose.

## 0.9.0 (2026-10-18)

**Upgrading from 0.8.2**: after the usual update, stop and start the engine
on Setup once, so it runs engine 0.7.0 with hires fix and Upscale (Setup
says so while the old one runs). There is nothing new to install.

**Hires fix**

- **A Hires fix section on Generate**: each picture drawn from the prompt
  (with or without a skeleton pose) is upscaled and redrawn at the larger
  size: choose the upscaler, how much larger, the hires steps (0: as many as
  the first pass) and the denoising strength. Off by default. The progress
  bar counts both passes, and the second pass runs exactly the hires steps
  on every backend.
- **On A1111 / Forge** it is the web UI's own hires fix, with its upscalers
  (Lanczos, R-ESRGAN and the like) and latent modes. Only upscalers already
  on disk are offered, so none makes the web UI download a model. Forge and
  its forks get the fields their second pass needs and the first pass's CFG.
- **On ComfyUI** the built-in graph upscales with Lanczos or an upscale model
  from ComfyUI's `upscale_models` folder (listed by file name, so its
  folders stay on that machine), then samples again with the same prompts,
  LoRAs and skeleton. A workflow from the folder keeps its own passes.
- **On Latentry's engine** SDXL and Anima models upscale with Lanczos (no
  upscale model to fetch) and redraw on the same weights and LoRAs, one
  picture at a time, decoding the larger picture in tiles. With SDXL the
  second pass follows the skeleton too; on Anima, hires fix and a pose do
  not go together yet.
- **Saved like A1111**: the picture records the size it was drawn at with
  `Hires upscale`, `Hires steps` and `Hires upscaler`, so other tools read it,
  and the gallery's **Generate with these settings** turns hires fix back on.
  Reading an A1111 picture no longer takes its hires `Denoising strength`
  for an img2img source's.

**Upscale**

- **Upscale a picture from the gallery**: a new **Upscale** button in the
  side panel (and a third mode of the source image) makes a finished picture
  larger and redraws its detail, hires fix for a picture that already exists.
  The picture's own prompts come along. A1111 / Forge enlarge it in the
  Extras tab with the chosen upscaler, ComfyUI in the graph with Lanczos or
  an upscale model, Latentry's engine with Lanczos; then one redraw at the
  hires denoise. Up to 4096 pixels a side.
- **Recorded as an upscale**: the saved picture says mode `upscale`, the
  size it had before and its hires settings.

**Gallery**

- **The real size**: the side panel's Size is now the picture's own size. For
  a picture drawn smaller and then enlarged, a **Drawn at** line shows the
  size its settings name. The panel also shows a picture's hires settings.

**Backend API**

- `/api/health` may answer `hires`, `upscale` and `upscalers`, and
  `/api/generate` takes `hr_scale`, `hr_steps`, `hr_denoise`, `hr_upscaler`
  and `upscale`, for diffusers-compatible servers that want to offer them
  (see docs/backend-api.md).

## 0.8.2 (2026-10-14)

**Upgrading from 0.8.1**: nothing to do beyond the usual update. On
Windows, the next start gives Latentry's private files their owner-only
access list.

**Security and privacy**

- **Private files restricted at start**: on Windows the settings file, the
  pairing key, the paired-device list and the folder-name key now all get
  their owner-only access list when Latentry starts. Before, each got it
  the first time it was used, so a pairing key nobody had used since an
  update stayed readable by other users until then.
- **The version on Settings**: Settings shows the version of Latentry it
  runs, so it can be matched against published security advisories. Like
  the rest of Settings, it is shown on this computer only. The LIGSP
  conformance page gets the profile's new OPS-3 row.
- **The engine's version on Setup**: each running engine shows its
  version, and Setup says when it differs from the engine in Latentry's
  folder, which means it was started before an update and needs a stop and
  start.

**Manual**

- **LIGSP conformance**: the manual has a new page with Latentry's
  conformance table for the Local Image Generation Security Profile (LIGSP
  0.1, level 2), the profile Latentry is the reference implementation of.
  The README, SECURITY.md and the threat-model page link to it, and the
  threat-model page says how to check your own setup with the profile's
  read-only checker (`uvx local-image-gen-security check ...`).
- **Checking a download against its tag**: Getting started now adds
  `--source-ref refs/tags/vX.Y.Z` to `gh attestation verify`, which also
  checks that the file was built from that release's tag.

## 0.8.1 (2026-10-13)

**Upgrading from 0.8.0**: nothing to do. The first load of a single-file
SDXL checkpoint fetches SDXL's config files once (a few MB of text) into the
engine's controls folder. A diffusers folder model whose weights are only in
a pickle format is now refused; get its `.safetensors` files.

**Security and privacy**

- **Settings says whether Latentry is open to your network**: the pairing
  card now says when Latentry listens beyond this computer
  (`LATENTRY_HOST`), and how to open it when it does not.
- **Private files stay private on Windows**: the settings file, the pairing
  key, the paired-device list and the folder-name key now get an access
  list with only your account (and Windows itself), so other users of the
  computer cannot read them wherever Latentry is installed. Files from
  earlier versions are fixed the first time they are read.
- **What Latentry protects against**: a new page in the manual goes through
  who could try to misuse Latentry (a website you visit, another device on
  your network, internet scanners, model files and workflows, swapped
  downloads, someone using the computer later, whoever receives a picture),
  what Latentry does about each, and what it leaves to you. SECURITY.md and
  the network guide now say that paired devices share ordinary runs.
- **Checked release downloads**: each release now has its source as
  `.tar.gz` and `.zip`, made by a GitHub workflow from the release's
  commit, with `SHA256SUMS` and a build provenance attestation, so
  `gh attestation verify` can show where a download came from. Getting
  started says how to check one.

**Engine (0.6.1)**

- **The engine reads only safetensors**: a diffusers folder model is now
  refused when a part of it has weights only in a pickle format (`.bin`,
  `.ckpt`, `.pt`), which can run code when loaded, and the message names
  that part. The SDXL folder and ControlNet loads also ask for safetensors
  only. Single-file checkpoints and LoRAs were `.safetensors` only already.
- **Pinned SDXL configs**: a single-file SDXL checkpoint's config files
  (scheduler, text encoders and tokenizers; no weights) now come from a
  fixed commit of SDXL base, each checked against its SHA-256, and are kept
  in the engine's controls folder. Before, diffusers fetched them from the
  latest version on the first load. An inpainting checkpoint is loaded as
  before.

## 0.8.0 (2026-10-13)

**Upgrading from 0.7.0**: open **Setup** and run **Repair / update** for the
engine once. It installs the engine's Python packages from the new lock and
brings poseorbit 0.2.0 (picking any of the people in a pose picture).

**Pose**

- **Pose on ComfyUI**: a ComfyUI backend now follows a skeleton pose, with
  the Pose ControlNet chosen for it on Settings (or `GEN_CONTROLNET_<ID>`),
  an OpenPose ControlNet that fits the checkpoint (NoobAI-XL OpenPose for
  Illustrious and NoobAI models, xinsir's for other SDXL models; the manual's
  Backends page says why). Latentry's engine finds the
  people and draws the skeleton, so picking people and the 3D view work as
  on the engine, and only the drawn skeleton goes to ComfyUI, never the
  reference picture. It works with a source picture and a mask too; a
  secret run blanks the uploaded skeleton with the rest.
- **Pose in your own ComfyUI workflows**: a workflow with a Load Image node
  titled `latentry:pose` follows the skeleton pose through its own pose
  nodes (an Anima pose adapter's, say). The skeleton is drawn dwpose-style
  unless the title also says `openpose`, and a node titled
  `latentry:pose_strength` takes Pose strength. The Workflow choice says
  which workflows can follow a skeleton.
- **Pick any of the people for a pose**: in a picture of several people,
  click each numbered box to follow that person or leave them out, so two
  of three can be used; at least one stays. **Everyone** still picks all.
  This needs a backend that says it takes a list (`person_subsets` in
  docs/backend-api.md); Latentry's engine does from poseorbit 0.2.0, so run
  **Repair / update** for the engine once. Other backends keep one person
  or everyone, and the chooser says why.

**Generate page**

- **Sliders stay put while you scroll on a phone**: on a touch screen a
  slider now moves only when you drag its knob, which has a larger grip. A
  swipe that starts on a slider's track scrolls the page, and a tap on the
  track no longer changes the value. A mouse click on the track still moves
  it there.

**Backends**

- **A warning for backends open to the network**: Settings now says, under
  the backend, when a ComfyUI or AUTOMATIC1111 / Forge backend is reached at
  another computer's address without a token. Anyone who can reach such a
  server can use it without Latentry (ComfyUI has no login, and its custom
  nodes run code). The manual's
  [Backends on other computers](https://33rd-kk.github.io/latentry/guide/network/#backends-on-other-computers)
  says how to keep one on this computer, or put a login in front of it.
- **Forge Neo**: checked as an `a1111` backend (Forge Neo 2.30, started
  with `--api`): txt2img, img2img, inpainting, progress, Cancel, samplers
  and schedulers, and its pictures in the gallery.

**Engine install**

- **Pinned Python packages**: the engine's packages, PyTorch included, now
  come from a lock for your machine and PyTorch build (`engine/locks/`),
  every file checked against its SHA-256, and **Repair / update** makes the
  environment match it exactly (a package added to it by hand is removed).
  Setup shows the date they were pinned and warns once that is over six
  months ago. Where there is no lock, or with
  `LATENTRY_ENGINE_PACKAGES=latest`, the engine is installed unpinned as
  before, and Setup says so. Run **Repair / update** once to switch.
- **PyTorch for 570-series NVIDIA drivers**: GPUs older than Blackwell now
  get the CUDA 12.6 build, which PyTorch still updates, instead of CUDA
  12.8, which stopped at an older PyTorch. Where an older build is the only
  one that runs (CUDA 11.8, or Blackwell on a 570 driver), Setup suggests a
  driver update.
- **Pinned pose weights**: the engine now fetches the SDXL OpenPose
  ControlNet and the Anima pose adapter from a fixed commit and checks each
  file against its SHA-256 before using it. A file fetched before this
  that does not match is fetched again once.
- **Pinned pose detectors**: the engine needs poseorbit 0.1.2, which does
  the same for its three detector models and no longer leaves a second copy
  in Hugging Face's shared cache. Run **Repair / update** for the engine on
  **Setup** once to get it.

**Engine (0.6.0)**

- **Faster runs with the same LoRA**: the engine leaves the last four LoRAs
  used in the model, switched off, so a run that calls one again skips
  putting it in (about 1.5 s on SDXL). A run without them comes out exactly
  as before. `LATENTRY_LORA_KEEP` sets how many; `0` takes each out after
  its run, as before.

**Fixed**

- **Progress on A1111 and Forge after a change of steps**: an img2img or
  inpaint run right after a run with another step count showed the earlier
  run's count, so its bar stopped short or ran past the end. The count is
  now taken again once the web UI sets it.

## 0.7.0 (2026-10-11)

**Upgrading from 0.6.0**: open **Setup** and run **Repair / update** for the
engine once. It moves the engine onto its own Python and the pinned uv
(about 20 MB more, and PyTorch may download again). Network folders
(`\\server\share`) in the settings file are dropped unless
`LATENTRY_ALLOW_UNC=1` is set.

**ComfyUI**

- **ComfyUI as a backend**: add a ComfyUI server on Settings with the kind
  `comfyui`. Latentry builds the graph itself (checkpoint, LoRAs from
  `<lora:…>` in the prompt, KSampler), shows progress, and **Cancel** stops
  only its own prompt. Choose the checkpoint under **Model** after **Test**,
  or with `GEN_MODEL_<ID>` in `.env.local`; without one, ComfyUI's first is
  used. Pose is not available on ComfyUI yet.
- **img2img and inpainting on ComfyUI**: a ComfyUI backend takes a source
  picture and a mask. They are uploaded into ComfyUI's input folder under
  two names per backend that each run reuses.
- **Your own ComfyUI workflows**: give a ComfyUI backend a **Workflows
  folder** on Settings, and the Generate page offers the workflows saved
  there (ComfyUI's Export (API)) next to the built-in graph. Latentry fills
  in the prompts, seed, size, steps, CFG, sampler and LoRAs where it finds
  them, or where a node's title says `latentry:prompt` and the like, and
  says what it could not find. The backend's **Model**, if set, replaces a
  workflow's checkpoint; a workflow with a UNET loader keeps its own model.
  Workflow names reach paired devices only when you turn that on.
- **What stays on the ComfyUI computer**: pictures go to ComfyUI's temp
  folder rather than its output folder, and the copy Latentry saves leaves
  out ComfyUI's graph, which names your model folders. After a secret run,
  Latentry deletes its prompts from ComfyUI's history and overwrites its
  uploads with an empty picture.
- **More from ComfyUI pictures**: the gallery reads the settings of more
  ComfyUI graphs: hires and refiner graphs (the base pass), SamplerCustom
  and Flux-style graphs, other model loaders, seeds from a seed node, and
  pictures that carry only the editor's workflow. Model names show the file
  name only, not the folders it sits in.

**Secret mode, privacy and security**

- **Secret mode turned on during a run**: the run becomes secret from then
  on (within a minute of its end too): a reload or another device no longer
  picks it up, and it is forgotten a minute after it ends. Turning secret
  mode off again does not undo that.
- **Less of this computer on paired devices**:
  - Gallery folders are shown by a display name you set next to each
    folder on Settings, or else by a made-up name such as "Amber Fox".
    The folder's own name is no longer shown, here or on a phone.
  - Unexpected errors from the engine no longer pass on their own text,
    which can name files; it goes to the engine's log.
  - Paths in other errors (the built-in tagger, other backends) show as
    `<path>`.
  - Model names show the file name only, without the folders they sit in.
  - `npm run dev` warns when it listens beyond this computer, since its
    error pages show paths and source code.
- **LoRA list on paired devices**: **Show the LoRA list on paired devices**
  (Setup > Engine, off by default) gives phones and other paired devices
  **Add a LoRA** too.
- **Tighter API limits**: network folders (`\\server\share`) are refused
  on the Settings page unless `LATENTRY_ALLOW_UNC=1`, and are dropped from
  an existing settings file without it. A backend's redirect is reported as
  an error instead of followed. Requests without a picture are capped at
  1 MB. Tagging and pose previews run at most two at a time. Pages are no
  longer kept in the browser cache and get stricter security headers. The
  unused `/_next/image` endpoint is off.

**Backends**

- **Why a backend does not answer**: **Test** on Settings and the Generate
  page now say whether a backend asked for a login (for example a ComfyUI
  login custom node, or a web UI started with `--api-auth` and no token),
  answered an error, redirected, or did not answer at all, with its own
  message, instead of only "No answer". For every kind of backend.

**Engine install**

- **Pinned downloads**: the engine install fetches uv 0.13.0 instead of
  the latest release, and checks it against its SHA-256 before running it.
  An engine installed with another uv gets 0.13.0 on its next **Repair /
  update**, which may download PyTorch again once (uv 0.13 changed its
  cache format).
  Models and taggers from the Setup page come from a fixed commit of their
  repository, and each file is checked against its SHA-256. A file that
  does not match is not kept, and the page says so.
- **The engine keeps its own Python**: the engine install downloads Python
  into `.runtime/` instead of building on a Python 3.12 already on this
  computer, so updating or removing that Python no longer breaks the
  engine. Your own uv settings (`UV_*` variables, `uv.toml`) no longer
  change how the engine is installed. An existing engine is moved onto its
  own Python at its next **Repair / update** (about 20 MB more, and its
  packages are installed again).

**Engine (0.5.0)**

- **Stricter API**: the built-in engine caps request bodies at 64 MB and
  prompts at 20,000 characters, checks `/api/pose` requests field by
  field, takes only `owner/name` repository ids for downloads, keeps a short
  download list, and no longer serves FastAPI's `/docs` pages.
- Model folders downloaded from the Setup catalog are checked against their
  pinned hashes, and unexpected errors go to its log instead of to the
  client.

**Fixed**

- A web UI backend moved to another address on Settings shows that
  server's samplers at once, not the old one's for a minute.
- Pictures from ComfyUI that carry only the editor's workflow are read with
  an SDXL text encoder too.

## 0.6.0 (2026-10-10)

**LoRAs**

- **LoRAs on Latentry's engine**: put LoRA files in the `loras` folder inside
  the models folder and call them as `<lora:name:0.8>`, as on A1111, or pick
  one from **Add a LoRA** next to the prompt. SDXL and Anima LoRAs are both
  supported. They are on for that run only. A missing LoRA, or one made for
  the other model family, stops the run with a message.
- **Write LoRA hashes** (Settings > Gallery folders, off by default): saved
  pictures made with LoRAs carry A1111's "Lora hashes". These identify the
  exact files, so leave it off unless you want sites to link the LoRAs.
- **LoRA filter in the gallery**: **Filters** has a **LoRA** menu listing the
  folder's LoRAs, and the search takes `lora:name` and `-lora:name`. Both go
  by the LoRAs a picture was made with.
- **LoRAs in the viewer**: the gallery lists a picture's LoRAs only when the
  backend applied them. A `<lora:…>` call that Latentry's engine or another
  diffusers server read as plain words is no longer listed, in new pictures
  or old ones. Pictures from A1111 are listed as before.

**Viewer**

- The secret-mode eye and the blur in the picture viewer now come from the
  viewer library itself (panorail 0.3.0) instead of being added to its page
  afterwards, so they keep working when the library changes. They look and
  work as before.

**Engine (0.4.0)**

- Loads LoRAs from the models folder's `loras` folder for a single run,
  alongside the pose adapter, and lists them at `GET /api/loras`. Its health
  reports the `lora` capability, which the generate page reads.

**Fixed**

- With `npm run dev`, the first page opened on this machine after a start
  went to the pairing page. Reloading worked. Requests are now known to come
  from this machine from the very first one.
- A prompt that names the same tag twice no longer causes an error in the
  viewer's tag panel, and choosing one of the two opens only its own actions.

## 0.5.0 (2026-10-08)

**Upgrading from 0.4.0**: phones and other computers must now be **paired**
before they can use Latentry (this computer needs nothing). After updating,
open **Settings > Phones and other computers > Add a device** on this
computer and type the code on each device. Behind a reverse proxy that does
its own login, set `LATENTRY_PAIRING=off`.

**Pairing and security**

- **Pairing**: a phone or another computer must now be paired before it can
  use Latentry. On this computer, **Settings > Phones and other computers >
  Add a device** shows a code (one use, 10 minutes) to type on the other
  device, with a name if you like; it then stays paired for 30 days. The
  same card lists the paired devices with when each ends, and removes one or
  all of them. A paired device's Settings page shows when its pairing ends
  and can unpair it, and every page warns from three days before. The list
  keeps no record of use and is stored encrypted. The key can be kept in the
  system keychain and passed in `LATENTRY_PAIRING_KEY`; the network guide
  shows how on Windows, macOS and Linux. `LATENTRY_PAIRING=off` turns it
  off, for a reverse proxy that does its own login.
- The per-device request limits count the address a connection really comes
  from, and believe `X-Forwarded-For` only from this computer. Stopping a
  run takes that run's id.

**Secret mode**

- Every picture is blurred until you choose to show it: the gallery's
  viewer (one picture at a time, with **Show for this picture**, blurred
  again on the next one or when it closes), the generate page's results and
  their full-size view (**Show results**, per run), the source picture in
  its preview and the mask editor (strokes stay sharp), and the picture you
  pick a pose's person from (its numbered boxes stay sharp). On the generate
  page each has a **Show** / **Blur** button, so a picture can be blurred
  again, on a phone too. The full-size viewer has its own secret-mode switch
  in the bar, so it can be turned on without closing the picture; turning it
  on blurs anything shown before.

**Generate**

- A slider moved away from its default shows a reset arrow next to its
  label, which puts it back to the profile's value. This covers width,
  height, steps, image count, CFG and both strengths.
- On a backend that does not load LoRAs (anything but an A1111 web UI), a
  `<lora:…>` or `<lyco:…>` tag in the prompt shows a note that it is read as
  plain words.
- **From gallery** (source and pose pictures) opens in place, under its
  button, instead of as a dialog over the page, so the header and its
  secret-mode switch stay one tap away while you choose.

**Engine (0.3.0)**

- The engine answers only requests addressed to this computer, and run by
  hand it refuses to listen beyond it without `LATENTRY_ENGINE_TOKEN`. The
  token is compared in constant time.
- The engine has tests (models folder, GPU plan, the HTTP API's token and
  input checks), which CI runs without a GPU or a model.

**Fixed**

- img2img with a detailed source picture and a mask no longer fails with
  "Invalid JSON body". Latentry accepted only the first 10MB of a request
  and cut the rest. It now takes up to 48MB, and above that the page says
  the pictures are too large before sending them.

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
