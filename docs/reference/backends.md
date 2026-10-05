# Backends

| Kind | What | Can do |
|---|---|---|
| Latentry's engine | Installed and run by Latentry from [Setup](../guide/engine.md), one per NVIDIA GPU | SDXL family: txt2img, img2img, inpainting, pose. Anima: txt2img, img2img, pose (v1.0). 3D pose turning |
| `diffusers` | Any server speaking the [backend API](../backend-api.md) | img2img, inpainting and pose if the server offers them; precise cancel |
| `a1111` | AUTOMATIC1111 or Forge started with `--api` | img2img, inpainting. No pose control |

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

## Your own server

The [backend API](../backend-api.md) is small: health, generate (Server-Sent
Events), cancel, and optionally tags and pose. A server that implements
`/api/pose` with `limits` in its answer gets the 3D pose view too.
