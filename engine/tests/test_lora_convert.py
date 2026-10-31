"""Anima LoRAs in kohya's layout (lora_convert.py): recognised as Anima, their
names worked out from the model's layers, alpha folded in, and refused when
any part has nowhere to go. Against a small stand-in for the model's layers.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import torch
from safetensors.torch import save_file
from test_loras import StandIn, write_lora

from latentry_engine import lora_convert, loras
from latentry_engine.models import FAMILY_ANIMA, FAMILY_SDXL

KOHYA = [
    "lora_unet_blocks_0_cross_attn_k_proj.lora_down.weight",
    "lora_unet_blocks_0_cross_attn_k_proj.lora_up.weight",
    "lora_unet_blocks_0_cross_attn_k_proj.alpha",
]


class Block(torch.nn.Module):
    """The names diffusers gives one block of Anima's transformer."""

    def __init__(self) -> None:
        super().__init__()
        self.attn1 = torch.nn.Module()
        self.attn1.to_q = torch.nn.Linear(4, 4)
        self.attn1.to_out = torch.nn.ModuleList([torch.nn.Linear(4, 4), torch.nn.Dropout()])
        self.attn2 = torch.nn.Module()
        self.attn2.to_k = torch.nn.Linear(4, 4)
        self.norm1 = torch.nn.Module()
        self.norm1.linear_1 = torch.nn.Linear(4, 4)
        self.ff = torch.nn.Module()
        self.ff.net = torch.nn.ModuleList([torch.nn.Module(), torch.nn.GELU(), torch.nn.Linear(4, 4)])
        self.ff.net[0].proj = torch.nn.Linear(4, 4)


class Wrapped(torch.nn.Module):
    """A layer with a LoRA on it, as PEFT leaves it."""

    def __init__(self) -> None:
        super().__init__()
        self.base_layer = torch.nn.Linear(4, 4)
        self.lora_A = torch.nn.ModuleDict({"lora_0": torch.nn.Linear(4, 2)})
        self.lora_B = torch.nn.ModuleDict({"lora_0": torch.nn.Linear(2, 4)})


class WrappedEmbedding(torch.nn.Module):
    """An Embedding with a LoRA on it, as PEFT leaves it."""

    def __init__(self) -> None:
        super().__init__()
        self.base_layer = torch.nn.Embedding(10, 4)
        self.lora_embedding_A = torch.nn.ParameterDict({"lora_0": torch.nn.Parameter(torch.zeros(2, 10))})


class Pipe(StandIn):
    def __init__(self) -> None:
        super().__init__()
        self.transformer = torch.nn.Module()
        self.transformer.transformer_blocks = torch.nn.ModuleList([Block()])
        self.transformer.proj_out = torch.nn.Linear(4, 4)
        self.text_conditioner = torch.nn.Module()
        self.text_conditioner.blocks = torch.nn.ModuleList([torch.nn.Module()])
        self.text_conditioner.blocks[0].self_attn = torch.nn.Module()
        self.text_conditioner.blocks[0].self_attn.q_proj = torch.nn.Linear(4, 4)
        self.text_conditioner.embed = torch.nn.Embedding(10, 4)
        self.given: list = []

    def load_lora_weights(self, weights, adapter_name):
        self.given.append(weights)
        super().load_lora_weights(weights if isinstance(weights, str) else "converted", adapter_name)


def test_kohya_anima_keys_are_anima() -> None:
    assert loras.family_of(KOHYA, {}) == FAMILY_ANIMA
    assert loras.family_of(["lora_unet_llm_adapter_blocks_0_self_attn_q_proj.lora_up.weight"], {}) == FAMILY_ANIMA
    assert loras.family_of(["lora_unet_input_blocks_4_1_proj_in.lora_down.weight"], {}) == FAMILY_SDXL, "SDXL's kohya names are not taken for Anima"
    assert loras.family_of(["lora_unet_down_blocks_0_attentions_0.lora_down.weight"], {}) == loras.FAMILY_SD15


def test_a_kohya_anima_lora_is_refused_on_sdxl(tmp_path: Path) -> None:
    write_lora(tmp_path / "loras" / "face.safetensors", KOHYA)
    with pytest.raises(loras.LoraError, match="ANIMA models"):
        loras.resolve("<lora:face>", tmp_path, FAMILY_SDXL)


