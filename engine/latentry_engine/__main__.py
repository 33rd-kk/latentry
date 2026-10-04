"""python -m latentry_engine --port 7861 --models-dir ./models [--model id]"""

from __future__ import annotations

import argparse
import os
import sys
import threading
import time
from pathlib import Path


def _alive(pid: int) -> bool:
    if sys.platform == "win32":
        # os.kill(pid, 0) would terminate the process on Windows; ask instead.
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        kernel32.CloseHandle(handle)
        return code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _exit_with(pid: int) -> None:
    """Latentry may be killed without a chance to stop the engine (Task
    Manager, a closed terminal); the engine then leaves too, freeing the GPU."""

    def watch() -> None:
        while _alive(pid):
            time.sleep(2)
        print(f"[engine] process {pid} is gone; exiting", flush=True)
        os._exit(0)

    threading.Thread(target=watch, daemon=True).start()


def main() -> None:
    parser = argparse.ArgumentParser(prog="latentry_engine", description="Latentry's generation engine")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7861)
    parser.add_argument("--models-dir", type=Path, default=Path("models"))
    parser.add_argument("--model", default=None, help="model id (a name in the models folder) to load at start")
    parser.add_argument("--parent-pid", type=int, default=None, help="exit when this process does (set by Latentry)")
    args = parser.parse_args()
    if args.parent_pid:
        _exit_with(args.parent_pid)

    import uvicorn

    from .server import create_app

    app = create_app(args.models_dir.resolve(), args.model)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
