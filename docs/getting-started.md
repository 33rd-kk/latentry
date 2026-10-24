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

[Support](reference/support.md) lists the systems, GPUs and browsers that
are checked.

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

### From a release download, checked

Instead of `git clone`, you can download a release's source from its
[release page](https://github.com/33rd-kk/latentry/releases)
(`latentry-X.Y.Z.tar.gz` or `.zip`) and check that it was made by
Latentry's release workflow from that release's commit, before you run
anything in it:

```bash
gh attestation verify latentry-X.Y.Z.tar.gz --repo 33rd-kk/latentry --source-ref refs/tags/vX.Y.Z
```

`--source-ref` makes it check that the file was built from the tag of that
release (from 0.8.1 on). 0.8.0's files were added later, from `main`, so
check those without it.

This needs the [GitHub CLI](https://cli.github.com/). Without it, compare
the file's SHA-256 with `SHA256SUMS` on the same page
(`sha256sum -c SHA256SUMS --ignore-missing` on Linux, `shasum -a 256` on
macOS, `Get-FileHash` in PowerShell); that shows the file is the one listed
there, and the attestation shows who made it. Then unpack it and run the
install script inside, as above. Git is still needed, for one of the
packages.

## Set up the engine

The Setup page runs in three steps:

1. **Install the engine.** Latentry looks at your GPU and installs Python
   3.12, the matching PyTorch build and stock diffusers, all under `.runtime/`
   in the app folder (about 3–4 GB, a few minutes). Deleting `.runtime/`
   removes it again. The Python packages are the ones pinned for your
   machine, each file checked against its hash; **Repair / update** makes
   the engine's environment match them exactly, so a package you added to
   it by hand is removed. To take the newest packages instead (say, a
   pinned one has a known vulnerability and no Latentry update has come),
   set `LATENTRY_ENGINE_PACKAGES=latest` in `.env.local` and run
   **Repair / update**; Setup then says the packages are not pinned.
2. **Download a model.** Each model comes from its publisher on Hugging Face.
   Read its licence (linked on the page; some are non-commercial), tick the
   box, and download. Or point the models folder at models you already have.
3. **Download a tagger** (optional), for reading tags from pictures.

See [Setup and the engine](guide/engine.md) for what each part shows.

Prefer servers you already run? Add them on the [Settings](guide/settings.md)
page instead, or list them in `.env.local`
(see [Backends](reference/backends.md)). To use only those, install with
`./install.sh --no-engine` (Windows: `install.ps1 -NoEngine`): the engine
does not start with Latentry, and the script points you to Settings.

## Generate the first picture

1. Open **Generate**. Pick the backend (`engine` for the built-in one) and
   the model.
2. Write a positive prompt, for example `1girl, solo, smile, upper body,
   cherry blossoms`.
3. Press **Generate**. Progress shows per step; the pictures appear on the
   right and are saved to the gallery folder (`output/` by default).

Next: [Generate](guide/generate.md) for everything on that page.
