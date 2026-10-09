"""LoRAs without a model: the loras folder, calls in a prompt, which family a
LoRA was made for, its A1111 hash, and putting adapters on and taking them
off (against a stand-in pipeline that records what it is asked).
"""

from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

import pytest

from latentry_engine import loras
from latentry_engine.models import FAMILY_ANIMA, FAMILY_SDXL


def write_lora(path: Path, keys: list[str], metadata: dict[str, str] | None = None, data: bytes = b"\x00\x01") -> Path:
    header: dict = {key: {"dtype": "F16", "shape": [1], "data_offsets": [0, 2]} for key in keys}
    if metadata is not None:
        header["__metadata__"] = metadata
    encoded = json.dumps(header).encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(struct.pack("<Q", len(encoded)) + encoded + data)
    return path


SDXL_KEYS = ["lora_unet_input_blocks_4_1_proj_in.lora_down.weight", "lora_te1_text_model_encoder_layers_0_mlp_fc1.lora_up.weight"]
ANIMA_KEYS = ["diffusion_model.blocks.0.self_attn.q_proj.lora_A.weight"]


@pytest.fixture
def models_dir(tmp_path: Path) -> Path:
    write_lora(tmp_path / "loras" / "style.safetensors", SDXL_KEYS, {"modelspec.license": "CreativeML Open RAIL++-M"})
    write_lora(tmp_path / "loras" / "chars" / "Hero.safetensors", ANIMA_KEYS)
    write_lora(tmp_path / "loras" / "old.safetensors", ["lora_te_text_model_encoder_layers_0.lora_up.weight"])
    write_lora(tmp_path / "loras" / ".hidden" / "secret.safetensors", SDXL_KEYS)
    write_lora(tmp_path / "checkpoint.safetensors", ["conditioner.embedders.1.x"])
    return tmp_path


def test_scan_finds_loras_in_subfolders_by_name(models_dir: Path) -> None:
    found = {lora.name: lora for lora in loras.scan(models_dir)}
    assert sorted(found) == ["Hero", "old", "style"]
    assert found["style"].family == FAMILY_SDXL and found["style"].license == "CreativeML Open RAIL++-M"
    assert found["Hero"].family == FAMILY_ANIMA and found["Hero"].license is None
    assert found["old"].family == loras.FAMILY_SD15
    assert set(found["style"].describe()) == {"name", "family", "size_bytes", "license"}, "no paths in what is listed"


def test_scan_without_a_loras_folder(tmp_path: Path) -> None:
    assert loras.scan(tmp_path) == []


def test_family_from_keys_and_metadata() -> None:
    assert loras.family_of(["unet.down_blocks.1.attentions.0.x.lora_A.weight", "text_encoder_2.x.lora_A.weight"], {}) == FAMILY_SDXL
    assert loras.family_of(["transformer.transformer_blocks.0.attn1.to_q.lora_A.weight"], {}) == FAMILY_ANIMA
    assert loras.family_of(["lora_unet_x.lora_down.weight"], {"ss_base_model_version": "sdxl_base_v1-0"}) == FAMILY_SDXL
    assert loras.family_of(["something"], {}) is None


def test_calls_are_taken_out_of_the_prompt() -> None:
    cleaned, calls = loras.calls_in("1girl, <lora:style:0.6>, smile, <LyCo:sub/Hero.safetensors>, <lora:style:1>, <lora:x:bad>")
    assert cleaned == "1girl, smile"
    assert calls == [("style", 0.6), ("Hero", 1.0), ("x", 1.0)]
    assert loras.calls_in("<lora:a:0.5:0.2> tail") == ("tail", [("a", 0.5)])
    assert loras.calls_in("no calls") == ("no calls", [])


