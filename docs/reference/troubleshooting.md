# Troubleshooting

## Install and start

**"Node.js is not installed" / "is too old".** Install Node.js 22.19 or newer
from [nodejs.org](https://nodejs.org), open a new terminal, and run the
install script again.

**`./install.sh: Permission denied`.** Run it as `sh install.sh`, or
`chmod +x install.sh` first.

**Port 3000 is in use.** Start on another port: `PORT=3100 ./install.sh`, or
`npm start -- -p 3100`.

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

**"Backend is busy".** Another tab or device is generating on it; each
backend runs one job at a time. Wait, or use another backend.

**"Backend … is not answering".** Check that the server runs and its URL on
Settings (**Test**).

**A turned pose comes out from behind.** See the tips in
[Pose and the 3D view](../guide/pose.md).

## Using it from another device

**The page does not open on the phone.** Latentry listens on this computer
only unless `LATENTRY_HOST=0.0.0.0` is set; on Windows, allow Node.js through
the firewall on private networks. See
[Other devices and security](../guide/network.md).

**Settings are read-only on the phone.** That is the default: settings can
only be changed on the computer running Latentry (`SETTINGS_EDIT`).

## Still stuck

Open an issue on [GitHub](https://github.com/33rd-kk/latentry/issues), or for
anything security related, report it privately
([Security](https://github.com/33rd-kk/latentry/security/advisories/new)).
