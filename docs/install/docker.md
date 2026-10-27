# Docker

[Getting started](../getting-started.md) starts Latentry in Docker and
pairs your browser. This page is for living with it: updating, where the
data is, your own picture folders, backends on this computer, and other
devices.

The files are `compose.yaml` and `compose.gpu.yaml` in the Latentry folder.
Run the commands below from there. With an NVIDIA GPU, add
`-f compose.yaml -f compose.gpu.yaml` after `docker compose` wherever it
starts the container (`up`).

## Start, stop, update

```bash
docker compose up -d --build     # start (builds the image when it changed)
docker compose stop              # stop
docker compose logs -f latentry  # follow the log
```

It starts again by itself after a restart of Docker or the computer, until
you stop it.

To update, take the new version and build again:

```bash
git pull
docker compose up -d --build
```

Your settings, pictures, engine and models stay: they are in the data
volume, not in the image. [Compatibility](../reference/compatibility.md)
says what an update may change.

## Where the data is

Everything Latentry keeps is in one Docker volume, `latentry-data`, mounted
at `/data` in the container:

| In `/data` | What |
|---|---|
| `latentry.settings.json`, `latentry.pairing-*`, `latentry.folder-names-key` | Settings, the pairing key and the paired devices |
| `latentry.models.json` | Each model's link and recommended settings |
| `output/` | Your pictures (the gallery's save folder) |
| `runtime/` | The engine: uv, Python, PyTorch, its logs |
| `models/` | Models and the tagger, and `loras/` |

Nothing of it is in the image, so an image can be shared or rebuilt without
your data.

- **To copy your pictures out**:
  `docker compose cp latentry:/data/output ./latentry-pictures`
- **To back everything up**, copy the whole of `/data` the same way while
  Latentry is stopped. It holds the pairing key and your backend tokens, so
  keep the copy as private as the computer.
- **To remove Latentry and everything it kept**: `docker compose down -v`.
  The `-v` deletes the volume, pictures and models included; leave it out
  to keep them.

## If you used Latentry without Docker before

Your browser keeps some things per address, not in Latentry: what you
typed on the generate form, saved characters, the language and whether
secret mode is on. Open the Docker one at the same address
(`http://localhost:3000`) and they are there again. Settings, pictures and
paired devices are on the server, so they do not come along.

- **To start clean**, clear the site data for `localhost:3000` in your
  browser (in Chrome or Edge: the icon left of the address > Site settings >
  Delete data).
- **To bring your pictures**, mount the old `output` folder read-only and
  add it on Settings (see below), or copy them into the volume, from this
  folder:

    ```bash
    docker compose cp /path/to/old/latentry/output/. latentry:/data/output
    docker compose exec -u root latentry chown -R node:node /data/output
    ```

    The second line gives the copies to Latentry's user, so it can delete
    them from the gallery.

## Your own picture folders

To browse another tool's pictures, mount its folder read-only. In
`compose.yaml`, under `volumes:` of the service:

```yaml
      - /path/to/ComfyUI/output:/pictures/comfyui:ro
```

Start again (`docker compose up -d`), then add `/pictures/comfyui` on
**Settings > Gallery folders**. `:ro` makes Docker refuse every write, so
the folder cannot be changed from the container whatever happens in it.

On Windows, write the path as `C:/Users/you/ComfyUI/output`.

## Backends on this computer

From inside the container, `localhost` is the container itself. A server on
this computer, such as ComfyUI or an A1111 web UI, is
`http://host.docker.internal:<port>`: add it on **Settings > Backends**
with that address.

- **Docker Desktop** forwards that name to this computer, so a server that
  listens on this computer only (127.0.0.1) is reached as it is.
- **On Linux**, `host.docker.internal` is the Docker bridge's address on
  this computer (usually 172.17.0.1). The server must listen there, for
  example ComfyUI with `--listen 172.17.0.1`. Do not make it listen on every
  address (`0.0.0.0`) for this: that opens it to your whole network.

Settings warns that such a backend is reached over the network with nothing
in front of it, since Latentry cannot tell where `host.docker.internal`
leads. On Docker Desktop, or with the bridge address above, only this
computer can reach the server, and the warning can be read as a reminder.
See [Backends](../reference/backends.md).

## Other devices

`compose.yaml` publishes Latentry on this computer only
(`127.0.0.1:3000`). To use it from a phone, publish it on your network:
change the line under `ports:` to

```yaml
      - "3000:3000"
```

and start again. On the phone, open `http://<this computer's address>:3000`
and pair it with a code from **Settings > Phones and other computers > Add
a device** on your owner device. Every device has to pair, so publishing
on the network opens nothing to a device you did not pair. See
[Other devices and security](../guide/network.md), and its **HTTPS**
section to keep cookies and pictures unreadable on the network.

## Settings that are environment variables

What goes in `.env.local` without Docker goes under `environment:` of the
service in `compose.yaml` here, for example:

```yaml
    environment:
      GALLERY_AUTO_TAG: "1"
```

[Configuration](../reference/configuration.md) lists them. The image sets
these, and they should stay as they are:

| Variable | In the image | Why |
|---|---|---|
| `LATENTRY_HOST` | `0.0.0.0` | Inside the container; which addresses reach it is up to `ports:` |
| `LATENTRY_TRUST_LOOPBACK` | `off` | See below |
| `LATENTRY_SETTINGS_FILE`, `LATENTRY_RUNTIME_DIR`, `GALLERY_SAVE_DIR` | under `/data` | So everything kept is in the volume |

## Why your browser has to pair

Without Docker, a browser on the computer running Latentry is "this
computer" and needs no pairing: Latentry knows it by its address,
127.0.0.1. In a container, that address proves nothing. Some ways of
running containers (rootless Docker, Podman) hand connections from other
machines to the container as if they came from 127.0.0.1, so trusting it
there could let anyone on your network change your settings.

So the image sets `LATENTRY_TRUST_LOOPBACK=off`: no address counts as this
computer, and every browser pairs, yours with an owner code. Being able to
run `docker compose exec` on this computer is what makes an owner.
`npm run owner-code` and `npm run forget-devices` prove they run in the
container with a random token Latentry writes at start to a file only its
own user can read (`/tmp/latentry-local-token`, outside the volume). The
token admits those two actions only, never goes over the network, and is
replaced at every start.

Two things only make sense on the computer itself and are not offered in
Docker: **Show in folder** and **Open in default app** in the gallery.
