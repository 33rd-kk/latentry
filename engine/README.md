# Latentry engine

The generation server Latentry installs and runs for you. It is stock
[diffusers](https://github.com/huggingface/diffusers) and PyTorch behind the
HTTP API in [../docs/backend-api.md](../docs/backend-api.md), so Latentry
talks to it like any other `diffusers` backend.

You normally never touch it: the **Setup** page installs it, starts one per
NVIDIA GPU (each on its own port, pinned with `CUDA_VISIBLE_DEVICES`, with a
random token only Latentry holds), restarts it if it crashes, and loads the
model you pick.

## What it runs

| Family | Files | Modes |
|---|---|---|
| SDXL (SDXL, Illustrious, NoobAI, Animagine, Pony…) | a single `.safetensors` checkpoint, or a diffusers folder | txt2img, img2img, inpaint, pose |
| Anima | the diffusers folder (`circlestone-labs/Anima-Base-v1.0-Diffusers`), through diffusers' `ModularPipeline` | txt2img, img2img, pose (28-layer v1.0 models) |

Put models in `models/` (or the folder set on the Setup page). The id of a
model is its file or folder name.

- Prompts longer than 77 tokens are encoded in 75-token windows and joined,
  as A1111 does.
- Samplers: Euler, Euler a, DPM++ 2M, DPM++ 2M SDE, UniPC, DDIM, each with
  the default, Karras or exponential schedule.
- Several images run as one batch, sized to the GPU's memory; on running out
  of memory the batch is halved and retried.

## Pose

`POST /api/pose` finds the people in a picture, lets the client pick one or
everyone, optionally turns the pose in 3D, and draws the skeleton. That part
is [poseorbit](https://github.com/33rd-kk/poseorbit), a package of its own
on PyPI (CPU only).
The engine then makes the run follow the skeleton
(`latentry_engine/pose_control.py`):

| Family | How | Skeleton |
|---|---|---|
| SDXL | [xinsir/controlnet-openpose-sdxl-1.0](https://huggingface.co/xinsir/controlnet-openpose-sdxl-1.0) through diffusers' ControlNet pipelines, made from the loaded weights (+2.5 GB VRAM) | OpenPose, body |
| Anima | [Claquasse/Anima-Control-Pose](https://huggingface.co/Claquasse/Anima-Control-Pose): a LoRA and a control embedder, put on for the run and taken off after | DWPose, whole body |

The weights download on first use into `models/controls/`. Anima-Control-Pose
is under CircleStone Labs' **non-commercial** licence (as Anima itself is);
the ControlNet and the detectors are Apache-2.0.

## LoRAs

Put LoRA `.safetensors` files in `models/loras/` (subfolders are fine) and
call them in the prompt as A1111 does: `<lora:name:0.8>`, where `name` is the
file name without `.safetensors` (`latentry_engine/loras.py`). The generate
page also lists them under **Add a LoRA**, which puts the call into the prompt.

- The calls are taken out of the prompt before it is encoded, and the LoRAs
  are put on for that run only and taken off after, as the pose adapter is.
- SDXL takes kohya and diffusers LoRAs; Anima takes the ComfyUI
  (`diffusion_model.…`) and diffusers layouts. A LoRA made for the other
  family, a name not in the folder, or a file diffusers cannot apply stops
  the run with a message, rather than running without it.
- Each `image` event lists the LoRAs applied. With `lora_hashes: true`
  (Latentry sends it only when **Write LoRA hashes** is on in Settings) it adds
  A1111's short hash of each file, worked out in memory and never stored.
- A LoRA's licence is its author's. The picker shows the licence a file names
  in its metadata (`modelspec.license`), if any; check the model page too.

## The GPU plan

Chosen once at start from the GPU memory that is **free** then (another
program may hold part of the card), see `latentry_engine/gpu.py`:

| Free VRAM | Weights | Offload | Batch |
|---|---|---|---|
| 11.5 GB and up | bf16 (fp16 before Ampere) | none | 2–8 |
| 7–11.5 GB | bf16 / fp16 | model offload to RAM | 1 |
| below 7 GB | bf16 / fp16 | sequential offload | 1 |

The engine caps its own memory at that amount. On Windows the NVIDIA driver
otherwise lets a process run past its VRAM into system RAM, which does not
fail but is several times slower. With the cap, running out raises an error
and the engine halves the batch and tries again. SDXL images in a batch are
decoded one at a time, since decoding is the memory peak.

Override with `LATENTRY_DEVICE` (`cuda`, `mps`, `cpu`), `LATENTRY_DTYPE`
(`float16`, `bfloat16`, `float32`), `LATENTRY_OFFLOAD` (`none`, `model`,
`sequential`), `LATENTRY_MAX_BATCH` and `LATENTRY_VRAM_FRACTION` (0.1–1).

### Measured

RTX 5060 Ti 16 GB, PyTorch 2.14.1+cu130, diffusers 0.40:

| Model | Job | Time |
|---|---|---|
| Illustrious XL 2.0 | 1024×1024, 28 steps | 12 s |
| Illustrious XL 2.0 | 4 × 832×1216, 28 steps | 44 s |
| Illustrious XL 2.0 | img2img 0.55 / inpaint 0.9, 832×1216 | 8 s / 12 s |
| Anima Base 1.0 | 1024×1024, 30 steps | 40 s |
| Anima Base 1.0 | img2img 0.5, 1024×1024 | 21 s |

## Running it by hand

```bash
python -m latentry_engine --port 7861 --models-dir ../models --model Illustrious-XL-v2.0.safetensors
```

It listens on 127.0.0.1 and answers only requests addressed to
`127.0.0.1`, `localhost` or `::1` (add a hostname with `--allow-host`), so a
web page cannot reach it by re-resolving its own name to this machine. Set
`LATENTRY_ENGINE_TOKEN` to require a Bearer token; listening anywhere else
(`--host 0.0.0.0`) is refused without one. Besides the backend API it has `GET /api/loras` (names, family and licence, no paths), `GET /api/models`,
`POST /api/models/load` `{ id }`, `POST /api/models/download`
`{ repo_id, filename? }` and `GET /api/models/downloads`.

Request bodies are capped at 64 MB and must say their size (no chunked
bodies). Prompts are capped at 20,000 characters and pictures at 32M
characters of base64, and `/api/pose` takes only the fields it reads. A
`repo_id` must be two plain parts (`owner/name`). The download list keeps the
latest 20 finished downloads. FastAPI's `/docs`, `/redoc` and
`/openapi.json` are off.

## Tests

`engine/tests` checks what needs no GPU or model: telling models apart from
their headers, the GPU plan, and the HTTP API's token and input checks. From
`engine/`, with the engine's Python:

```bash
python -m pytest tests
```

CI runs them on Linux with PyTorch's CPU build.