def test_names_from_the_models_layers() -> None:
    names = lora_convert.module_names(Pipe())
    assert names.pop("lora_unet_llm_adapter_embed") == lora_convert.Layer("text_conditioner.embed", embedding=True)
    assert not any(layer.embedding for layer in names.values())
    assert {stem: layer.key for stem, layer in names.items()} == {
        "lora_unet_blocks_0_self_attn_q_proj": "transformer.transformer_blocks.0.attn1.to_q",
        "lora_unet_blocks_0_self_attn_output_proj": "transformer.transformer_blocks.0.attn1.to_out.0",
        "lora_unet_blocks_0_cross_attn_k_proj": "transformer.transformer_blocks.0.attn2.to_k",
        "lora_unet_blocks_0_adaln_modulation_self_attn_1": "transformer.transformer_blocks.0.norm1.linear_1",
        "lora_unet_blocks_0_mlp_layer1": "transformer.transformer_blocks.0.ff.net.0.proj",
        "lora_unet_blocks_0_mlp_layer2": "transformer.transformer_blocks.0.ff.net.2",
        "lora_unet_final_layer_linear": "transformer.proj_out",
        "lora_unet_llm_adapter_blocks_0_self_attn_q_proj": "text_conditioner.blocks.0.self_attn.q_proj",
    }


def test_names_with_a_lora_already_on() -> None:
    pipe = Pipe()
    pipe.transformer.transformer_blocks[0].attn2.to_k = Wrapped()
    pipe.text_conditioner.embed = WrappedEmbedding()
    names = lora_convert.module_names(pipe)
    assert names["lora_unet_blocks_0_cross_attn_k_proj"] == lora_convert.Layer("transformer.transformer_blocks.0.attn2.to_k")
    assert names["lora_unet_llm_adapter_embed"] == lora_convert.Layer("text_conditioner.embed", embedding=True)
    assert not any("lora_" in layer.key or "base_layer" in layer.key for layer in names.values())


def test_alpha_is_folded_in() -> None:
    down, up = torch.randn(2, 4), torch.randn(4, 2)
    names = {"lora_unet_blocks_0_cross_attn_k_proj": lora_convert.Layer("transformer.transformer_blocks.0.attn2.to_k")}
    converted = lora_convert.kohya_to_diffusers(
        {"lora_unet_blocks_0_cross_attn_k_proj.lora_down.weight": down, "lora_unet_blocks_0_cross_attn_k_proj.lora_up.weight": up, "lora_unet_blocks_0_cross_attn_k_proj.alpha": torch.tensor(1.0)},
        names,
    )
    assert set(converted) == {"transformer.transformer_blocks.0.attn2.to_k.lora_A.weight", "transformer.transformer_blocks.0.attn2.to_k.lora_B.weight"}
    delta = converted["transformer.transformer_blocks.0.attn2.to_k.lora_B.weight"] @ converted["transformer.transformer_blocks.0.attn2.to_k.lora_A.weight"]
    assert torch.allclose(delta, (up @ down) * 0.5), "alpha 1 over rank 2"
    without_alpha = lora_convert.kohya_to_diffusers({key: value for key, value in {"lora_unet_blocks_0_cross_attn_k_proj.lora_down.weight": down, "lora_unet_blocks_0_cross_attn_k_proj.lora_up.weight": up}.items()}, names)
    assert torch.allclose(without_alpha["transformer.transformer_blocks.0.attn2.to_k.lora_B.weight"] @ without_alpha["transformer.transformer_blocks.0.attn2.to_k.lora_A.weight"], up @ down)


def test_an_embedding_adds_what_kohya_means_in_peft() -> None:
    """Through PEFT itself, as diffusers loads it: the embedding comes out as
    W + up @ down * alpha / rank, and a Linear beside it as W + up @ down."""
    from peft import LoraConfig, inject_adapter_in_model, set_peft_model_state_dict

    torch.manual_seed(0)
    model = torch.nn.Module()
    model.embed = torch.nn.Embedding(10, 4)
    model.proj = torch.nn.Linear(4, 4, bias=False)
    weights = {"embed": model.embed.weight.detach().clone(), "proj": model.proj.weight.detach().clone()}
    tensors = {
        "lora_unet_llm_adapter_embed.lora_down.weight": torch.randn(2, 4),
        "lora_unet_llm_adapter_embed.lora_up.weight": torch.randn(10, 2),
        "lora_unet_llm_adapter_embed.alpha": torch.tensor(1.0),
        "lora_unet_llm_adapter_proj.lora_down.weight": torch.randn(2, 4),
        "lora_unet_llm_adapter_proj.lora_up.weight": torch.randn(4, 2),
    }
    names = {"lora_unet_llm_adapter_embed": lora_convert.Layer("text_conditioner.embed", True), "lora_unet_llm_adapter_proj": lora_convert.Layer("text_conditioner.proj")}
    converted = {key.removeprefix("text_conditioner."): value for key, value in lora_convert.kohya_to_diffusers(tensors, names).items()}
    assert set(converted) == {"embed.lora_embedding_A", "embed.lora_embedding_B", "proj.lora_A.weight", "proj.lora_B.weight"}

    inject_adapter_in_model(LoraConfig(r=2, lora_alpha=2, target_modules=["embed", "proj"]), model, adapter_name="lora_0")
    result = set_peft_model_state_dict(model, converted, adapter_name="lora_0")
    assert not [key for key in result.unexpected_keys if "lora" in key]
    tokens = torch.tensor([0, 3, 9])
    expected = weights["embed"] + tensors["lora_unet_llm_adapter_embed.lora_up.weight"] @ tensors["lora_unet_llm_adapter_embed.lora_down.weight"] * 0.5
    assert torch.allclose(model.embed(tokens), expected[tokens], atol=1e-5)
    x = torch.randn(3, 4)
    delta = tensors["lora_unet_llm_adapter_proj.lora_up.weight"] @ tensors["lora_unet_llm_adapter_proj.lora_down.weight"]
    assert torch.allclose(model.proj(x), x @ (weights["proj"] + delta).T, atol=1e-5)


