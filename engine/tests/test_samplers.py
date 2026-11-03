"""Sampler names per model family, and the schedulers built from them, from
each family's own scheduler config (no weights needed)."""

from __future__ import annotations

import pytest
from diffusers import (
    EulerDiscreteScheduler,
    FlowMatchEulerDiscreteScheduler,
    UniPCMultistepScheduler,
)

from latentry_engine import samplers
from latentry_engine.models import FAMILY_ANIMA, FAMILY_SDXL

SDXL_BASE = EulerDiscreteScheduler(beta_schedule="scaled_linear", beta_start=0.00085, beta_end=0.012)
# As Anima's diffusers folder ships it.
ANIMA_BASE = FlowMatchEulerDiscreteScheduler(shift=3.0, use_dynamic_shifting=False)


def test_sdxl_and_no_model_list_every_sampler() -> None:
    for family in (FAMILY_SDXL, None):
        assert samplers.names_for(family) == samplers.SAMPLER_NAMES
        assert samplers.schedules_for(family) == samplers.SCHEDULE_NAMES
    assert "Euler a" in samplers.names_for(FAMILY_SDXL)


def test_anima_lists_only_its_own_scheduler() -> None:
    assert samplers.names_for(FAMILY_ANIMA) == [samplers.DEFAULT]
    assert samplers.schedules_for(FAMILY_ANIMA) == [samplers.DEFAULT]


def test_anima_default_keeps_the_flow_match_scheduler() -> None:
    assert samplers.configure(ANIMA_BASE, samplers.DEFAULT, samplers.DEFAULT, FAMILY_ANIMA) is ANIMA_BASE


@pytest.mark.parametrize(("sampler", "schedule"), [("Euler", "Default"), ("DPM++ 2M", "Default"), ("Default", "Karras")])
def test_anima_refuses_sdxl_samplers(sampler: str, schedule: str) -> None:
    with pytest.raises(samplers.UnknownSampler, match="does not fit this model"):
        samplers.configure(ANIMA_BASE, sampler, schedule, FAMILY_ANIMA)


def test_sdxl_still_builds_its_samplers() -> None:
    built = samplers.configure(SDXL_BASE, "UniPC", "Karras", FAMILY_SDXL)
    assert isinstance(built, UniPCMultistepScheduler)
    assert built.config.use_karras_sigmas is True


def test_unknown_names_are_refused_for_every_family() -> None:
    for family in (FAMILY_SDXL, FAMILY_ANIMA, None):
        with pytest.raises(samplers.UnknownSampler, match="Unknown sampler"):
            samplers.configure(SDXL_BASE, "Nope", samplers.DEFAULT, family)
