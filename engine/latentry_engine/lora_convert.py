"""Anima LoRAs in kohya's layout (sd-scripts), turned into the one diffusers loads.
Also ComfyUI's names with kohya's tensor kinds (lora_down/up, alpha), which
LoRAs extracted from a model use, embedding layers included.

kohya names a layer after the model's original module path with the dots
made underscores: `lora_unet_blocks_0_cross_attn_k_proj.lora_down.weight`
is `blocks.0.cross_attn.k_proj`. diffusers' Anima loader only converts the
`diffusion_model.…` layout (ComfyUI's), so a kohya file would load nothing.

Underscores cannot be turned back into dots by rule (`cross_attn` has one of
its own), so the names are worked out the other way, as ComfyUI does: from
each layer of the loaded model, its diffusers name back to the original one,
then to kohya's. kohya's `alpha` is folded into the weights, so the result
needs no metadata.
"""

from __future__ import annotations

import collections
import re
from typing import NamedTuple

# Tensor names only sd-scripts' Anima (Cosmos-Predict2) LoRAs have.
KOHYA_ANIMA = re.compile(r"lora_unet_(?:blocks_\d+_(?:self_attn|cross_attn|mlp|adaln_modulation)|llm_adapter_)")

# diffusers' names for the Anima transformer's layers, back to the original
# ones: the reverse of diffusers' _convert_non_diffusers_anima_lora_to_diffusers.
TO_ORIGINAL = (
    ("transformer_blocks.", "blocks."),
    ("norm1.linear_1", "adaln_modulation_self_attn.1"),
    ("norm1.linear_2", "adaln_modulation_self_attn.2"),
    ("norm2.linear_1", "adaln_modulation_cross_attn.1"),
    ("norm2.linear_2", "adaln_modulation_cross_attn.2"),
    ("norm3.linear_1", "adaln_modulation_mlp.1"),
    ("norm3.linear_2", "adaln_modulation_mlp.2"),
    ("attn1.to_q", "self_attn.q_proj"),
    ("attn1.to_k", "self_attn.k_proj"),
    ("attn1.to_v", "self_attn.v_proj"),
    ("attn1.to_out.0", "self_attn.output_proj"),
    ("attn2.to_q", "cross_attn.q_proj"),
    ("attn2.to_k", "cross_attn.k_proj"),
    ("attn2.to_v", "cross_attn.v_proj"),
    ("attn2.to_out.0", "cross_attn.output_proj"),
    ("ff.net.0.proj", "mlp.layer1"),
    ("ff.net.2", "mlp.layer2"),
    ("norm_out.linear_1", "final_layer.adaln_modulation.1"),
    ("norm_out.linear_2", "final_layer.adaln_modulation.2"),
    ("proj_out", "final_layer.linear"),
    ("time_embed.t_embedder", "t_embedder.1"),
    ("time_embed.norm", "t_embedding_norm"),
    ("patch_embed.proj", "x_embedder.proj.1"),
)

# What PEFT puts inside a layer that already has a LoRA on it.
_PEFT_PARTS = (".lora_A", ".lora_B", ".lora_dropout", ".lora_embedding", ".lora_magnitude")


class UnsupportedLora(ValueError):
    """A kohya file with layers that have no place, or no fitting one, in the loaded model."""

    def __init__(self, unknown: int, total: int):
        super().__init__(f"{unknown} of {total} tensors match no layer of this model")
        self.unknown = unknown
        self.total = total


def is_kohya_anima(keys: list[str]) -> bool:
    return any(KOHYA_ANIMA.match(key) for key in keys)


# kohya's tensor kinds; PEFT (which diffusers loads into) knows only lora_A/B.
KOHYA_PARTS = (".lora_down.weight", ".lora_up.weight", ".alpha")


def is_comfy_kohya_anima(keys: list[str]) -> bool:
    """ComfyUI's `diffusion_model.…` names with kohya's lora_down/up tensors,
    as LoRAs extracted from a model come: diffusers renames the layers but
    then fails on the tensor kinds."""
    return any(key.startswith("diffusion_model.") and key.endswith(KOHYA_PARTS[:2]) for key in keys)


def needs_conversion(keys: list[str]) -> bool:
    return is_kohya_anima(keys) or is_comfy_kohya_anima(keys)


def to_kohya_names(state_dict: dict) -> dict:
    """`diffusion_model.blocks.0.x.lora_down.weight` as kohya names it,
    `lora_unet_blocks_0_x.lora_down.weight`; other names are left as they are."""
    renamed: dict = {}
    for key, value in state_dict.items():
        part = next((part for part in KOHYA_PARTS if key.endswith(part)), None)
        if key.startswith("diffusion_model.") and part:
            path = key.removeprefix("diffusion_model.").removesuffix(part)
            key = "lora_unet_" + path.replace(".", "_") + part
        renamed[key] = value
    return renamed


def original_name(name: str) -> str:
    for new, old in TO_ORIGINAL:
        name = name.replace(new, old)
    return name


class Layer(NamedTuple):
    """Where a kohya layer goes: diffusers' key prefix, and whether it is an
    Embedding (PEFT keeps those as lora_embedding_A/B, transposed)."""

    key: str
    embedding: bool = False


