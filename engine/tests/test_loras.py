"""LoRAs without a model: the loras folder, calls in a prompt, which family a
LoRA was made for, its A1111 hash, and putting adapters on, keeping them
switched off between runs and taking them out (against a stand-in pipeline
that records what it is asked).
"""

from __future__ import annotations

import hashlib
import json
import os
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
    """Keeps adapters per component the way diffusers' LoRA mixin reports
    them, and whether their layers are switched on."""

    def __init__(self, existing: list[str] | None = None, fail_on: str | None = None, half_loads: bool = False):
        self.adapters: list[str] = list(existing or [])
        self.fail_on = fail_on
        self.half_loads = half_loads  # a failing load leaves its adapter in, as PEFT can
        self.enabled = True
        self.log: list[tuple] = []

    def get_list_adapters(self):
        return {"transformer": list(self.adapters)} if self.adapters else {}

    def load_lora_weights(self, path, adapter_name):
        if self.fail_on and path.endswith(self.fail_on):
            if self.half_loads:
                self.adapters.append(adapter_name)
            raise ValueError("shape mismatch")
        self.adapters.append(adapter_name)
        self.log.append(("load", adapter_name))

    def set_adapters(self, names, weights):
        self.log.append(("set", list(names), list(weights)))

    def enable_lora(self):
        self.enabled = True
        self.log.append(("enable",))

    def disable_lora(self):
        self.enabled = False
        self.log.append(("disable",))

    def delete_adapters(self, names):
        self.adapters = [name for name in self.adapters if name not in names]
        self.log.append(("delete", list(names)))

    def unload_lora_weights(self):
        self.adapters = []
        self.log.append(("unload",))

    def loads(self) -> list[str]:
        return [entry[1] for entry in self.log if entry[0] == "load"]


@pytest.fixture
def folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.delenv("LATENTRY_LORA_KEEP", raising=False)
    for name in ("a", "b", "c"):
        write_lora(tmp_path / f"{name}.safetensors", ["x.lora_up.weight"])
    return tmp_path


def call(folder: Path, name: str, weight: float = 1.0) -> loras.LoraCall:
    return loras.LoraCall(name, weight, folder / f"{name}.safetensors")


def run(keeper: loras.LoraKeeper, pipe: StandIn, calls: list[loras.LoraCall]) -> list[tuple]:
    """What the pipe was asked during this run."""
    start = len(pipe.log)
    with keeper.applied(pipe, calls):
        pass
    return pipe.log[start:]