def test_an_embedding_at_another_rank_than_its_component_is_refused() -> None:
    names = {"lora_unet_llm_adapter_embed": lora_convert.Layer("text_conditioner.embed", True), "lora_unet_llm_adapter_proj": lora_convert.Layer("text_conditioner.proj")}
    tensors = {
        "lora_unet_llm_adapter_embed.lora_down.weight": torch.zeros(8, 4),
        "lora_unet_llm_adapter_embed.lora_up.weight": torch.zeros(10, 8),
        "lora_unet_llm_adapter_proj.lora_down.weight": torch.zeros(2, 4),
        "lora_unet_llm_adapter_proj.lora_up.weight": torch.zeros(4, 2),
    }
    with pytest.raises(lora_convert.UnsupportedLora):
        lora_convert.kohya_to_diffusers(tensors, names)
    # Nor with no Linear beside it to size it by.
    with pytest.raises(lora_convert.UnsupportedLora):
        lora_convert.kohya_to_diffusers({key: value for key, value in tensors.items() if "embed" in key}, names)


@pytest.mark.parametrize(
    "extra",
    [
        {"lora_te_layers_0_self_attn_q_proj.lora_down.weight": torch.zeros(2, 4)},  # a text-encoder layer
        {"lora_unet_blocks_0_cross_attn_k_proj.hada_w1_a": torch.zeros(2, 4)},  # LyCORIS
        {"lora_unet_blocks_9_cross_attn_k_proj.lora_down.weight": torch.zeros(2, 4)},  # a block the model lacks
    ],
)
def test_any_part_with_nowhere_to_go_refuses_the_whole(extra: dict) -> None:
    names = {"lora_unet_blocks_0_cross_attn_k_proj": lora_convert.Layer("transformer.transformer_blocks.0.attn2.to_k")}
    tensors = {"lora_unet_blocks_0_cross_attn_k_proj.lora_down.weight": torch.zeros(2, 4), "lora_unet_blocks_0_cross_attn_k_proj.lora_up.weight": torch.zeros(4, 2), **extra}
    with pytest.raises(lora_convert.UnsupportedLora):
        lora_convert.kohya_to_diffusers(tensors, names)


def test_a_kohya_file_is_loaded_converted(tmp_path: Path) -> None:
    path = tmp_path / "face.safetensors"
    save_file({"lora_unet_blocks_0_cross_attn_k_proj.lora_down.weight": torch.ones(2, 4), "lora_unet_blocks_0_cross_attn_k_proj.lora_up.weight": torch.ones(4, 2), "lora_unet_blocks_0_cross_attn_k_proj.alpha": torch.tensor(2.0)}, str(path))
    pipe = Pipe()
    with loras.LoraKeeper().applied(pipe, [loras.LoraCall("face", 0.8, path)]):
        pass
    assert set(pipe.given[0]) == {"transformer.transformer_blocks.0.attn2.to_k.lora_A.weight", "transformer.transformer_blocks.0.attn2.to_k.lora_B.weight"}


