# Troubleshooting

## Install and start (without Docker)

**"Node.js is not installed" / "is too old".** Install Node.js 22.19 or newer
from [nodejs.org](https://nodejs.org), open a new terminal, and run the
install script again.

**`./install.sh: Permission denied`.** Run it as `sh install.sh`, or
`chmod +x install.sh` first.

**Port 3000 is in use.** Start on another port: `PORT=3100 ./install.sh`, or
`npm start -- -p 3100`.

## Docker

**`docker compose exec latentry npm run owner-code` says Latentry does not
answer.** It is still starting: `docker compose ps` says **healthy** once it
is ready. Run the command again then.

**owner-code says Latentry refused.** The command must run in the Latentry
container, as its own user (the default for `docker compose exec`). If the
log says `latentry-local-token is not this user's file`, something else
took that file's place: restart the container (`docker compose restart`).

**Setup finds no GPU.** Start with both files,
`docker compose -f compose.yaml -f compose.gpu.yaml up -d`. On Linux, the
NVIDIA Container Toolkit must be installed; on Windows, Docker Desktop must
use the WSL 2 backend. `docker compose exec latentry nvidia-smi` should list
the GPU.

**A backend on this computer is offline.** From the container it is
`http://host.docker.internal:<port>`, not `localhost`. On Linux, the server
must listen on the Docker bridge; see
[Backends on this computer](../install/docker.md#backends-on-this-computer).

**Settings are read-only in my browser.** Your owner device lasts 7 days.
Run `docker compose exec latentry npm run owner-code` and pair again.

## The engine

**The engine does not start after updating Latentry.** Open
[Setup](../guide/engine.md) and press **Repair / update**: the engine's
Python packages follow Latentry's version.

**"Stopped after repeated crashes".** Open its **Log** on the Setup page. A
common cause is another program holding the GPU's memory: the engine plans
from the memory that is free when it starts, so close the other program and
press **Start**.

**"The GPU ran out of memory".** Use a smaller size or fewer images. The
engine already halves its batch and retries; with an SDXL pose run, the
ControlNet needs about 2.5 GB more.

**A model does not show up.** The models folder lists single `.safetensors`
files and diffusers folders directly inside it; files in subfolders are not
listed. Point the models folder at the right place on Setup.

## Generating

**"Backend is busy" or "runs are already waiting".** Each backend runs one
job at a time, and up to 8 more wait in its
[queue](../guide/many.md#the-queue). Wait for one to start, take one of
yours out, or use another backend.

**"Backend … is not answering".** Check that the server runs and its URL on
Settings (**Test**).

**A turned pose comes out from behind.** See the tips in
[Pose and the 3D view](../guide/pose.md).

## Using it from another device

**The page does not open on the phone.** Latentry listens on this computer
only by default. In Docker, publish it on your network in `compose.yaml`
(see [Other devices](../install/docker.md#other-devices)); without Docker,
set `LATENTRY_HOST=0.0.0.0`, and on Windows allow Node.js through the
firewall on private networks. See
[Other devices and security](../guide/network.md).

**Settings are read-only on the phone.** That is the default: only this
computer and [owner devices](../guide/owner-device.md) can change them.

## Still stuck

Open an issue on [GitHub](https://github.com/33rd-kk/latentry/issues), or for
anything security related, report it privately
([Security](https://github.com/33rd-kk/latentry/security/advisories/new)).
