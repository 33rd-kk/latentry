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
| SDXL (SDXL, Illustrious, NoobAI, Animagine, Pony…) | a single `.safetensors` checkpoint, or a diffusers folder | txt2img, img2img, inpaint |
| Anima | the diffusers folder (`circlestone-labs/Anima-Base-v1.0-Diffusers`), through diffusers' `ModularPipeline` | txt2img, img2img |

Put models in `models/` (or the folder set on the Setup page). The id of a
model is its file or folder name.

- Prompts longer than 77 tokens are encoded in 75-token windows and joined,
  as A1111 does.
- Samplers: Euler, Euler a, DPM++ 2M, DPM++ 2M SDE, UniPC, DDIM, each with
  the default, Karras or exponential schedule.
- Several images run as one batch, sized to the GPU's memory; on running out
  of memory the batch is halved and retried.

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

It listens on 127.0.0.1. Set `LATENTRY_ENGINE_TOKEN` to require a Bearer
token. Besides the backend API it has `GET /api/models`,
`POST /api/models/load` `{ id }`, `POST /api/models/download`
`{ repo_id, filename? }` and `GET /api/models/downloads`.
