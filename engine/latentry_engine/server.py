"""The HTTP API Latentry speaks to (see docs/backend-api.md), plus model
management for Latentry's engine manager.

    GET  /api/health              status, loaded model, GPU, what it can do
    GET  /api/presets             none: the engine has no speed presets
    POST /api/generate            Server-Sent Events: start / step / image / done / cancelled / error
    POST /api/cancel              { run_id }
    POST /api/pose                people in a picture and the skeleton to follow (poseorbit)
    GET  /api/loras               the LoRAs in the models folder's loras folder
    GET  /api/models              the models folder, and what is loaded
    POST /api/models/load         { id }   (returns at once; watch /api/health)
    POST /api/models/download     { repo_id, filename? }
    GET  /api/models/downloads    progress of downloads

Bound to 127.0.0.1 by default: Latentry talks to it, nothing else needs to.
An optional token (LATENTRY_ENGINE_TOKEN) is checked as a Bearer token.
Only requests for a loopback host (or one passed in allowed_hosts) are
answered, so a web page whose hostname is re-resolved to 127.0.0.1 (DNS
rebinding) cannot drive it from a browser on this machine.
"""

from __future__ import annotations

import hmac
import json
import os
import threading
import uuid
from pathlib import Path
from queue import Empty, Queue
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import poseorbit
import poseorbit.api

from . import __version__, loras, models, pose_control, samplers
from .core import Cancelled, Engine, EngineError, GenerateRequest, decode_image
from .gpu import plan as gpu_plan


# What one request may carry. Latentry sends at most 48 MB (lib/limits.ts),
# with each picture under 32M characters of base64 (lib/api.ts).
MAX_BODY_BYTES = 64 * 1024 * 1024
MAX_IMAGE_CHARS = 32 * 1024 * 1024
MAX_PROMPT_CHARS = 20_000


class GenerateBody(BaseModel):
    prompt: str = Field(max_length=MAX_PROMPT_CHARS)
    negative_prompt: str = Field("", max_length=MAX_PROMPT_CHARS)
    width: int = Field(1024, ge=64, le=4096)
    height: int = Field(1024, ge=64, le=4096)
    seed: int = -1
    image_count: int = Field(1, ge=1, le=16)
    sampler: str = samplers.DEFAULT
    scheduler: str = samplers.DEFAULT
    num_inference_steps: int = Field(28, ge=1, le=200)
    guidance_scale: float = Field(6.0, ge=0, le=30)
    init_image_base64: str | None = Field(None, max_length=MAX_IMAGE_CHARS)
    strength: float = Field(0.6, ge=0.01, le=1)
    mask_base64: str | None = Field(None, max_length=MAX_IMAGE_CHARS)
    mask_blur: float = Field(4, ge=0, le=64)
    # A picture whose pose to follow (detected here), or with pose_is_skeleton
    # a skeleton already drawn by /api/pose.
    pose_image_base64: str | None = Field(None, max_length=MAX_IMAGE_CHARS)
    pose_is_skeleton: bool = False
    pose_strength: float = Field(1.0, ge=0, le=2)
    # Say each applied LoRA's hash in the image events. Off unless asked:
    # a hash identifies the file on this machine.
    lora_hashes: bool = False


class PoseBody(BaseModel):
    """What /api/pose reads (poseorbit.api.handle); anything else is dropped."""

    image_base64: str = Field(min_length=1, max_length=MAX_IMAGE_CHARS)
    width: float | None = Field(None, gt=0, le=8192)
    height: float | None = Field(None, gt=0, le=8192)
    person: int | None = Field(None, ge=-1)
    style: str | None = Field(None, max_length=32)
    want_3d: bool = False
    camera: dict[str, Any] | None = None


class CancelBody(BaseModel):
    run_id: str | None = None


class LoadBody(BaseModel):
    id: str


class DownloadBody(BaseModel):
    repo_id: str
    filename: str | None = None


LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


def hostname_of(host: str) -> str:
    """Host header -> bare lowercase hostname (port and IPv6 brackets dropped)."""
    host = host.strip().lower()
    if host.startswith("["):
        return host[1 : host.find("]")]
    return host.rsplit(":", 1)[0] if ":" in host else host


