# Backends

| Kind | What | Can do |
|---|---|---|
| Latentry's engine | Installed and run by Latentry from [Setup](../guide/engine.md), one per NVIDIA GPU | SDXL family: txt2img, img2img, inpainting, pose. Anima: txt2img, img2img, pose (v1.0). 3D pose turning |
| `diffusers` | Any server speaking the [backend API](../backend-api.md) | img2img, inpainting and pose if the server offers them; precise cancel |
| `a1111` | AUTOMATIC1111, Forge or Forge Neo started with `--api` | img2img, inpainting. No pose control |
| `comfyui` | A ComfyUI server | txt2img, img2img and inpainting with LoRAs, from a graph Latentry builds. Pose with a ControlNet, the skeleton drawn by Latentry's engine; precise cancel |

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
queued, a run waits in [Latentry's queue](../guide/generate.md#the-queue)
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

## Your own server

The [backend API](../backend-api.md) is small: health, generate (Server-Sent
Events), cancel, and optionally tags and pose. A server that implements
`/api/pose` with `limits` in its answer gets the 3D pose view too.
