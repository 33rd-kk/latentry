"""The engine's HTTP API, without a model: the host and token checks, health,
the models folder, and the checks before a load or a download starts.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from latentry_engine import __version__
from latentry_engine.__main__ import open_without_token
from latentry_engine.server import create_app

TOKEN = "test-token-123"
# As Latentry reaches it; TestClient's own default host would be refused.
BASE = "http://127.0.0.1:7861"


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
    return TestClient(create_app(models_dir), base_url=BASE)


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
    assert TestClient(create_app(models_dir), base_url=BASE).get("/api/models").status_code == 200


@pytest.mark.parametrize("host", ["evil.example", "evil.example:7861", "192.168.1.20:7861", "testserver"])
def test_a_host_that_is_not_loopback_is_refused(client: TestClient, host: str) -> None:
    # DNS rebinding: a page whose hostname now points at 127.0.0.1. Refused
    # with or without the token, and on /api/health too.
    assert client.get("/api/health", headers={"Host": host}).status_code == 403
    assert client.get("/api/models", headers={"Host": host, **auth()}).status_code == 403


@pytest.mark.parametrize("host", ["127.0.0.1:7861", "localhost:7861", "[::1]:7861", "LOCALHOST"])
def test_loopback_hosts_are_answered(client: TestClient, host: str) -> None:
    assert client.get("/api/health", headers={"Host": host}).status_code == 200


def test_allowed_hosts_are_answered(models_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LATENTRY_ENGINE_TOKEN", raising=False)
    app = TestClient(create_app(models_dir, allowed_hosts=("gpu-box.lan",)), base_url=BASE)
    assert app.get("/api/health", headers={"Host": "gpu-box.lan:7861"}).status_code == 200
    assert app.get("/api/health", headers={"Host": "other.lan:7861"}).status_code == 403


@pytest.mark.parametrize(
    ("host", "token", "refused"),
    [
        ("127.0.0.1", None, False),
        ("localhost", "", False),
        ("::1", None, False),
        ("0.0.0.0", None, True),
        ("192.168.1.20", "", True),
        ("0.0.0.0", TOKEN, False),
    ],
)
def test_listening_beyond_loopback_needs_a_token(host: str, token: str | None, refused: bool) -> None:
    assert (open_without_token(host, token) is not None) == refused


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
