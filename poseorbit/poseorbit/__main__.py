"""python -m poseorbit serve [--host 127.0.0.1] [--port 7870] [--weights-dir DIR]
python -m poseorbit draw PICTURE OUT.png [--size 832x1216] [--person N] [--yaw D] [--pitch D] [--style S]"""

from __future__ import annotations

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(prog="poseorbit")
    commands = parser.add_subparsers(dest="command", required=True)

    serve = commands.add_parser("serve", help="answer /api/pose over HTTP")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=7870)
    serve.add_argument("--weights-dir", type=Path, default=None)

    draw = commands.add_parser("draw", help="draw one picture's skeleton to a PNG")
    draw.add_argument("picture", type=Path)
    draw.add_argument("out", type=Path)
    draw.add_argument("--size", default=None, help="WIDTHxHEIGHT (default: the picture's)")
    draw.add_argument("--person", type=int, default=None, help="index, or -1 for everyone")
    draw.add_argument("--yaw", type=float, default=0.0)
    draw.add_argument("--pitch", type=float, default=0.0)
    draw.add_argument("--style", default="dwpose", choices=["dwpose", "openpose"])
    draw.add_argument("--weights-dir", type=Path, default=None)

    args = parser.parse_args()
    if args.command == "serve":
        import uvicorn

        from .server import create_app

        uvicorn.run(create_app(args.weights_dir), host=args.host, port=args.port, log_level="warning")
        return

    from PIL import Image

    from . import Camera, Detector, pose

    picture = Image.open(args.picture)
    size = tuple(int(part) for part in args.size.lower().split("x")) if args.size else picture.size
    result = pose(Detector(args.weights_dir), picture, size, args.person, Camera(args.yaw, args.pitch), args.style)
    result.skeleton.save(args.out)
    print(f"{len(result.people)} found; drew person {result.person} at yaw {result.camera.yaw}, pitch {result.camera.pitch}")


if __name__ == "__main__":
    main()
