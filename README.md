<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.png">
  <img alt="Latentry: private, local image generation. Every picture remembered." src="docs/assets/banner-light.png">
</picture>

# Latentry

**Manual: https://33rd-kk.github.io/latentry/**

**Private, local image generation. Every picture remembered.**

Latentry is a web UI that runs on your own computer, in front of the image
models you already run, its own engine, or both. Your prompts, pictures,
settings and tokens stay on your machine: nothing is sent anywhere you did
not set up, and nothing is reported back. Every picture is saved with how it
was made, and the gallery finds it again by what it shows or how it was
made, then sends those settings back to the form to make it again.

## What it does

- **Generate.** Text-to-image, img2img (variation, or a picture as a pose
  reference), inpainting with a painted mask, and skeleton pose control where
  the backend supports it: pick whose pose in a group picture, and turn it in
  3D before generating (with [poseorbit](https://github.com/33rd-kk/poseorbit)).
  Runs live on the server, so a reload or a second tab picks up a run in
  progress.
- **A gallery that knows how every picture was made.** Every finished image
  is saved with its settings embedded (readable by A1111's PNG Info too).
  Other folders, such as ComfyUI or web UI outputs, are browsed read-only,
  and their settings are read from PNG, JPEG and WebP alike.
  - Search prompts and tags, or one setting: `model:`, `lora:`, `seed:`,
    `steps:>=30`, `w:1024`; leave pictures out with `-tag`.
  - Order by date, name, size, date made or pixel count; filter by shape,
    file type, age, resolution, model, LoRA and more.
  - Stack pictures that share a prompt or seed, and compare two side by side
    or with a slider, with what differs between them.
  - Send a picture's settings, tags or the picture itself back to the form,
    or show it in your file manager.
- **Tags.** Extract WD14 tags from a source image and carry a character's
  look into the prompt by group (hair, eyes, outfit…). Show tags under every
  gallery card, tag one picture or a whole selection at once, and keep the
  tags in the file. Tagging runs inside Latentry (on the CPU, with a WD14
  model you download), or on a backend that has a tagger.
- **Several backends, several model families.** Each backend keeps its own
  form. A *profile* (Anima, SDXL, Illustrious / NoobAI, Pony, generic) sets
  sizes, steps, CFG, negative prompt, artist notation and quality tags. Change
  it any time.
- Light and dark. The UI is in English and can be machine translated into
  other languages (see [Translations](#translations)).

### Screenshots

![The generate page: the engine with Illustrious XL, the prompt, a reference's pose turned 30 degrees in the 3D view, and the two pictures generated from it](docs/assets/screenshot-generate.webp)

![The gallery: every saved picture, newest first, with search and filters](docs/assets/screenshot-gallery.webp)

![The viewer's side panel: the settings a picture was made with, its prompt as tags, and WD14 tags read from the image](docs/assets/screenshot-viewer.webp)

<sub>The pictures were generated with Anima through Latentry, from original
prompts (no named characters or artists).</sub>

## Privacy

Latentry is built to leave as little behind as it can, and to send nothing
anywhere you did not choose. In short:

- **Nothing leaves your machine** except requests to the backends you set
  up, and downloads you start: installing and building (packages, and the
  UI's font, fetched once at build time), and the engine, models and tagger
  from the Setup page. No telemetry: the anonymous usage reports of Next.js
  and Hugging Face are turned off.
- **Closed by default.** It listens on 127.0.0.1, settings can only be
  changed from this computer, and a backend's token is only ever sent to that
  backend.
- **The browser keeps little.** The gallery's search, order and filters are
  not stored, and its index of a folder is kept in memory only. **Secret
  mode** keeps what you type out of browser storage and blurs the gallery.
- **Your files are yours.** Latentry writes pictures, and tags you ask for,
  into its own save folder only, and never deletes, moves or renames a
  picture.

The manual's [Privacy](https://33rd-kk.github.io/latentry/guide/privacy/)
page lists what is kept where.

## Backends

| Kind | What | Notes |
|---|---|---|
| Latentry's engine | Installed and run by Latentry itself, one per NVIDIA GPU ([engine/](engine/README.md)) | Stock diffusers. SDXL family: img2img, inpaint, pose. Anima: img2img, pose (v1.0). 3D pose turning. |
| `diffusers` | Any server speaking the small HTTP API in [docs/backend-api.md](docs/backend-api.md) | img2img, inpaint, pose (if the server offers it), precise cancel |
| `a1111` | AUTOMATIC1111 or Forge started with `--api` | img2img, inpaint. No pose control. |

Use the built-in engine, the servers you already run, or both.

## Getting started

Requires Node.js 22.19 or newer.

```bash
git clone https://github.com/33rd-kk/latentry.git
cd latentry
./install.sh                                         # Linux, macOS
powershell -ExecutionPolicy Bypass -File install.ps1 # Windows
```

The script installs and builds the web UI and starts it. When it says
Ready, open **http://localhost:3000/setup** in your browser. There, in order:

1. **Install the engine.** Latentry looks at your GPU and installs Python
   3.12, the matching PyTorch build (CUDA 13.0 / 12.8 / 12.6 by driver, Apple
   Metal, or CPU), stock diffusers and its engine, all under `.runtime/` in
   the app folder. About 3–4 GB, a few minutes. Delete `.runtime/` to remove
   it.
2. **Download a model.** Each is fetched from its publisher on Hugging Face
   after you accept its license, which the page shows first (some are
   non-commercial). Or put your own SDXL `.safetensors` files in `models/`.
3. **Download a tagger** for reading tags from pictures (WD14, Apache-2.0).

Then **Generate**. The engine starts with Latentry from then on (turn that off
on the Setup page or with `LATENTRY_ENGINE=off`); start Latentry with
`npm start`.

Latentry listens on this computer only. To use it from a phone or another
computer, add `LATENTRY_HOST=0.0.0.0` to `.env.local`, restart it, and open
`http://<this computer's address>:3000` there; on Windows, allow Node.js
through the firewall on private networks when asked.

### Using servers you already run

To use only those, install with `./install.sh --no-engine` (Windows:
`install.ps1 -NoEngine`): Latentry then skips the engine and points you to
**Settings** instead of the Setup page.

List them in `.env.local` (copied from [.env.example](.env.example)) or add
them under **Settings**. A minimal `.env.local`:

```bash
GEN_BACKENDS=sdxl|a1111|http://localhost:7860|illustrious
GALLERY_SAVE_DIR=./output
```

Two backends, one of them protected:

```bash
GEN_BACKENDS=anima|diffusers|http://localhost:7865|anima;sdxl|a1111|http://localhost:7860|illustrious
GEN_TOKEN_SDXL=user:password
GALLERY_SAVE_DIR=D:\pictures\latentry
GALLERY_DIRS=D:\ComfyUI\output
```

Every variable is described in [.env.example](.env.example). For development,
`npm ci && npm run dev` works as before.

You can also configure everything from **Settings** in the app: backends
(with a connection test), the save folder and other gallery folders, the
WD14 tagger, and each model profile's default size, steps, CFG, negative
prompt, quality tags and artist notation. Changes are saved to
`latentry.settings.json` and apply immediately; anything not set there falls
back to `.env.local`.

## Things to know

- **The gallery reads folders on the machine running Latentry.** Backends can
  live elsewhere on the network, but `GALLERY_SAVE_DIR` and `GALLERY_DIRS`
  must be local (or a mounted share). Folders are set in `.env.local` or on
  the Settings page, which only this computer can change.
- **Images are saved twice** if your backend also saves its own copy.
  Latentry's copy is the one with the settings embedded. Turn the backend's
  saving off if you do not want both.
- **One run per backend at a time.** Different backends run in parallel; with
  two GPUs, Latentry runs an engine on each.
- **Models are never part of Latentry.** The Setup page downloads only what
  you pick, after showing its license. NoobAI XL, for one, is non-commercial.
- **Settings can only be changed on the machine running Latentry**
  (`http://localhost`). Other devices see the app but not the settings page.
  `SETTINGS_EDIT=lan` allows it from the network, `SETTINGS_EDIT=off` turns it
  off. Since settings choose which folders are read and written, only open
  this up on a network you trust: the localhost check relies on headers a
  program (not a browser) could forge.
- **It is meant for your own machine or LAN.** It listens on 127.0.0.1
  unless `LATENTRY_HOST` says otherwise. `/api` only answers for
  `localhost` and private-network addresses (add others with
  `ALLOWED_HOSTS`), refuses cross-site requests, and rate-limits per IP.
  There is no login. To expose it further, put an authenticating reverse
  proxy in front of it, one that overwrites `X-Forwarded-For` (the per-IP
  limits trust that header).

## Translations

English (`locales/en.json`) is the only catalog in the repository and the
source for every other one. To add a language, connect a machine translation
service or an LLM as a provider in `scripts/translators/` (a few lines; see
[its README](scripts/translators/README.md)) and run:

```bash
TRANSLATOR=<provider> npm run i18n:translate -- de    # writes locales/de.json
npm run i18n:check                                     # missing / stale / broken keys
```

Placeholders such as `{count}` are protected from the translator, only new or
changed English strings are sent on later runs, and a key missing from a
catalog shows in English. Browsers whose language has a catalog get it
automatically, and a language menu appears in the header once there is more
than one.

## Development

```bash
npm run typecheck
npm run lint
npm test          # verify scripts in __tests__/, no test framework needed
npm test -- gallery   # just the ones whose name contains "gallery"
```

Layout:

- `lib/backends/`: adapters (`diffusers.ts`, `a1111.ts`) behind one interface
- `lib/profiles/`: model profiles and prompt composition
- `lib/diffusion/job-store.ts`: one live run per backend
- `lib/gallery/`: PNG metadata, saving, folder access
- `lib/settings/`: the settings file, its validation, and who may edit it
- `lib/tagger/`: the built-in WD14 tagger and the choice between it and a backend's
- `app/api/gen/*`, `app/api/gallery/*`: the routes the page talks to
- `components/generate/`, `components/gallery/`: the two pages
- `components/pose3d/`: the 3D pose viewer (three.js only)
- `engine/`: the bundled generation server
- The engine's pose detection is [poseorbit](https://github.com/33rd-kk/poseorbit)
  (on PyPI), which finds people, turns their pose in 3D and draws skeletons.
- `locales/`, `scripts/i18n-translate.mjs`: UI text and the translation tool

## License

[MIT](LICENSE); see [NOTICE](NOTICE) for the third-party work it builds on.
The engine's [poseorbit](https://github.com/33rd-kk/poseorbit) is
Apache-2.0. Models downloaded at run time keep their licences; the
Anima pose adapter in particular is non-commercial (see [engine/](engine/README.md)).
