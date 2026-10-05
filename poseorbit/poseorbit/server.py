"""poseorbit on its own, over HTTP (needs the `server` extra):

    python -m poseorbit serve --port 7870 [--weights-dir ./weights]

    GET  /api/health    { status, version, styles, limits }
    POST /api/pose      see api.py

Detection runs on the CPU. Bound to 127.0.0.1 unless told otherwise; an
optional POSEORBIT_TOKEN is checked as a Bearer token.
"""

from __future__ import annotations

import os
from pathlib import Path

from . import MAX_PITCH, MAX_YAW, STYLES, Detector, NoPersonError, __version__
from .api import BadRequest, handle


def create_app(weights_dir: Path | None = None):
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.concurrency import run_in_threadpool
    from fastapi.responses import JSONResponse

    app = FastAPI(title="poseorbit", version=__version__)
    detector = Detector(weights_dir)
    token = os.environ.get("POSEORBIT_TOKEN") or None

    @app.middleware("http")
    async def check_token(request: Request, call_next):
        if token and request.url.path != "/api/health" and request.headers.get("authorization") != f"Bearer {token}":
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        return await call_next(request)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": __version__, "styles": list(STYLES), "limits": {"yaw": MAX_YAW, "pitch": MAX_PITCH}}

    @app.post("/api/pose")
    async def pose(request: Request):
        try:
            body = await request.json()
        except Exception as error:  # noqa: BLE001
            raise HTTPException(400, "Invalid JSON body") from error
        if not isinstance(body, dict):
            raise HTTPException(400, "Invalid JSON body")
        try:
            return await run_in_threadpool(handle, detector, body)
        except (BadRequest, NoPersonError, ValueError) as error:
            raise HTTPException(400, str(error)) from error

    return app