def test_taken_out_after_the_run_when_none_are_kept(folder: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LATENTRY_LORA_KEEP", "0")
    pipe = StandIn()
    with loras.LoraKeeper().applied(pipe, [call(folder, "a", 0.6), call(folder, "b", 1.2)]):
        assert pipe.adapters == ["lora_0", "lora_1"]
    assert pipe.log[-2:] == [("set", ["lora_0", "lora_1"], [0.6, 1.2]), ("unload",)]
    assert pipe.adapters == []


def test_the_pose_adapter_stays_on_when_none_are_kept(folder: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LATENTRY_LORA_KEEP", "0")
    pipe = StandIn(existing=["anima_pose"])
    with loras.LoraKeeper().applied(pipe, [call(folder, "a", 0.5)]):
        assert ("set", ["anima_pose", "lora_0"], [1.0, 0.5]) in pipe.log
    assert pipe.adapters == ["anima_pose"]
    assert pipe.log[-1] == ("set", ["anima_pose"], [1.0])


def test_kept_switched_off_and_not_loaded_again(folder: Path) -> None:
    keeper, pipe = loras.LoraKeeper(), StandIn()
    first = run(keeper, pipe, [call(folder, "a", 0.6)])
    assert first == [("load", "lora_0"), ("enable",), ("set", ["lora_0"], [0.6]), ("disable",)]
    assert pipe.adapters == ["lora_0"] and not pipe.enabled
    assert run(keeper, pipe, [call(folder, "a", 0.9)]) == [("enable",), ("set", ["lora_0"], [0.9]), ("disable",)]


def test_a_run_without_loras_has_them_switched_off(folder: Path) -> None:
    keeper, pipe = loras.LoraKeeper(), StandIn()
    run(keeper, pipe, [call(folder, "a")])
    pipe.enabled = True  # as a layer added by another load would be
    log = run(keeper, pipe, [])
    assert log[0] == ("disable",) and not any(entry[0] in ("set", "enable") for entry in log)
    assert pipe.adapters == ["lora_0"]


def test_only_the_called_ones_are_on(folder: Path) -> None:
    keeper, pipe = loras.LoraKeeper(), StandIn()
    run(keeper, pipe, [call(folder, "a")])
    assert ("set", ["lora_1"], [0.7]) in run(keeper, pipe, [call(folder, "b", 0.7)])
    assert ("set", ["lora_0", "lora_1"], [0.5, 1.0]) in run(keeper, pipe, [call(folder, "a", 0.5), call(folder, "b")])
    assert pipe.loads() == ["lora_0", "lora_1"]


def test_the_least_recently_used_goes_first(folder: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LATENTRY_LORA_KEEP", "2")
    keeper, pipe = loras.LoraKeeper(), StandIn()
    for name in ("a", "b", "a", "c"):  # b is the oldest when c comes
        run(keeper, pipe, [call(folder, name)])
    assert pipe.adapters == ["lora_0", "lora_2"]
    assert ("delete", ["lora_1"]) in pipe.log
    run(keeper, pipe, [call(folder, "b")])
    assert pipe.loads() == ["lora_0", "lora_1", "lora_2", "lora_3"]
    assert pipe.adapters == ["lora_2", "lora_3"], "a went: c and b are newer"


def test_a_run_calling_more_than_are_kept(folder: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LATENTRY_LORA_KEEP", "1")
    keeper, pipe = loras.LoraKeeper(), StandIn()
    with keeper.applied(pipe, [call(folder, "a"), call(folder, "b")]):
        assert pipe.adapters == ["lora_0", "lora_1"], "all on during the run"
    assert pipe.adapters == ["lora_1"]


def test_a_changed_file_is_loaded_again(folder: Path) -> None:
    keeper, pipe = loras.LoraKeeper(), StandIn()
    run(keeper, pipe, [call(folder, "a")])
    stat = (folder / "a.safetensors").stat()
    os.utime(folder / "a.safetensors", ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
    assert ("set", ["lora_1"], [1.0]) in run(keeper, pipe, [call(folder, "a")])
    assert pipe.loads() == ["lora_0", "lora_1"]


def test_loaded_again_after_something_took_every_lora_out(folder: Path) -> None:
    keeper, pipe = loras.LoraKeeper(), StandIn()
    run(keeper, pipe, [call(folder, "a")])
    pipe.unload_lora_weights()
    assert run(keeper, pipe, []) == []
    run(keeper, pipe, [call(folder, "a")])
    assert pipe.loads() == ["lora_0", "lora_1"]


def test_the_pose_adapter_beside_kept_loras(folder: Path) -> None:
    keeper, pipe = loras.LoraKeeper(), StandIn()
    run(keeper, pipe, [call(folder, "a")])
    pipe.adapters.append("anima_pose")  # what AnimaPoseAdapter.applied puts on
    assert run(keeper, pipe, []) == [("enable",), ("set", ["anima_pose"], [1.0]), ("set", ["anima_pose"], [1.0])]
    assert ("set", ["anima_pose", "lora_0"], [1.0, 0.4]) in run(keeper, pipe, [call(folder, "a", 0.4)])
    assert pipe.adapters == ["lora_0", "anima_pose"]
    assert pipe.loads() == ["lora_0"]


def test_a_lora_that_will_not_load_leaves_nothing_half_in(folder: Path) -> None:
    keeper, pipe = loras.LoraKeeper(), StandIn(fail_on="b.safetensors", half_loads=True)
    with pytest.raises(loras.LoraError, match="The LoRA b could not be applied"), keeper.applied(pipe, [call(folder, "a"), call(folder, "b")]):
        pass
    assert pipe.adapters == ["lora_0"] and not pipe.enabled, "a is kept, switched off; b's half is out"


def test_a_lora_that_will_not_load_leaves_nothing_when_none_are_kept(folder: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LATENTRY_LORA_KEEP", "0")
    pipe = StandIn(fail_on="b.safetensors", half_loads=True)
    with pytest.raises(loras.LoraError), loras.LoraKeeper().applied(pipe, [call(folder, "a"), call(folder, "b")]):
        pass
    assert pipe.adapters == []


def test_no_calls_touch_nothing() -> None:
    pipe = StandIn()
    with loras.LoraKeeper().applied(pipe, []):
        pass
    assert pipe.log == []


def test_a_failed_lora_names_no_path_to_the_client(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    class PathInError(StandIn):
        def load_lora_weights(self, path, adapter_name):
            raise OSError(f"Unable to open {path}")

    path = write_lora(tmp_path / "secret-folder" / "style.safetensors", ["x.lora_up.weight"])
    with pytest.raises(loras.LoraError) as raised, loras.LoraKeeper().applied(PathInError(), [loras.LoraCall("style", 1, path)]):
        pass
    message = str(raised.value)
    assert "secret-folder" not in message and str(tmp_path) not in message
    assert "OSError" in message and "log" in message
    assert "secret-folder" in capsys.readouterr().out, "the details are in the engine's log"


def test_a_missing_file_names_no_path_to_the_client(tmp_path: Path) -> None:
    calls = [loras.LoraCall("style", 1, tmp_path / "secret-folder" / "style.safetensors")]
    with pytest.raises(loras.LoraError) as raised, loras.LoraKeeper().applied(StandIn(), calls):
        pass
    assert "secret-folder" not in str(raised.value) and "FileNotFoundError" in str(raised.value)


def test_keep_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LATENTRY_LORA_KEEP", raising=False)
    assert loras.keep_limit() == 4
    for value, expected in (("2", 2), ("0", 0), ("-1", 0), ("lots", 4), ("1.5", 4)):
        monkeypatch.setenv("LATENTRY_LORA_KEEP", value)
        assert loras.keep_limit() == expected