def _layer_names(module) -> list[tuple[str, bool]]:
    """The Linear and Embedding layers under `module`, by name, with whether
    each is an Embedding, a LoRA already on one or not."""
    import torch

    layers: list[tuple[str, bool]] = []
    for name, child in module.named_modules():
        if any(part in f".{name}" for part in _PEFT_PARTS):
            continue
        if name.endswith(".base_layer"):
            continue  # its wrapper, named without it, is listed
        base = getattr(child, "base_layer", child)
        if isinstance(base, (torch.nn.Linear, torch.nn.Embedding)):
            layers.append((name, isinstance(base, torch.nn.Embedding)))
    return layers


def _diffusers_agrees(original: str, name: str) -> bool:
    """Whether diffusers' own conversion takes `original` to `name`, where it can be asked."""
    try:
        from diffusers.loaders.lora_conversion_utils import (
            _convert_non_diffusers_anima_lora_to_diffusers,
        )
    except ImportError:
        return True
    converted = _convert_non_diffusers_anima_lora_to_diffusers({f"diffusion_model.{original}.lora_A.weight": None})
    return f"transformer.{name}.lora_A.weight" in converted


def module_names(pipe) -> dict[str, Layer]:
    """kohya's name for each layer of a loaded Anima pipeline -> where it goes in diffusers."""
    names: dict[str, Layer] = {}
    for name, embedding in _layer_names(pipe.transformer):
        original = original_name(name)
        if _diffusers_agrees(original, name):
            names["lora_unet_" + original.replace(".", "_")] = Layer(f"transformer.{name}", embedding)
    conditioner = getattr(pipe, "text_conditioner", None)
    if conditioner is not None:
        # The LLM adapter keeps its original names in diffusers.
        for name, embedding in _layer_names(conditioner):
            names["lora_unet_llm_adapter_" + name.replace(".", "_")] = Layer(f"text_conditioner.{name}", embedding)
    return names


def _split(scale: float) -> tuple[float, float]:
    """`scale` as two factors near each other, so neither half of the LoRA
    shrinks to nothing in half precision (as diffusers' kohya conversions do)."""
    down, up = scale, 1.0
    while down * 2 < up:
        down *= 2
        up /= 2
    return down, up


def kohya_to_diffusers(state_dict: dict, names: dict[str, Layer]) -> dict:
    """A kohya LoRA's tensors as diffusers' `<component>.<layer>.lora_A/B.weight`
    (`lora_embedding_A/B` for an Embedding), with alpha / rank folded in.
    Raises UnsupportedLora when any tensor has no layer to go to: applied in
    part, the picture would not be what it was trained to give."""
    groups: dict[str, dict] = {}
    unknown = 0
    for key, value in state_dict.items():
        stem, _, part = key.partition(".")
        if stem in names and part in ("lora_down.weight", "lora_up.weight", "alpha"):
            groups.setdefault(stem, {})[part] = value
        else:
            unknown += 1
    complete = {stem: parts for stem, parts in groups.items() if "lora_down.weight" in parts and "lora_up.weight" in parts}
    unknown += sum(len(parts) for stem, parts in groups.items() if stem not in complete)
    if unknown or not complete:
        raise UnsupportedLora(unknown, len(state_dict))

    converted: dict = {}
    embedding_ranks: dict[str, list[int]] = {}
    for stem, parts in complete.items():
        layer = names[stem]
        down, up = parts["lora_down.weight"], parts["lora_up.weight"]
        rank = down.shape[0]
        alpha = float(parts["alpha"]) if "alpha" in parts else float(rank)
        scale_down, scale_up = _split(alpha / rank)
        if layer.embedding:
            # kohya's delta is up @ down, (tokens, dim); PEFT's Embedding adds
            # (B @ A).T with A (rank, tokens) and B (dim, rank).
            converted[f"{layer.key}.lora_embedding_A"] = (up * scale_up).T.contiguous()
            converted[f"{layer.key}.lora_embedding_B"] = (down * scale_down).T.contiguous()
            embedding_ranks.setdefault(layer.key.split(".")[0], []).append(rank)
        else:
            converted[f"{layer.key}.lora_A.weight"] = down * scale_down
            converted[f"{layer.key}.lora_B.weight"] = up * scale_up
    _check_embedding_ranks(converted, embedding_ranks, len(state_dict))
    return converted


def _check_embedding_ranks(converted: dict, embedding_ranks: dict[str, list[int]], total: int) -> None:
    """diffusers sizes every layer of a component from its lora_B tensors and
    gives the rest the most common rank (peft.py, get_peft_kwargs), so an
    Embedding is built at that rank: one at another rank would not fit."""
    for component, ranks in embedding_ranks.items():
        linear = [value.shape[1] for key, value in converted.items() if key.startswith(f"{component}.") and key.endswith(".lora_B.weight")]
        usual = collections.Counter(linear).most_common(1)[0][0] if linear else None
        if any(rank != usual for rank in ranks):
            raise UnsupportedLora(2 * sum(rank != usual for rank in ranks), total)
