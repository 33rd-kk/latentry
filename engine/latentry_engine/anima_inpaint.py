"""Inpainting on Anima, which diffusers' Anima pipeline does not offer.

Anima's img2img noises the source's latents once with the scheduler's
`scale_noise`, then steps them with `scheduler.step`. For one run, `masked`
wraps both on the run's scheduler: it keeps the source's latents and the noise
they were mixed with, and after each step puts back, outside the mask, the
source noised to the level the next step expects. The last step puts back the
source itself, so only the masked area is drawn. The pixels outside the mask
are then copied from the source exactly (core.py), as on SDXL.

At the mask's edge the redraw is not all or nothing (with a mask blur): the
cells just inside it are held to the source for the first part of the run
and let go later, the nearer the edge the later, so the new part grows into
the source rather than meeting it at a hard line (as differential diffusion
does). Cells outside the mask are held to the end.

Flow-match only: the noised source at level sigma is (1 - sigma) * x + sigma * noise.
"""

from __future__ import annotations

import contextlib
import math
from collections.abc import Iterator

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

from .pipelines import EngineError

# A latent cell is redrawn when this much of it is painted, so the drawn area
# reaches a little past the brush and the seam falls inside the redrawn part.
LATENT_THRESHOLD = 0.02
# Pixels per latent cell (Anima's VAE).
CELL = 8


def ramp_cells(blur: float) -> int:
    """How many cells inside the mask's edge are let go gradually: none
    without a blur (a hard edge, as asked), else four blur radii: at Extend's
    blur of 8 that is 32 pixels, the whole strip of the picture it redraws
    (lib/generate/outpaint.ts). Half of that left a faint line in a real check."""
    return 0 if blur <= 0 else math.ceil(4 * blur / CELL)


def latent_mask(mask: Image.Image, size: tuple[int, int], ramp: int = 0) -> torch.Tensor:
    """How much each latent cell is redrawn, (height, width): 0 outside the
    mask (kept exactly), 1 well inside it, and over `ramp` cells inside its
    edge rising from 1 / (ramp + 1). The picture's own border is not an edge."""
    width, height = size
    cells = mask.convert("L").resize((width, height), Image.Resampling.BOX)
    values = torch.from_numpy(np.asarray(cells, dtype=np.float32)) / 255.0
    redraw = (values > LATENT_THRESHOLD).to(torch.float32)
    if ramp <= 0:
        return redraw
    # Each erosion peels one cell off the redrawn area; a cell's value is the
    # share of erosions it survives, so it grows with the distance from the edge.
    total = redraw.clone()
    eroded = redraw[None, None]
    for _ in range(ramp):
        # max_pool pads with -inf, so the picture's border never counts as kept.
        eroded = 1.0 - F.max_pool2d(1.0 - eroded, kernel_size=3, stride=1, padding=1)
        total += eroded[0, 0]
    return total / (ramp + 1)


@contextlib.contextmanager
def masked(scheduler, mask: Image.Image, blur: float = 0) -> Iterator[dict]:
    """While open, img2img runs on `scheduler` redraw only `mask`'s area,
    softly over a band inside its edge when `blur` is above 0.

    The scheduler instance is patched, never its class, and put back on exit
    (the loaded model's base scheduler may be the one in use).
    """
    scale_noise = scheduler.scale_noise
    step = scheduler.step
    ramp = ramp_cells(blur)
    state: dict = {"source": None, "noise": None, "redraw": None, "start": None}

    def wrapped_scale_noise(sample, timestep, noise=None, *args, **kwargs):
        noised = scale_noise(sample, timestep, noise, *args, **kwargs)
        # Latents may carry a frame axis (batch, channels, frames, height, width).
        height, width = sample.shape[-2:]
        redraw = latent_mask(mask, (width, height), ramp).to(device=sample.device)
        shape = [1] * (sample.ndim - 2) + [height, width]
        state.update(source=sample.detach().clone(), noise=noise.detach().clone() if noise is not None else None, redraw=redraw.reshape(shape), start=None)
        return noised

    def wrapped_step(model_output, timestep, sample, *args, **kwargs):
        result = step(model_output, timestep, sample, *args, **kwargs)
        if state["source"] is None or state["noise"] is None:
            raise EngineError("Inpainting on this model needs a source picture.")
        stepped = result[0] if isinstance(result, tuple) else result.prev_sample
        # After the step the scheduler points at the level the next step starts from (0 after the last).
        index = int(scheduler.step_index)
        if state["start"] is None:
            # img2img starts part-way down the schedule (strength below 1).
            state["start"] = index - 1
        last = len(scheduler.sigmas) - 1
        progress = (index - state["start"]) / max(1, last - state["start"])
        sigma = scheduler.sigmas[index].to(device=stepped.device, dtype=torch.float32)
        known = (1.0 - sigma) * state["source"] + sigma * state["noise"]
        # A cell is held to the source until the run is (1 - redraw) of the way
        # through: cells well inside the mask never, cells outside it always.
        redraw = state["redraw"]
        keep = ((redraw <= 0) | (redraw < 1.0 - progress)).to(dtype=torch.float32)
        blended = (stepped.to(torch.float32) * (1.0 - keep) + known.to(stepped.device) * keep).to(stepped.dtype)
        if isinstance(result, tuple):
            return (blended, *result[1:])
        result.prev_sample = blended
        return result

    scheduler.scale_noise = wrapped_scale_noise
    scheduler.step = wrapped_step
    try:
        yield state
    finally:
        # The instance attributes go; the class's own methods show through again.
        for name in ("scale_noise", "step"):
            scheduler.__dict__.pop(name, None)