def create_app(models_dir: Path, initial_model: str | None = None, allowed_hosts: tuple[str, ...] = ()) -> FastAPI:
    # No /docs, /redoc or /openapi.json: docs/backend-api.md describes the API,
    # and nothing needs a live map of it.
    app = FastAPI(title="Latentry engine", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
    hosts = LOOPBACK_HOSTS | {host.strip().lower() for host in allowed_hosts if host.strip()}
    plan = gpu_plan()
    controls = pose_control.controls_dir(models_dir)
    engine = Engine(plan, controls)
    # CPU only; its models load on the first /api/pose.
    detector = poseorbit.Detector(controls / "poseorbit")
    downloads = models.Downloads(models_dir)
    token = os.environ.get("LATENTRY_ENGINE_TOKEN") or None

    run = {"lock": threading.Lock(), "id": None, "cancel": threading.Event()}

    @app.middleware("http")
    async def check_token(request: Request, call_next):
        # Before the token, and for /api/health too: a rebound hostname is
        # refused whether or not a token is set.
        if hostname_of(request.headers.get("host", "")) not in hosts:
            from fastapi.responses import JSONResponse

            return JSONResponse({"detail": "Forbidden host"}, status_code=403)
        if token and request.url.path != "/api/health":
            # Compared in constant time, so the answer's timing says nothing about the token.
            sent = request.headers.get("authorization", "").encode()
            if not hmac.compare_digest(sent, f"Bearer {token}".encode()):
                from fastapi.responses import JSONResponse

                return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        # Bodies are read whole into memory, so their size is bounded up front.
        # A chunked body has no size to check, and Latentry never sends one.
        if "chunked" in request.headers.get("transfer-encoding", "").lower():
            from fastapi.responses import JSONResponse

            return JSONResponse({"detail": "Content-Length is required"}, status_code=411)
        length = request.headers.get("content-length", "")
        if length and (not length.isdigit() or int(length) > MAX_BODY_BYTES):
            from fastapi.responses import JSONResponse

            return JSONResponse({"detail": "Request body too large"}, status_code=413)
        return await call_next(request)

    def load_async(model_id: str) -> None:
        info = models.find(models_dir, model_id)
        if info is None:
            raise HTTPException(404, f"No model {model_id!r} in {models_dir}")
        if info.family is None:
            raise HTTPException(422, f"{info.name} is not a kind of model this engine can run (SDXL checkpoints, SDXL or Anima diffusers folders)")
        if run["lock"].locked():
            raise HTTPException(409, "Generating; load the model when the run has finished")

        def work():
            try:
                engine.load(info)
            except Exception as error:  # noqa: BLE001 - kept in engine.load_error
                print(f"[engine] loading {model_id} failed: {error}", flush=True)

        engine.loading = model_id
        threading.Thread(target=work, daemon=True).start()

    if initial_model:
        try:
            load_async(initial_model)
        except HTTPException as error:
            print(f"[engine] not loading {initial_model}: {error.detail}", flush=True)

    @app.get("/api/health")
    def health():
        loaded = engine.loaded
        return {
            "status": "ok",
            "engine": "latentry",
            "version": __version__,
            "model": loaded.info.name if loaded else None,
            "model_id": loaded.info.id if loaded else None,
            "family": loaded.family if loaded else None,
            "loading": engine.loading,
            "load_error": engine.load_error,
            "busy": run["lock"].locked() or engine.loading is not None,
            "run_id": run["id"],
            "samplers": samplers.SAMPLER_NAMES,
            "schedulers": samplers.SCHEDULE_NAMES,
            "gpu": plan.describe(),
            **engine.capabilities(),
        }

    @app.get("/api/presets")
    def presets():
        return {"default": None, "presets": []}

    @app.post("/api/cancel")
    def cancel(body: CancelBody):
        if not run["lock"].locked():
            return {"status": "idle"}
        if body.run_id is not None and body.run_id != run["id"]:
            raise HTTPException(409, "That run has already ended")
        run["cancel"].set()
        return {"status": "cancelling", "run_id": run["id"]}

    @app.post("/api/pose")
    async def pose(body: PoseBody):
        """The skeleton /api/generate would follow, for the UI's preview.

        Outside the run lock: detection is on the CPU and does not touch the
        model, so it works while a run is going. The skeleton is drawn in the
        loaded model's style unless the request names one.
        """
        try:
            return await run_in_threadpool(poseorbit.api.handle, detector, body.model_dump(exclude_none=True), engine.pose_style())
        except ValueError as error:  # BadRequest, NoPersonError
            raise HTTPException(400, str(error)) from error

    def pose_skeleton(body: GenerateBody, size: tuple[int, int]):
        if not body.pose_image_base64:
            return None
        picture = decode_image(body.pose_image_base64)
        if body.pose_is_skeleton:
            return picture
        return poseorbit.pose(detector, picture, size, style=engine.pose_style()).skeleton

    @app.post("/api/generate")
    def generate(body: GenerateBody):
        if engine.loaded is None:
            raise HTTPException(409, "No model is loaded" if engine.loading is None else "The model is still loading")
        try:
            prompt, calls = loras.resolve(body.prompt, models_dir, engine.loaded.family)
        except loras.LoraError as error:
            raise HTTPException(400, str(error)) from error
        if not run["lock"].acquire(blocking=False):
            raise HTTPException(409, "A generation is already running")
        try:
            request = GenerateRequest(
                prompt=prompt,
                negative_prompt=body.negative_prompt,
                width=body.width,
                height=body.height,
                seed=body.seed,
                image_count=body.image_count,
                sampler=body.sampler,
                scheduler=body.scheduler,
                num_inference_steps=body.num_inference_steps,
                guidance_scale=body.guidance_scale,
                init_image=decode_image(body.init_image_base64) if body.init_image_base64 else None,
                strength=body.strength,
                mask=decode_image(body.mask_base64) if body.mask_base64 and body.init_image_base64 else None,
                mask_blur=body.mask_blur,
                pose_skeleton=pose_skeleton(body, (body.width, body.height)),
                pose_strength=body.pose_strength,
                loras=calls,
                lora_hashes=body.lora_hashes,
            )
        except Exception as error:
            run["lock"].release()
            raise HTTPException(400, f"Could not read the request: {error}") from error

        run_id = uuid.uuid4().hex
        run["id"] = run_id
        run["cancel"] = threading.Event()
        events: Queue = Queue()

        def emit(event: str, data: dict) -> None:
            events.put((event, data))

        def work():
            try:
                engine.generate(request, emit, run["cancel"], run_id)
                emit("done", {})
            except Cancelled:
                emit("cancelled", {})
            except samplers.UnknownSampler as error:
                emit("error", {"message": str(error)})
            except (EngineError, loras.LoraError) as error:
                emit("error", {"message": str(error)})
            except Exception as error:  # noqa: BLE001
                message = str(error)
                if "out of memory" in message.lower():
                    message = "The GPU ran out of memory. Try a smaller size or fewer images."
                    try:
                        import torch

                        torch.cuda.empty_cache()
                    except Exception:  # noqa: BLE001
                        pass
                print(f"[engine] generation failed: {error!r}", flush=True)
                emit("error", {"message": message})
            finally:
                events.put(None)

        threading.Thread(target=work, daemon=True).start()

        def stream():
            try:
                while True:
                    try:
                        item = events.get(timeout=15)
                    except Empty:
                        yield ": keep-alive\n\n"
                        continue
                    if item is None:
                        break
                    event, data = item
                    yield f"event: {event}\ndata: {json.dumps(data)}\n\n"
            finally:
                run["id"] = None
                if run["lock"].locked():
                    run["lock"].release()

        return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})

    @app.get("/api/models")
    def list_models():
        return {
            "models_dir": str(models_dir),
            "models": [model.describe() for model in models.scan(models_dir)],
            "current": engine.loaded.info.id if engine.loaded else None,
            "loading": engine.loading,
            "load_error": engine.load_error,
        }

    @app.get("/api/loras")
    def list_loras():
        return {"loras": [lora.describe() for lora in loras.scan(models_dir)]}

    @app.post("/api/models/load")
    def load(body: LoadBody):
        load_async(body.id)
        return {"status": "loading", "id": body.id}

    @app.post("/api/models/download")
    def download(body: DownloadBody):
        if not models.is_repo_id(body.repo_id):
            raise HTTPException(400, "repo_id is owner/name")
        if body.filename is not None and (".." in body.filename or not body.filename.endswith(".safetensors")):
            raise HTTPException(400, "filename must be a .safetensors file in the repository")
        return downloads.start(body.repo_id, body.filename).describe()

    @app.get("/api/models/downloads")
    def list_downloads():
        return {"downloads": [item.describe() for item in downloads.items.values()]}

    return app
