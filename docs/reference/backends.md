# Backends

| Kind | What | Can do |
|---|---|---|
| Latentry's engine | Installed and run by Latentry from [Setup](../guide/engine.md), one per NVIDIA GPU | SDXL family: txt2img, img2img, inpainting, pose. Anima: txt2img, img2img, pose (v1.0). 3D pose turning |
| `diffusers` | Any server speaking the [backend API](../backend-api.md) | img2img, inpainting and pose if the server offers them; precise cancel |
| `a1111` | AUTOMATIC1111 or Forge started with `--api` | img2img, inpainting. No pose control |
| `comfyui` | A ComfyUI server | txt2img, img2img and inpainting with LoRAs, from a graph Latentry builds. No pose yet; precise cancel |

Use the built-in engine, servers you already run, or both: different
backends run in parallel, one run each.

## Adding a backend

On [Settings](../guide/settings.md) (**Add backend**, then **Test**), or in
`.env.local`:

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

The fields are `id|kind|url|profile`; the profile is the form's starting
point (`generic`, `sdxl`, `illustrious`, `pony` or `anima`) and can be changed
in the UI at any time.

## AUTOMATIC1111 / Forge

Start the web UI with `--api` (and `--api-auth user:password` if you give the
backend a token). Latentry generates one image per iteration so progress
counts images, and saves its own copy: turn the web UI's saving off if you do
not want two. Its WD14 tagger extension can serve as Latentry's tagger.

## ComfyUI

Add it with the kind `comfyui` and ComfyUI's address (by default
`http://127.0.0.1:8188`). After **Test** on Settings, **Model** lists the
checkpoints ComfyUI has; without one chosen, it draws with the first. LoRAs
work as everywhere else, with `<lora:name:weight>` in the prompt: Latentry
finds the file in ComfyUI's LoRA list by its name.

Latentry builds the graph itself (checkpoint, LoRA loaders, the two prompts,
KSampler, decode) and queues one prompt per picture. With a source picture
(and a mask), it uploads them into ComfyUI's input folder first, at the size
the run draws, and encodes the source with the checkpoint's VAE; **Strength**
is how much is redrawn. One prompt per picture means **Cancel** stops the
picture being drawn and skips the rest. It never sends a graph from the page,
and it never cancels another client's prompt. While someone else's prompt is
queued, a run is refused rather than queued behind it.

What stays on the ComfyUI computer: the graph ends in a preview, so pictures
go to ComfyUI's temp folder (emptied when ComfyUI restarts), not its output
folder. An upload reuses one of two names for the backend
(`input/latentry/<id>-source.png` and `-mask.png`), so they never pile up;
ComfyUI's history keeps the prompts Latentry ran, as it does its own. After
a [secret](../guide/secret-mode.md) run, Latentry deletes that run's prompts
from the history and overwrites its uploads with an empty picture. Latentry saves its own copy, without ComfyUI's graph in it (that
names your model folders), so the saved picture cannot be dropped back into
ComfyUI as a workflow; it keeps Latentry's settings and an A1111-style
`parameters` text instead.

ComfyUI has no login. Keep it on this computer or your own network; a token,
if you give one, is sent as a Bearer token for a proxy in front of it. A
login added to ComfyUI itself (a custom node such as ComfyUI-Login) is not
something Latentry can get past: **Test** and the Generate page then say that
it asks for a login, with ComfyUI's own message.

### Your own workflows

Give a ComfyUI backend a **Workflows folder** on Settings: a folder on this
computer with workflows saved from ComfyUI with **Export (API)** (the
editor's own format is refused, with that hint). The Generate page then
offers them under **Workflow**, next to the built-in graph.

Latentry fills a workflow in on this computer before it is queued:

- **What goes in**: the prompt and negative prompt, the seed (the next one
  for each picture), the size (one picture per prompt), steps and CFG, and
  the sampler and scheduler unless they are *Default*. The **Model** set for
  the backend replaces the workflow's checkpoint; otherwise the workflow's
  own is used. A workflow that loads a diffusion model with a UNET loader
  (Flux, Anima and the like) always keeps its own.
- **Where**: found from the first-pass sampler, the same way the gallery
  reads ComfyUI pictures: its prompts through the text encoders (and string
  or primitive nodes), the seed on the sampler or a seed node, the size on
  the empty latent. A node whose title contains a marker takes that role:
  `latentry:prompt`, `latentry:negative`, `latentry:seed`, `latentry:size`,
  `latentry:steps`, `latentry:cfg`, `latentry:sampler`, `latentry:output`.
  What is not found is left as in the file, and the page says which.
- **LoRAs**: each `<lora:name:weight>` adds a LoRA loader after the
  checkpoint loader. A workflow without one (a UNET loader, say) refuses
  LoRA calls.
- **Output**: `SaveImage` becomes `PreviewImage`, so nothing lands in
  ComfyUI's output folder; the picture is read from the `latentry:output`
  node, else the first.

A workflow draws from the prompt only: for a source picture or a mask, use
the built-in graph. The folder is only read, never written, and only its
own `*.json` files (no subfolders, at most 200, 1 MB each). Workflow names
are shown to paired devices only with **Show workflow names on paired
devices** on for that backend.

Not yet: pose.

## Your own server

The [backend API](../backend-api.md) is small: health, generate (Server-Sent
Events), cancel, and optionally tags and pose. A server that implements
`/api/pose` with `limits` in its answer gets the 3D pose view too.
