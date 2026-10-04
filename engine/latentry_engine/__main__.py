"""python -m latentry_engine --port 7861 --models-dir ./models [--model id]"""

from __future__ import annotations

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(prog="latentry_engine", description="Latentry's generation engine")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7861)
    parser.add_argument("--models-dir", type=Path, default=Path("models"))
    parser.add_argument("--model", default=None, help="model id (a name in the models folder) to load at start")
    args = parser.parse_args()

    import uvicorn

    from .server import create_app

    app = create_app(args.models_dir.resolve(), args.model)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
