"""Inpainting on Anima, which diffusers' Anima pipeline does not offer.

Anima's img2img noises the source's latents once with the scheduler's
`scale_noise`, then steps them with `scheduler.step`. For one run, `masked`
wraps both on the run's scheduler: it keeps the source's latents and the noise
they were mixed with, and after each step puts back, outside the mask, the
source noised to the level the next step expects. The last step puts back the
source itself, so only the masked area is drawn. The pixels outside the mask
are then copied from the source exactly (core.py), as on SDXL.

Flow-match only: the noised source at level sigma is (1 - sigma) * x + sigma * noise.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator

import numpy as np
import torch
from PIL import Image

from .pipelines import EngineError

# A latent cell is redrawn when this much of it is painted, so the drawn area
# reaches a little past the brush and the seam falls inside the redrawn part.
LATENT_THRESHOLD = 0.02


def latent_mask(mask: Image.Image, size: tuple[int, int]) -> torch.Tensor:
    """The mask (L, white = redraw) as 1 / 0 per latent cell, (height, width)."""
    width, height = size
    cells = mask.convert("L").resize((width, height), Image.Resampling.BOX)
    values = torch.from_numpy(np.asarray(cells, dtype=np.float32)) / 255.0
    return (values > LATENT_THRESHOLD).to(torch.float32)


@contextlib.contextmanager
def masked(scheduler, mask: Image.Image) -> Iterator[dict]:
    """While open, img2img runs on `scheduler` redraw only `mask`'s area.

    The scheduler instance is patched, never its class, and put back on exit
    (the loaded model's base scheduler may be the one in use).
    """
    scale_noise = scheduler.scale_noise
    step = scheduler.step
    state: dict = {"source": None, "noise": None, "keep": None}

    def wrapped_scale_noise(sample, timestep, noise=None, *args, **kwargs):
        noised = scale_noise(sample, timestep, noise, *args, **kwargs)
        # Latents may carry a frame axis (batch, channels, frames, height, width).
        height, width = sample.shape[-2:]
        redraw = latent_mask(mask, (width, height)).to(device=sample.device)
        shape = [1] * (sample.ndim - 2) + [height, width]
        state.update(source=sample.detach().clone(), noise=noise.detach().clone() if noise is not None else None, keep=(1.0 - redraw).reshape(shape))
        return noised

    def wrapped_step(model_output, timestep, sample, *args, **kwargs):
        result = step(model_output, timestep, sample, *args, **kwargs)
        if state["source"] is None or state["noise"] is None:
            raise EngineError("Inpainting on this model needs a source picture.")
        stepped = result[0] if isinstance(result, tuple) else result.prev_sample
        # After the step the scheduler points at the level the next step starts from (0 after the last).
        sigma = scheduler.sigmas[scheduler.step_index].to(device=stepped.device, dtype=torch.float32)
        known = (1.0 - sigma) * state["source"] + sigma * state["noise"]
        keep = state["keep"].to(dtype=torch.float32)
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
