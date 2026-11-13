# Backends

| Kind | What |
|---|---|
| Latentry's engine | Installed and run by Latentry from [Setup](../guide/engine.md), one per NVIDIA GPU |
| `diffusers` | Any server speaking the [backend API](../backend-api.md) |
| `a1111` | AUTOMATIC1111, Forge or Forge Neo started with `--api` |
| `comfyui` | A ComfyUI server, with a graph Latentry builds or [your own workflows](#your-own-workflows); also the one [SwarmUI](#swarmui) starts |
| `sdcpp` | A [stable-diffusion.cpp](#stable-diffusioncpp) `sd-server`: no Python, and runs on Vulkan, Metal, CUDA or the CPU |

Use the built-in engine, servers you already run, or both: different
backends run in parallel, one run each.

## What each backend can do

When a backend cannot do something, the Generate page says why next to the
control, rather than only hiding it.

| | Engine, SDXL family | Engine, Anima | `diffusers` server | `a1111` | `comfyui`, built-in graph | `comfyui`, your workflow | `sdcpp` |
|---|---|---|---|---|---|---|---|
| Text to picture | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| From a picture (img2img) | Yes | Yes | Unless it says no¹ | Yes | Yes | No | If its model can⁵ |
| Inpaint, **Extend** and **Faces** | Yes | Yes (engine 0.9.0 and later) | Unless it says no¹ | Yes | Yes | No | If its model can⁵ |
| Skeleton pose | Yes | 28-layer v1.0 models only | If it says so¹ | No | With a Pose ControlNet and the engine running² | With a `latentry:pose` node and the engine running² | No |
| Control picture (edges, depth, line art) | Yes, with a pose too | No | If it lists the kinds¹ | Not yet | With a ControlNet set for that kind | No | No |
| Hires fix | Yes | Yes, but not with a pose | If it says so¹ | Yes | Yes | No: the workflow keeps its own passes | If its model can⁵ |
| Upscale a picture | Yes | Yes | If it says so¹ | Yes | Yes | No: choose the built-in graph | With Lanczos, Nearest or its ESRGAN model |
| Samplers and schedulers | Euler, Euler a, DPM++ 2M, DPM++ 2M SDE, UniPC, DDIM; Karras, Exponential | *Default* only: the model's own flow-match Euler | The ones it lists¹ | The web UI's | ComfyUI's | ComfyUI's, unless *Default* keeps the workflow's | sd-server's |
| LoRAs | Yes | Yes | If it says so¹ | Yes | Yes | With a checkpoint loader³ | Yes |
| Tagging by the backend⁴ | No | No | Unless it says no¹ | With its WD14 tagger extension | No | No | No |
| **Cancel** | Stops that run | Stops that run | Stops that run | At the web UI's next step; the unfinished picture is saved | Stops that picture, skips the rest | Stops that picture, skips the rest | Stops that picture, skips the rest |
| Choosing the model | [Setup](../guide/engine.md) | [Setup](../guide/engine.md) | On the server | In the web UI | **Model** on Settings | The workflow's own, or **Model** on Settings³ | In sd-server (its own page, or its start command) |

1. A `diffusers` server announces these in
   [`GET /api/health`](../backend-api.md#get-apihealth). img2img, inpainting
   and tagging are on unless it says `false`. Pose, hires fix, upscaling and
   LoRAs need an explicit `true`.
2. Latentry's engine draws the skeleton on this computer, so the reference
   picture never reaches ComfyUI. See [Pose](#pose) and
   [Pose in a workflow](#pose-in-a-workflow).
3. A workflow that loads its model with a UNET loader (Flux, Anima and the
   like) always keeps its own model, and refuses LoRA calls.
4. Latentry's own WD14 tagger works whatever the backend; see
   [Tags](../guide/gallery.md#tags).
5. sd-server says what the model it has loaded can do; Latentry offers
   only that.

Latentry does these itself, so they work with every backend:
[the queue](../guide/many.md#the-queue), the
[X/Y grid](../guide/many.md#xy-grid), wildcards, the gallery and
[secret mode](../guide/secret-mode.md). For secret mode, what the backend
itself keeps differs from one kind to another; see
[What it does not do](../guide/secret-mode.md#what-it-does-not-do).

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

Latentry draws with the checkpoint loaded in the web UI, so choose one there
first. Forge Neo (checked with 2.30) works the same way: txt2img, img2img,
inpainting, progress, **Cancel** and its samplers and schedulers, and the
gallery reads its pictures' settings. **Cancel** stops at the web UI's next
step, and the picture it was drawing comes back unfinished and is saved too.

Keep the web UI on the computer running Latentry if you can (it then needs
no `--listen`). On another computer it has to be started with `--listen`,
and then always with `--api-auth` too, with that `user:password` as the
backend's token: without it, anyone on the network can use the web UI.
Settings warns about an `a1111` backend at another address without a
token.

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
queued, a run waits in [Latentry's queue](../guide/many.md#the-queue)
until ComfyUI is free, rather than going into ComfyUI's queue behind it.

### Pose

A ComfyUI backend follows a [skeleton pose](../guide/pose.md) once three
things are there:

- **A Pose ControlNet** chosen for it on Settings (or in
  `GEN_CONTROLNET_<ID>`): an OpenPose ControlNet from ComfyUI's
  `models/controlnet` folder that fits the checkpoint. **Test** lists the
  ones ComfyUI has. The checkpoint's family matters:

    | Checkpoint | Pose ControlNet |
    |---|---|
    | Illustrious, NoobAI and models built on them | NoobAI-XL OpenPose (`Laxhar/noob_openpose`, `openpose_pre.safetensors`) |
    | Other SDXL models | `xinsir/controlnet-openpose-sdxl-1.0` |

    An SDXL ControlNet on an Illustrious checkpoint leaves the picture
    washed out and grey, and the pose is hardly followed.
- **Latentry's engine running** ([Setup](../guide/engine.md)). It finds the
  people and draws the skeleton on this computer's CPU, whatever model it
  has loaded, so picking people and the 3D view work as on the engine. The
  reference picture goes to the engine only; ComfyUI gets the drawn skeleton.
- **ComfyUI's own ControlNet nodes** (`ControlNetLoader`,
  `ControlNetApplyAdvanced`), which every current ComfyUI has.

Until then, the Generate page says which is missing. The run uploads the
skeleton at the size it draws and applies it to both prompts, at **Pose
strength**, over all the steps; it works with a source picture and a mask
too. Your own workflow can follow a skeleton with its own pose nodes, such
as an Anima pose adapter's: see [Pose in a workflow](#pose-in-a-workflow).

What stays on the ComfyUI computer: the graph ends in a preview, so pictures
go to ComfyUI's temp folder (emptied when ComfyUI restarts), not its output
folder. An upload reuses one of three names for the backend
(`input/latentry/<id>-source.png`, `-mask.png` and `-pose.png`), so they never pile up;
ComfyUI's history keeps the prompts Latentry ran, as it does its own. After
a [secret](../guide/secret-mode.md) run, Latentry deletes that run's prompts
from the history and overwrites its uploads with an empty picture. Latentry saves its own copy, without ComfyUI's graph in it (that
names your model folders), so the saved picture cannot be dropped back into
ComfyUI as a workflow; it keeps Latentry's settings and an A1111-style
`parameters` text instead.

ComfyUI has no login, and whoever reaches it can run code on its computer
through custom nodes; exposed ComfyUI servers have been taken over this
way. Keep it on the computer running Latentry, listening on 127.0.0.1
(ComfyUI's default, without `--listen`). On another computer, bind it to
127.0.0.1 there and put a reverse proxy that asks for a login in front of
it: a token, if you give one, is sent as a Bearer token for that proxy.
Settings warns about a `comfyui` backend at another address without a
token ([Backends on other computers](../guide/network.md#backends-on-other-computers)).
A login added to ComfyUI itself (a custom node such as ComfyUI-Login) is not
something Latentry can get past: **Test** and the Generate page then say that
it asks for a login, with ComfyUI's own message.

### Control pictures

The built-in graph follows a [control picture](../guide/controls.md) (edges,
depth, line art) with a ControlNet you choose for each kind under
**ControlNets for control pictures** in Settings (or
`GEN_CONTROL_CANNY_<ID>`, `GEN_CONTROL_DEPTH_<ID>`, `GEN_CONTROL_LINEART_<ID>`),
from ComfyUI's `controlnet` folder; a kind without one is not offered.
Latentry makes the control picture on this computer, so only that picture
goes to ComfyUI (named `<id>-control.png`, overwritten by the next run and
wiped after a secret run), never the reference.

- One **union** ControlNet can serve all three: give the same file for each
  kind. When its file name says `union` and ComfyUI has the core
  `SetUnionControlNetType` node, Latentry tells it which kind each picture is
  (`depth`, or `canny/lineart/anime_lineart/mlsd`). For SDXL,
  xinsir's `controlnet-union-sdxl-1.0` is the one Latentry's engine uses.
- It follows after a pose, so both shape the picture, each at its own
  strength. Hires fix's second pass follows it too.
- A workflow of your own does not take a control picture.

### SwarmUI

SwarmUI draws with a ComfyUI it starts itself, and Latentry can use that
ComfyUI as an ordinary `comfyui` backend. SwarmUI picks its port, from 7821
up: look in SwarmUI's **Server > Logs** for `Self-Start ComfyUI-0 on port
…`, and add `http://127.0.0.1:` with that port. The port can change when
SwarmUI restarts; if **Test** stops answering, look again. SwarmUI's own
address (7801) does not work: Latentry talks to ComfyUI directly, not
through SwarmUI's `/ComfyBackendDirect`.

Checked with SwarmUI 0.9.8.4 and the ComfyUI it starts: txt2img, a random
seed read back, LoRAs and **Cancel**. Models and LoRAs are the ones
SwarmUI's **Models** folders hold.

That ComfyUI listens on 127.0.0.1 only, but SwarmUI hands it out again under
its own address, at `/ComfyBackendDirect`, and SwarmUI has no login until
you turn one on. With SwarmUI's **Host** opened to the network (`*` or
`0.0.0.0`) and no login, anyone who can reach SwarmUI gets its own account,
with every permission, and the whole ComfyUI API through it, custom nodes
included. Latentry reaches the ComfyUI on this computer, so it cannot tell
where SwarmUI listens; instead **Test** notices SwarmUI's nodes in that
ComfyUI and says so under the backend. Keep SwarmUI's **Host** on
`localhost` (its default), or turn on its login (`AuthorizationRequired` in
**Server > Server Configuration**) before opening it to the network.

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
  reads ComfyUI pictures. The sampler is a `KSampler` or `SamplerCustom`
  node, a custom node named like one (such as `KSampler (Efficient)`), or
  else any node that takes a latent and the prompts by link; its settings are
  read by the stock input names (`seed`, `steps`, `cfg`, `sampler_name`,
  `scheduler`, `denoise`). Impact Pack's nodes are read as well: prompts
  carried in a `basic_pipe` are found on the node that built the pipe, and a
  graph that samples only through providers (`KSamplerProvider` handed to
  `TwoSamplersForMask`, say) is read from the base sampler's provider. Its prompts through the text encoders (and string
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

A workflow draws from the prompt, and from a skeleton when it has a pose
node (below): for a source picture or a mask, use the built-in graph. The
folder is only read, never written, and only its
own `*.json` files (no subfolders, at most 200, 1 MB each). Workflow names
are shown to paired devices only with **Show workflow names on paired
devices** on for that backend.

#### Pose in a workflow

A workflow follows a [skeleton pose](../guide/pose.md) through its own pose
nodes: Latentry only supplies the skeleton. In ComfyUI, add a **Load Image**
node that feeds those nodes, put `latentry:pose` in its title, and export
the workflow again with **Export (API)**:

- The skeleton is drawn **dwpose**-style, which is what Anima's pose adapter
  was trained on. Put `openpose` in the title as well (`latentry:pose
  openpose`) for an OpenPose ControlNet.
- A node with `latentry:pose_strength` in its title takes **Pose strength**
  in its `strength` input. Without one, the workflow keeps its own strength.
- **Workflow** says which workflows can follow a skeleton. Picking one shows
  **Skeleton pose** while Latentry's engine runs, which draws the skeleton
  as for the built-in graph. The backend's Pose ControlNet is not used, and
  the reference picture stays with the engine. Picking another workflow
  draws the skeleton again in that workflow's style.
- A run uploads the skeleton under the same fixed name
  (`input/latentry/<id>-pose.png`) and puts that name in the marked node. A
  secret run blanks it afterwards. Without a pose, the node keeps the
  picture saved in the workflow.

## stable-diffusion.cpp

[stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) is
a single program, with no Python, built for Vulkan, Metal, CUDA, SYCL or
the CPU. It reads quantized GGUF models, so newer model families fit on a
smaller GPU, and it runs on AMD and Intel GPUs too. Latentry talks to its
`sd-server` through its own API (`/sdcpp/v1`).

Start `sd-server` with a model, or with `--model-dir` and pick the model
on its own page. It listens on `http://127.0.0.1:1234` by default; add it
with the kind `sdcpp` and that address:

```bash
sd-server --model-dir ./models
```

```bash
GEN_BACKENDS=cpp|sdcpp|http://127.0.0.1:1234|generic
```

- **The model is the one sd-server has loaded.** Change it there.
  Latentry shows its file name, without its folder. While no model is
  loaded, the backend shows as not ready and says why.
- **What it can do comes from sd-server.** img2img, inpaint and hires fix
  are offered when the loaded model has them; samplers, schedulers and
  hires upscalers are the ones it lists. Pose and tagging are not
  available.
- **LoRAs** work as everywhere else, with `<lora:name:weight>` in the
  prompt: Latentry finds the file in sd-server's LoRA list by its name
  and takes the call out of the prompt. A name it does not list stops the
  run before anything is drawn.
- **Upscale** enlarges the picture on this computer with Lanczos or
  Nearest, or on sd-server with an ESRGAN model from its
  `--hires-upscalers-dir`, then redraws it.
- **One job per picture.** **Cancel** stops the job being drawn, by its
  id, and skips the rest. It never stops another client's job.
- **Latentry saves the picture with its own settings**, and asks sd-server
  for pictures without its metadata, which can name the LoRA files' folders.
  Pictures that sd-server or `sd-cli` saved themselves are read by the
  gallery too, PNG, JPEG and WebP, with their LoRAs and models by file
  name.
  sd-server keeps each finished job, picture included, in its memory until
  the job expires there.

sd-server has no login. Keep it on this computer (it listens on
127.0.0.1 unless started with `--listen-ip`). Settings warns about an
`sdcpp` backend at another address without a token. If it has to be
elsewhere, put a reverse proxy that asks for a login in front of it, and
give the backend that proxy's Bearer token.

Checked with a CPU release of `sd-server` from November 2026: SD-Turbo for
txt2img, img2img, inpaint, hires fix, Upscale and **Cancel**, and SD 1.5 with
LCM-LoRA for LoRA.

## Your own server

The [backend API](../backend-api.md) is small: health, generate (Server-Sent
Events), cancel, and optionally tags and pose. A server that implements
`/api/pose` with `limits` in its answer gets the 3D pose view too.
