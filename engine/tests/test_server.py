"""The engine's HTTP API, without a model: the token, health, the models
folder, and the checks before a load or a download starts.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from latentry_engine import __version__
from latentry_engine.server import create_app

TOKEN = "test-token-123"


def write_safetensors(path: Path, keys: list[str]) -> None:
    data = json.dumps({key: {"dtype": "F16", "shape": [1], "data_offsets": [0, 2]} for key in keys}).encode()
    path.write_bytes(struct.pack("<Q", len(data)) + data)


@pytest.fixture
def models_dir(tmp_path: Path) -> Path:
    write_safetensors(tmp_path / "xl.safetensors", ["conditioner.embedders.1.x"])
    write_safetensors(tmp_path / "unknown.safetensors", ["something.else"])
    return tmp_path


@pytest.fixture
def client(models_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("LATENTRY_ENGINE_TOKEN", TOKEN)
    return TestClient(create_app(models_dir))


def auth(token: str = TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_health_needs_no_token_and_says_what_is_off(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["version"] == __version__
    assert body["model"] is None
    assert "Default" in body["samplers"]
    # No model loaded: every feature is off, each with a reason to show.
    assert body["img2img"] is False and body["inpaint"] is False
    assert set(body["unavailable"]) == {"img2img", "inpaint", "pose"}
    assert all(isinstance(reason, str) and reason for reason in body["unavailable"].values())


@pytest.mark.parametrize("headers", [{}, auth("wrong"), {"Authorization": TOKEN}, auth(TOKEN + "x")])
def test_everything_else_needs_the_token(client: TestClient, headers: dict[str, str]) -> None:
    assert client.get("/api/models", headers=headers).status_code == 401
    assert client.post("/api/models/load", json={"id": "xl.safetensors"}, headers=headers).status_code == 401


def test_without_a_token_set_nothing_is_asked(models_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LATENTRY_ENGINE_TOKEN", raising=False)
    assert TestClient(create_app(models_dir)).get("/api/models").status_code == 200


def test_models_lists_the_folder(client: TestClient) -> None:
    body = client.get("/api/models", headers=auth()).json()
    assert [model["id"] for model in body["models"]] == ["unknown.safetensors", "xl.safetensors"]
    assert body["current"] is None


def test_load_refuses_a_missing_or_unknown_model(client: TestClient) -> None:
    assert client.post("/api/models/load", json={"id": "missing.safetensors"}, headers=auth()).status_code == 404
    assert client.post("/api/models/load", json={"id": "unknown.safetensors"}, headers=auth()).status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"repo_id": "no-slash"},
        {"repo_id": "too/many/slashes"},
        {"repo_id": "owner/name", "filename": "../escape.safetensors"},
        {"repo_id": "owner/name", "filename": "weights.bin"},
    ],
)
def test_download_refuses_bad_names_before_starting(client: TestClient, body: dict[str, str]) -> None:
    assert client.post("/api/models/download", json=body, headers=auth()).status_code == 400
    assert client.get("/api/models/downloads", headers=auth()).json() == {"downloads": []}
