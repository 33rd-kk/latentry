# Getting started

## What you need

- **Node.js 22.19 or newer** ([nodejs.org](https://nodejs.org); on Windows
  also `winget install OpenJS.NodeJS.LTS`).
- For the built-in engine: an **NVIDIA GPU** is best (Apple silicon and the
  CPU work too, slowly), and about 4 GB of disk for the engine plus 5–7 GB
  per model.
- Or a backend you already run: a server speaking the
  [backend API](backend-api.md), or AUTOMATIC1111 / Forge started with
  `--api`.

## Install

```bash
git clone https://github.com/33rd-kk/latentry.git
cd latentry
./install.sh                                          # Linux, macOS
powershell -ExecutionPolicy Bypass -File install.ps1  # Windows
```

The script checks Node.js, installs and builds the web UI, and starts it. When
it says **Ready**, open **<http://localhost:3000/setup>** in your browser.

Later, start Latentry again from the same folder with:

```bash
npm start
```

Ctrl+C stops it. Latentry listens on this computer only; to use it from a
phone, see [Other devices and security](guide/network.md).

## Set up the engine

The Setup page runs in three steps:

1. **Install the engine.** Latentry looks at your GPU and installs Python
   3.12, the matching PyTorch build and stock diffusers, all under `.runtime/`
   in the app folder (about 3–4 GB, a few minutes). Deleting `.runtime/`
   removes it again.
2. **Download a model.** Each model comes from its publisher on Hugging Face.
   Read its licence (linked on the page; some are non-commercial), tick the
   box, and download. Or point the models folder at models you already have.
3. **Download a tagger** (optional), for reading tags from pictures.

See [Setup and the engine](guide/engine.md) for what each part shows.

Prefer servers you already run? Add them on the [Settings](guide/settings.md)
page instead, or list them in `.env.local`
(see [Backends](reference/backends.md)).

## Generate the first picture

1. Open **Generate**. Pick the backend (`engine` for the built-in one) and
   the model.
2. Write a positive prompt, for example `1girl, solo, smile, upper body,
   cherry blossoms`.
3. Press **Generate**. Progress shows per step; the pictures appear on the
   right and are saved to the gallery folder (`output/` by default).

Next: [Generate](guide/generate.md) for everything on that page.
