"""Sampler and scheduler names, as the UI shows them, mapped onto diffusers
schedulers. "Default" keeps whatever the model ships with."""

from __future__ import annotations

import inspect

from diffusers import (
    DDIMScheduler,
    DPMSolverMultistepScheduler,
    EulerAncestralDiscreteScheduler,
    EulerDiscreteScheduler,
    UniPCMultistepScheduler,
)

DEFAULT = "Default"

SAMPLERS: dict[str, tuple[type, dict]] = {
    "Euler": (EulerDiscreteScheduler, {}),
    "Euler a": (EulerAncestralDiscreteScheduler, {}),
    "DPM++ 2M": (DPMSolverMultistepScheduler, {"algorithm_type": "dpmsolver++", "solver_order": 2}),
    "DPM++ 2M SDE": (DPMSolverMultistepScheduler, {"algorithm_type": "sde-dpmsolver++", "solver_order": 2}),
    "UniPC": (UniPCMultistepScheduler, {}),
    "DDIM": (DDIMScheduler, {}),
}

# Noise schedules, as flags the schedulers above may accept.
SCHEDULES: dict[str, dict] = {
    "Karras": {"use_karras_sigmas": True},
    "Exponential": {"use_exponential_sigmas": True},
}

SAMPLER_NAMES = [DEFAULT, *SAMPLERS]
SCHEDULE_NAMES = [DEFAULT, *SCHEDULES]


class UnknownSampler(ValueError):
    pass


def configure(base_scheduler, sampler: str, schedule: str):
    """A scheduler for `sampler` + `schedule`, built from the model's own config."""
    if sampler not in SAMPLER_NAMES:
        raise UnknownSampler(f"Unknown sampler: {sampler}")
    if schedule not in SCHEDULE_NAMES:
        raise UnknownSampler(f"Unknown scheduler: {schedule}")
    if sampler == DEFAULT and schedule == DEFAULT:
        return base_scheduler
    cls, extra = (type(base_scheduler), {}) if sampler == DEFAULT else SAMPLERS[sampler]
    options = dict(extra)
    if schedule != DEFAULT:
        accepted = inspect.signature(cls.__init__).parameters
        for key, value in SCHEDULES[schedule].items():
            # A sampler without that schedule (Euler a has no Karras) just
            # runs its own; the UI lists the combination anyway, like A1111.
            if key in accepted:
                options[key] = value
    return cls.from_config(base_scheduler.config, **options)
