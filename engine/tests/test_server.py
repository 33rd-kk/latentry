"""The engine's HTTP API, without a model: the host and token checks, health,
the models folder, and the checks before a load or a download starts.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from latentry_engine import __version__, models, server
from latentry_engine.__main__ import open_without_token
from latentry_engine.server import create_app

TOKEN = "test-token-123"
COMMIT = "0123456789abcdef0123456789abcdef01234567"
SHA = "0" * 64
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
    assert body["img2img"] is False and body["inpaint"] is False and body["lora"] is False
    assert set(body["unavailable"]) == {"img2img", "inpaint", "pose", "lora"}
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


def test_loras_lists_the_loras_folder_not_the_models(client: TestClient, models_dir: Path) -> None:
    assert client.get("/api/loras", headers=auth()).json() == {"loras": []}
    (models_dir / "loras").mkdir()
    write_safetensors(models_dir / "loras" / "style.safetensors", ["lora_te1_x.lora_up.weight"])
    assert client.get("/api/loras").status_code == 401
    assert client.get("/api/loras", headers=auth()).json() == {"loras": [{"name": "style", "family": "sdxl", "size_bytes": (models_dir / "loras" / "style.safetensors").stat().st_size, "license": None}]}
    models_listed = [model["id"] for model in client.get("/api/models", headers=auth()).json()["models"]]
    assert models_listed == ["unknown.safetensors", "xl.safetensors"], "a LoRA is not a model"


def test_load_refuses_a_missing_or_unknown_model(client: TestClient) -> None:
    assert client.post("/api/models/load", json={"id": "missing.safetensors"}, headers=auth()).status_code == 404
    assert client.post("/api/models/load", json={"id": "unknown.safetensors"}, headers=auth()).status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"repo_id": "no-slash"},
        {"repo_id": "too/many/slashes"},
        {"repo_id": "owner/name", "filename": "../escape.safetensors", "sha256": SHA},
        {"repo_id": "owner/name", "filename": "weights.bin", "sha256": SHA},
        # A single file must come with its pinned hash.
        {"repo_id": "owner/name", "filename": "model.safetensors"},
    ],
)
def test_download_refuses_bad_names_before_starting(client: TestClient, body: dict[str, str]) -> None:
    assert client.post("/api/models/download", json={"revision": COMMIT, **body}, headers=auth()).status_code == 400
    assert client.get("/api/models/downloads", headers=auth()).json() == {"downloads": []}


@pytest.mark.parametrize(
    "body",
    [
        {"repo_id": "owner/name"},
        {"repo_id": "owner/name", "revision": "main"},
        {"repo_id": "owner/name", "revision": COMMIT.upper()},
        {"repo_id": "owner/name", "revision": COMMIT, "filename": "model.safetensors", "sha256": "abc"},
    ],
)
def test_download_needs_a_commit_and_a_well_formed_hash(client: TestClient, body: dict[str, str]) -> None:
    assert client.post("/api/models/download", json=body, headers=auth()).status_code == 422
    assert client.get("/api/models/downloads", headers=auth()).json() == {"downloads": []}


@pytest.mark.parametrize("repo_id", ["a/..", "../b", "a/.", "./b", "a/b.", "a\\b/c", "a/b c", "/b", "a/"])
def test_download_refuses_a_repo_id_that_is_not_two_plain_parts(client: TestClient, repo_id: str) -> None:
    assert client.post("/api/models/download", json={"repo_id": repo_id, "revision": COMMIT}, headers=auth()).status_code == 400
    assert client.get("/api/models/downloads", headers=auth()).json() == {"downloads": []}


def test_only_the_latest_finished_downloads_are_kept(models_dir: Path) -> None:
    downloads = models.Downloads(models_dir)
    for index in range(downloads.KEEP_FINISHED + 5):
        item = models.Download(f"old{index}", "owner/name", None)
        item.state = "done" if index % 2 else "error"
        downloads.items[item.id] = item
    running = models.Download("running", "owner/name", None)
    running.state = "downloading"
    downloads.items[running.id] = running
    downloads._run = lambda item: None  # no network
    downloads.start("owner/next", None, COMMIT)
    finished = [item for item in downloads.items.values() if item.state in ("done", "error")]
    assert len(finished) == downloads.KEEP_FINISHED - 1
    assert "running" in downloads.items and "old0" not in downloads.items
    assert f"old{downloads.KEEP_FINISHED + 4}" in downloads.items


def test_no_live_api_docs(client: TestClient) -> None:
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path, headers=auth()).status_code == 404


def test_a_body_over_the_limit_is_refused_before_it_is_read(client: TestClient) -> None:
    headers = {**auth(), "Content-Type": "application/json", "Content-Length": str(server.MAX_BODY_BYTES + 1)}
    assert client.post("/api/cancel", content=b"{}", headers=headers).status_code == 413


def test_a_chunked_body_is_refused(client: TestClient) -> None:
    def chunks():
        yield b'{"run_id": null}'

    response = client.post("/api/cancel", content=chunks(), headers={**auth(), "Content-Type": "application/json"})
    assert response.status_code == 411


def test_a_bodyless_post_is_fine(client: TestClient) -> None:
    assert client.post("/api/cancel", json={}, headers=auth()).status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"image_base64": ""},
        {"image_base64": 42},
        {"image_base64": "x", "person": -2},
        {"image_base64": "x", "width": 0},
        {"image_base64": "x", "style": "s" * 33},
    ],
)
def test_pose_checks_its_body(client: TestClient, body: dict[str, object]) -> None:
    assert client.post("/api/pose", json=body, headers=auth()).status_code == 422


def test_generate_caps_the_prompt(client: TestClient) -> None:
    body = {"prompt": "x" * (server.MAX_PROMPT_CHARS + 1)}
    assert client.post("/api/generate", json=body, headers=auth()).status_code == 422