def test_resolve_refuses_what_it_cannot_apply(models_dir: Path) -> None:
    prompt, calls = loras.resolve("a, <lora:STYLE:0.7>", models_dir, FAMILY_SDXL)
    assert prompt == "a" and [(call.name, call.weight) for call in calls] == [("style", 0.7)]
    assert loras.resolve("plain", models_dir, FAMILY_SDXL) == ("plain", [])
    assert loras.resolve("a <lora:style:0>", models_dir, FAMILY_SDXL)[1] == [], "weight 0 is not applied"
    with pytest.raises(loras.LoraError, match="No LoRA named missing"):
        loras.resolve("<lora:missing>", models_dir, FAMILY_SDXL)
    with pytest.raises(loras.LoraError, match="ANIMA models"):
        loras.resolve("<lora:hero>", models_dir, FAMILY_SDXL)
    with pytest.raises(loras.LoraError, match="SD15"):
        loras.resolve("<lora:old>", models_dir, FAMILY_SDXL)
    with pytest.raises(loras.LoraError, match="No LoRA named secret"):
        loras.resolve("<lora:secret>", models_dir, FAMILY_SDXL)


def test_hash_is_the_tensor_data_only(tmp_path: Path) -> None:
    path = write_lora(tmp_path / "a.safetensors", ["x.lora_up.weight"], data=b"tensor bytes")
    assert loras.addnet_hash(path) == hashlib.sha256(b"tensor bytes").hexdigest()[:12]
    call = loras.LoraCall("a", 0.5, path)
    assert loras.applied_list([call], with_hashes=False) == [{"name": "a", "weight": 0.5}]
    assert loras.applied_list([call], with_hashes=True)[0]["hash"] == loras.addnet_hash(path)


class StandIn:
    """Keeps adapters per component the way diffusers' LoRA mixin reports them."""

    def __init__(self, existing: list[str] | None = None, fail_on: str | None = None):
        self.adapters: list[str] = list(existing or [])
        self.fail_on = fail_on
        self.log: list[tuple] = []

    def get_list_adapters(self):
        return {"transformer": list(self.adapters)} if self.adapters else {}

    def load_lora_weights(self, path, adapter_name):
        if self.fail_on and path.endswith(self.fail_on):
            raise ValueError("shape mismatch")
        self.adapters.append(adapter_name)
        self.log.append(("load", adapter_name))

    def set_adapters(self, names, weights):
        self.log.append(("set", list(names), list(weights)))

    def delete_adapters(self, names):
        self.adapters = [name for name in self.adapters if name not in names]
        self.log.append(("delete", list(names)))

    def unload_lora_weights(self):
        self.adapters = []
        self.log.append(("unload",))


def test_applied_on_for_the_block_only(tmp_path: Path) -> None:
    calls = [loras.LoraCall("a", 0.6, tmp_path / "a.safetensors"), loras.LoraCall("b", 1.2, tmp_path / "b.safetensors")]
    pipe = StandIn()
    with loras.applied(pipe, calls):
        assert pipe.adapters == ["lora_0", "lora_1"]
    assert pipe.log[-2:] == [("set", ["lora_0", "lora_1"], [0.6, 1.2]), ("unload",)]
    assert pipe.adapters == []


def test_applied_keeps_the_pose_adapter_on(tmp_path: Path) -> None:
    pipe = StandIn(existing=["anima_pose"])
    with loras.applied(pipe, [loras.LoraCall("a", 0.5, tmp_path / "a.safetensors")]):
        assert ("set", ["anima_pose", "lora_0"], [1.0, 0.5]) in pipe.log
    assert pipe.adapters == ["anima_pose"]
    assert pipe.log[-1] == ("set", ["anima_pose"], [1.0])


def test_a_lora_that_will_not_load_leaves_nothing_on(tmp_path: Path) -> None:
    calls = [loras.LoraCall("a", 1, tmp_path / "a.safetensors"), loras.LoraCall("b", 1, tmp_path / "b.safetensors")]
    pipe = StandIn(fail_on="b.safetensors")
    with pytest.raises(loras.LoraError, match="The LoRA b could not be applied"):
        with loras.applied(pipe, calls):
            pass
    assert pipe.adapters == []


def test_no_calls_touch_nothing() -> None:
    pipe = StandIn()
    with loras.applied(pipe, []):
        pass
    assert pipe.log == []
