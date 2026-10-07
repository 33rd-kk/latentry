# Backend API

Latentry talks to its backends over HTTP only. This page describes what it
expects of them, so you can point it at an existing server or write one.

Two kinds are supported:

- **`diffusers`**: a server speaking the API below. It is small enough to
  wrap any Python pipeline (Hugging Face `diffusers`, or anything else).
- **`a1111`**: AUTOMATIC1111 or Forge started with `--api`. Nothing is
  needed beyond that; see [AUTOMATIC1111 / Forge](#automatic1111--forge).

Images are base64-encoded PNG / JPEG / WebP, bare or as a `data:` URL.

---

## The diffusers-compatible API

### Authentication

Optional. If `GEN_TOKEN_<ID>` is set, Latentry sends
`Authorization: Bearer <token>` on every request. A server that requires it
should answer `401` when it is missing or wrong. `/api/health` and
`/api/presets` may stay open.

### `GET /api/health`

```json
{
  "status": "ok",
  "model": "org/base-model",
  "transformer": "org/finetune",
  "num_layers": 28,
  "pose_control": true,
  "busy": false,
  "run_id": null,
  "samplers": ["Default", "Euler", "DPM++ 2M", "UniPC"],
  "schedulers": ["Default", "Karras", "Exponential"],
  "tagger": true,
  "unavailable": { "inpaint": "This model has no inpainting pipeline." }
}
```

| Field | Required | Meaning |
|---|---|---|
| `model` | no | Shown in the UI. `org/` is dropped. |
| `transformer`, `num_layers` | no | Shown with the model when present. |
| `pose_control` | no | `true` enables the skeleton pose slot and `/api/pose`. |
| `busy` | no | Something is generating. Shown as the backend's state. |
| `samplers`, `schedulers` | no | The values `/api/generate` accepts. Without them the UI offers `Default, Euler, DPM++ 2M, UniPC` and `Default, Karras, Exponential`. `Default` means "the server's choice". |
| `tagger` | no | `false` hides WD14 tagging for this backend. |
| `unavailable` | no | Why a feature is off, keyed `img2img`, `inpaint` or `pose`: one plain-text sentence each, shown to the user next to the missing feature. Latentry shows it as text only and keeps the first 200 characters. Without it, Latentry says which field is missing. |

Any 2xx answer marks the backend as up.

### `GET /api/presets`

Optional speed/quality presets. Picking one fills in sampler, scheduler and
steps.

```json
{
  "default": "balanced",
  "presets": [
    { "name": "balanced", "label": "Balanced", "description": "…", "sampler": "Euler",
      "scheduler": "Karras", "num_inference_steps": 30, "approx_seconds": 12 }
  ]
}
```

### `POST /api/generate`

```json
{
  "prompt": "1girl, solo",
  "negative_prompt": "lowres",
  "width": 832, "height": 1216,
  "seed": -1,
  "image_count": 1,
  "sampler": "Default", "scheduler": "Default",
  "num_inference_steps": 30,
  "guidance_scale": 5.0,

  "init_image_base64": "…", "strength": 0.6,
  "mask_base64": "…", "mask_blur": 4,
  "pose_image_base64": "…", "pose_is_skeleton": true, "pose_strength": 1.0
}
```

- `seed: -1` is random. With `image_count > 1`, image *i* uses `seed + i`.
- **img2img**: `init_image_base64` + `strength` (0–1). The output should
  keep the source's aspect ratio at about `width × height` pixels, snapped to
  what the model needs (Latentry assumes multiples of 16 for the pose preview).
- **Inpaint**: `mask_base64` over the source. **The mask is read by its alpha
  channel**: painted (opaque) pixels are redrawn, transparent ones are kept.
- **Pose**: `pose_image_base64` is a skeleton already drawn by `/api/pose`
  (`pose_is_skeleton: true`), followed at `pose_strength` (0–2, 1.0 as
  trained). The skeleton's drawing style is the backend's business: it is
  drawn by the same backend that follows it.

Refusals come back before any streaming, as JSON with a `detail` (or
`error`) string:

| Status | When |
|---|---|
| `409` | A run is already in progress (one at a time). |
| `422` | A field is invalid (FastAPI's list form is understood). |
| `401` | Missing or wrong token. |

On success the response is `text/event-stream`:

| Event | Data |
|---|---|
| `start` | `{ "index": 0, "total": 2, "steps": 30, "run_id": "…" }`. Sent before each image. `steps` is what will actually run (img2img runs fewer). `run_id` names the run for `/api/cancel`. |
| `step` | `{ "index": 0, "step": 12 }`. Denoising steps completed for this image. |
| `image` | `{ "index": 0, "total": 2, "seed": 1234, "image_base64": "…png…", "steps_observed": 30 }` |
| `done` | `{}` |
| `cancelled` | `{}` |
| `error` | `{ "message": "…" }` |

A stream that closes without `cancelled` or `error` is taken as done.
Comment lines (`: keep-alive`) are welcome during long gaps.

### `POST /api/cancel`

```json
{ "run_id": "…" }
```

Stops the run with that id at its next step boundary. Answer
`{ "status": "cancelling" }`, `{ "status": "idle" }` when nothing runs, or
`409` when `run_id` is not the run in progress (so a late click cannot stop
the next run). `run_id: null` means "whatever is running".

### `POST /api/tag`

```json
{ "image_base64": "…", "threshold": 0.35 }
```

```json
{ "tags": [ { "name": "long_hair", "score": 0.93, "category": 0 },
            { "name": "hatsune_miku", "score": 0.88, "category": 4 } ] }
```

WD14 tags, rating tags left out. `category` is WD14's own: `4` is a named
character, everything else is `0`. Answer `503` if the tagger is unavailable.

### `POST /api/pose`

Only needed when `/api/health` says `pose_control: true`.

```json
{ "image_base64": "…", "width": 832, "height": 1216, "person": 0 }
```

```json
{ "skeleton_base64": "…png…", "width": 832, "height": 1216, "person": 0,
  "people": [ { "bbox": [0.12, 0.30, 0.88, 0.99] } ] }
```

The skeleton is drawn at `width × height`, the size of the run it is meant
for. `people` lists everyone detected, with boxes as fractions of the
picture. `person` picks one by index, or `-1` for everyone; absent means the
most confident.

#### Turning the pose (optional)

A backend that can estimate depth (Latentry's engine, through
[poseorbit](https://github.com/33rd-kk/poseorbit)) also takes:

```json
{ "want_3d": true,
  "camera": { "yaw": 40, "pitch": 10, "framing": { "zoom": 3, "x": 0.5, "y": 0.2 } } }
```

and answers with:

```json
{ "camera": { "yaw": 40, "pitch": 10, "framing": { "zoom": 3, "x": 0.5, "y": 0.2 } },
  "limits": { "yaw": 90, "pitch": 45, "zoom": [0.5, 6] }, "joints_in_frame": 9,
  "people": [ { "bbox": [...], "points_3d": [[x, y, z], ...], "scores": [...] } ] }
```

- `want_3d` adds each person's 133 COCO-WholeBody points as `[x, y, z]`
  (x right, y down, z away from the viewer, all in units of the picture's
  width) with their scores. Latentry's 3D view draws these.
- `camera` draws the skeleton seen from there instead of the front: `yaw`
  swings the camera to the viewer's right, `pitch` raises it, in degrees,
  orbiting the middle of the drawn people's hips with an orthographic view.
  Latentry clamps it to ±90° / ±45°.
- `camera.framing` crops the drawn canvas like a photo: the canvas point
  (`x`, `y`, fractions; 0.5, 0.5 is the middle) moves to the middle and
  everything scales by `zoom` around it (×0.5–×6). A face close-up of a
  full-body picture is about ×5 on the face. `joints_in_frame` says how many
  of the drawn person's 17 body joints are left inside; Latentry warns when
  a body-only OpenPose skeleton keeps fewer than 8.
- `limits` in the answer is what tells Latentry the backend can turn a pose:
  without it, the 3D view is not offered; without `limits.zoom`, it cannot zoom. A backend that ignores these fields
  still works as before.

---

<a id="automatic1111--forge"></a>

## AUTOMATIC1111 / Forge

Start the web UI with `--api` (and `--api-auth user:password` if you set
`GEN_TOKEN_<ID>`). Latentry uses:

| Endpoint | For |
|---|---|
| `GET /sdapi/v1/progress?skip_current_image=true` | Health, busy state, progress |
| `GET /sdapi/v1/options` | The loaded checkpoint's name |
| `GET /sdapi/v1/samplers`, `/sdapi/v1/schedulers` | The sampler and scheduler lists |
| `POST /sdapi/v1/txt2img`, `/sdapi/v1/img2img` | Generating. One image per iteration (`batch_size: 1`, `n_iter: count`) so progress counts images. `save_images: false`, since Latentry saves its own copy. |
| `POST /sdapi/v1/interrupt` | Cancel |
| `GET /tagger/v1/interrogators`, `POST /tagger/v1/interrogate` | WD14 tagging, if the [tagger extension](https://github.com/picobyte/stable-diffusion-webui-wd14-tagger) is installed |

Differences from the diffusers-compatible API:

- **Progress is polled.** The web UI answers a generate call only when every
  image is done, so step progress comes from `/progress` every 0.5 s.
- **Cancel is coarse.** `/interrupt` stops whatever is running, so Latentry
  only sends it while the job on the web UI is the one it started (matched by
  `job_timestamp`). Images finished before the interrupt are kept.
- **Busy means busy.** If the web UI is already generating (from its own tab,
  say), Latentry refuses with "another client is generating" instead of
  queueing behind it.
- **No pose control.** ControlNet is not driven (yet).
- **Masks are converted.** Latentry's alpha mask becomes the web UI's white
  (redraw) on black (keep).

---

## What Latentry writes into PNGs

Every image saved to `GALLERY_SAVE_DIR` carries two text chunks, placed right
after `IHDR`:

- **`parameters`**: A1111's infotext, so the web UI's PNG Info tab, Civitai
  and most viewers can read it:

  ```
  1girl, solo
  Negative prompt: lowres
  Steps: 30, Sampler: Euler, Schedule type: Karras, CFG scale: 5, Seed: 1234, Size: 832x1216, Model: …, Version: Latentry (anima)
  ```

  If the backend already wrote `parameters` (A1111 does), it is kept.

- **`latentry`**: JSON (iTXt, UTF-8, deflated when long):

  ```json
  { "schema": 1, "backend": "anima", "kind": "diffusers", "profile": "anima",
    "model": "…", "mode": "txt2img",
    "prompt": "…", "negative_prompt": "…", "seed": 1234,
    "width": 832, "height": 1216, "sampler": "Euler", "scheduler": "Karras",
    "steps": 30, "cfg": 5, "strength": 0.6, "created": "2026-10-03T07:48:36.401Z" }
  ```

  `mode` is `txt2img`, `img2img`, `inpaint` or `pose`. `strength` is present
  only when a source image was used. The prompt is the one sent, artist and
  quality tags included.

WD14 tags written back from the gallery go in a third chunk,
**`latentry:tags`**: `[{ "name": "long_hair", "category": 0, "score": 0.93 }, …]`.
It can be added to any PNG in the save folder, including ones Latentry did
not make.

When reading, the gallery prefers `latentry`, then `parameters`, then
ComfyUI's `prompt` graph.
