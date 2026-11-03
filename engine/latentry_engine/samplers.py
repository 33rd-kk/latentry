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

from .models import FAMILY_ANIMA

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

# The samplers above are for SDXL's noise prediction. Anima is a flow-match
# model: those schedulers built from its config draw noise, so it keeps the
# one it ships with (FlowMatchEuler) and its own schedule.
FLOW_FAMILIES = frozenset({FAMILY_ANIMA})


def names_for(family: str | None) -> list[str]:
    """The sampler names a model of `family` can use; all of them before a load."""
    return [DEFAULT] if family in FLOW_FAMILIES else SAMPLER_NAMES


def schedules_for(family: str | None) -> list[str]:
    return [DEFAULT] if family in FLOW_FAMILIES else SCHEDULE_NAMES


class UnknownSampler(ValueError):
    pass


def configure(base_scheduler, sampler: str, schedule: str, family: str | None = None):
    """A scheduler for `sampler` + `schedule`, built from the model's own config."""
    if sampler not in SAMPLER_NAMES:
        raise UnknownSampler(f"Unknown sampler: {sampler}")
    if schedule not in SCHEDULE_NAMES:
        raise UnknownSampler(f"Unknown scheduler: {schedule}")
    if sampler not in names_for(family):
        raise UnknownSampler(f"The sampler {sampler} does not fit this model; use Default")
    if schedule not in schedules_for(family):
        raise UnknownSampler(f"The scheduler {schedule} does not fit this model; use Default")
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