def test_comfy_names_with_kohya_tensor_kinds_are_converted(tmp_path: Path) -> None:
    keys = ["diffusion_model.blocks.0.cross_attn.k_proj.lora_down.weight", "diffusion_model.blocks.0.cross_attn.k_proj.lora_up.weight"]
    assert lora_convert.needs_conversion(keys) and loras.family_of(keys, {}) == FAMILY_ANIMA
    assert not lora_convert.needs_conversion(["diffusion_model.blocks.0.cross_attn.k_proj.lora_A.weight"]), "diffusers reads lora_A/B itself"
    assert lora_convert.to_kohya_names({key: 1 for key in [*keys, "diffusion_model.llm_adapter.blocks.0.self_attn.q_proj.alpha", "other"]}) == {
        "lora_unet_blocks_0_cross_attn_k_proj.lora_down.weight": 1,
        "lora_unet_blocks_0_cross_attn_k_proj.lora_up.weight": 1,
        "lora_unet_llm_adapter_blocks_0_self_attn_q_proj.alpha": 1,
        "other": 1,
    }
    path = tmp_path / "extracted.safetensors"
    save_file({keys[0]: torch.ones(2, 4), keys[1]: torch.ones(4, 2)}, str(path))
    pipe = Pipe()
    with loras.LoraKeeper().applied(pipe, [loras.LoraCall("extracted", 1, path)]):
        pass
    assert set(pipe.given[0]) == {"transformer.transformer_blocks.0.attn2.to_k.lora_A.weight", "transformer.transformer_blocks.0.attn2.to_k.lora_B.weight"}


def test_sdxl_written_with_diffusers_block_names_is_sdxl() -> None:
    # As TheLastBen's trainer writes SDXL, with no metadata.
    sdxl = ["lora_unet_down_blocks_1_attentions_0_transformer_blocks_1_attn1_to_k.lora_down.weight", "lora_unet_down_blocks_1_attentions_0_proj_in.lora_down.weight"]
    assert loras.family_of(sdxl, {}) == FAMILY_SDXL
    assert loras.family_of(["lora_unet_down_blocks_0_attentions_0_transformer_blocks_0_attn1_to_k.lora_down.weight"], {}) == loras.FAMILY_SD15
    assert loras.family_of(["lora_unet_down_blocks_0_attentions_0_transformer_blocks_0_attn1_to_k.lora_down.weight"], {"ss_base_model_version": "sdxl_base_v1-0"}) == FAMILY_SDXL


@pytest.mark.parametrize(
    ("key", "kind"),
    [
        ("lora_unet_down_blocks_0_resnets_0_conv1.lokr_w1", "LoKr"),
        ("lycoris_down_blocks_1_attentions_0_transformer_blocks_0_attn1_to_k.lokr_w2", "LoKr"),
        ("lycoris_single_transformer_blocks_0_attn_to_k.hada_w1_a", "LoHa"),
    ],
)
def test_lycoris_algorithms_diffusers_cannot_load_are_refused_by_name(tmp_path: Path, key: str, kind: str) -> None:
    write_lora(tmp_path / "loras" / "odd.safetensors", [key, key.rsplit(".", 1)[0] + ".alpha"], {"ss_base_model_version": "sdxl_base_v1-0"})
    with pytest.raises(loras.LoraError, match=f"The LoRA odd is a LyCORIS {kind}, which this engine cannot apply"):
        loras.resolve("<lora:odd>", tmp_path, FAMILY_SDXL)
    assert loras.lycoris_kind(["lora_unet_x.lora_down.weight", "lora_unet_x.alpha"]) is None, "LoCon is plain lora_down/up"


def test_a_kohya_file_with_a_text_encoder_part_is_refused_by_name(tmp_path: Path) -> None:
    path = tmp_path / "face.safetensors"
    save_file({"lora_unet_blocks_0_cross_attn_k_proj.lora_down.weight": torch.ones(2, 4), "lora_unet_blocks_0_cross_attn_k_proj.lora_up.weight": torch.ones(4, 2), "lora_te_x.lora_down.weight": torch.ones(2, 4)}, str(path))
    with pytest.raises(loras.LoraError, match=r"The LoRA face has layers this engine cannot put on an Anima model \(1 of 3"), loras.LoraKeeper().applied(Pipe(), [loras.LoraCall("face", 1, path)]):
        pass


def test_a_lora_that_loads_nothing_says_so(tmp_path: Path) -> None:
    class LoadsNothing(StandIn):
        def load_lora_weights(self, path, adapter_name):
            self.log.append(("load", adapter_name))

    path = write_lora(tmp_path / "odd.safetensors", ["something_else.lora_up.weight"])
    pipe = LoadsNothing()
    with pytest.raises(loras.LoraError, match="The LoRA odd has no layers this model has"), loras.LoraKeeper().applied(pipe, [loras.LoraCall("odd", 1, path)]):
        pass
    assert not any(entry[0] == "set" for entry in pipe.log), "nothing is switched on"
