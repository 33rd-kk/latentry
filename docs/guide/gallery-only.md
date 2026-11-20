# Gallery-only mode

Gallery-only mode is for when you only want to look through your pictures:
Latentry's own, and other tools' folders, read-only. Generating, the engine
and the backends are turned off, and Latentry closes the parts of its API
that serve them, so they cannot be reached from another tab or device
either. No GPU is needed.

It is the same Latentry, with nothing to reinstall. You can turn the mode off
at any time and generate.

## What you can do

| | Gallery-only mode |
|---|---|
| Browse [gallery folders](settings.md#gallery-folders), Latentry's and other tools' | Yes |
| [Search](gallery.md#search), [order and filters](gallery.md#order-and-filters), [stacks and Compare](gallery.md#stacks-and-comparing) | Yes |
| [Stars](gallery.md#stars), [tags](gallery.md#tags), [saving and sharing](gallery.md#saving-and-sharing), **Show in folder** | Yes |
| Tagging with WD14 | Yes, with the **built-in** model only (see [below](#tagging)) |
| [Paired phones](network.md), shared folders, [secret mode](secret-mode.md) | Yes |
| Generating, the queue, X/Y grids, img2img, pose, controls, references | No |
| **Generate with these settings**, **Use as source**, **Upscale**, **Fix faces**, sending tags to the prompt, in the viewer | No (not shown) |
| The engine, model and LoRA downloads | No (the engine is stopped) |
| A backend's tagger (the A1111 tagger extension, a ComfyUI tagger) | No: no backend is contacted |
| Wildcards, model info | No |

Nothing is saved in this mode, so when the save folder is still empty the
gallery opens on your first read-only folder instead. Pictures you made
before stay in the save folder, one click away in the folder list.

## Turn it on or off

On a fresh install, the first page asks **What do you want to do with Latentry?**:
**Browse only** turns the mode on, **Set up generating** leaves it off. Both
answers are saved, so it is asked once; until a backend is set up, the
setup help that follows still offers **Browse only instead**. A device that
may not change Settings is not asked.

Afterwards, on **Settings > Mode**, switch **Gallery-only mode**. It applies
at once: the header loses **Generate**, the home page becomes the gallery,
and a running engine is stopped. Turning it off starts the engine again if
it is set to start with Latentry.

Only an [owner](owner-device.md) can switch it, like the rest of Settings.
The switch waits while other changes on the page are unsaved.

Or set it in `.env.local` (or the container's environment):

```bash
LATENTRY_MODE=gallery
```

`LATENTRY_MODE` wins over the switch, which then only shows it. Set it to
`full` to keep the mode off, or remove it to leave it to Settings.

## Tagging

Latentry's own WD14 tagger runs inside Latentry, so it works with no engine
and no backend. Get a model on **Setup**, which in this mode shows only the
tagger, or point **Settings > Tagging** (or `WD14_MODEL_DIR`) at a folder
that already has `model.onnx` and `selected_tags.csv`.

Downloading a tagger model is the one download this mode allows: Setup's
other models, and models by Hugging Face URL, are refused.

## What is closed

In gallery-only mode these answer `403` to everyone, this computer included:

- `/api/gen/<backend>/...`: generating, its jobs, pose detection, presets
  and ComfyUI workflows
- `/api/engine/...`: install, start, stop, models, LoRAs (the engine's
  status for Setup stays, and the model download takes a tagger only)
- `/api/control`, `/api/wildcards`, `/api/models/info`
- `/api/settings/test`, which would connect to a backend's address

`/api/gen/backends` still answers, with an empty list, and `/api/gen/tag`
tags with the built-in model.
