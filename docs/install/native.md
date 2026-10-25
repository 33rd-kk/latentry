# Install from source

[Getting started](../getting-started.md) has the short version. This page
adds what you may need besides it.

## What you need

- **Node.js 22.19 or newer** ([nodejs.org](https://nodejs.org); on Windows
  also `winget install OpenJS.NodeJS.LTS`).
- For the built-in engine: an **NVIDIA GPU** is best (Apple silicon and the
  CPU work too, slowly), and about 4 GB of disk for the engine plus 5–7 GB
  per model.
- Or a backend you already run: a server speaking the
  [backend API](../backend-api.md), or AUTOMATIC1111 / Forge started with
  `--api`.

[Support](../reference/support.md) lists the systems, GPUs and browsers that
are checked.

## Install

```bash
git clone https://github.com/33rd-kk/latentry.git
cd latentry
./install.sh                                          # Linux, macOS
powershell -ExecutionPolicy Bypass -File install.ps1  # Windows
```

The script checks Node.js, installs and builds the web UI, and starts it. When
it says **Ready**, open **<http://localhost:3000/setup>** in your browser.

Later, start Latentry again from the same folder with:

```bash
npm start
```

Ctrl+C stops it. Latentry listens on this computer only; to use it from a
phone, see [Other devices and security](../guide/network.md).

## From a release download, checked

Instead of `git clone`, you can download a release's source from its
[release page](https://github.com/33rd-kk/latentry/releases)
(`latentry-X.Y.Z.tar.gz` or `.zip`) and check that it was made by
Latentry's release workflow from that release's commit, before you run
anything in it:

```bash
gh attestation verify latentry-X.Y.Z.tar.gz --repo 33rd-kk/latentry --source-ref refs/tags/vX.Y.Z
```

`--source-ref` makes it check that the file was built from the tag of that
release (from 0.8.1 on). 0.8.0's files were added later, from `main`, so
check those without it.

This needs the [GitHub CLI](https://cli.github.com/). Without it, compare
the file's SHA-256 with `SHA256SUMS` on the same page
(`sha256sum -c SHA256SUMS --ignore-missing` on Linux, `shasum -a 256` on
macOS, `Get-FileHash` in PowerShell); that shows the file is the one listed
there, and the attestation shows who made it. Then unpack it and run the
install script inside, as above. Git is still needed, for one of the
packages.

## Only the servers you already run

To use only backends you already run, install with `./install.sh --no-engine`
(Windows: `install.ps1 -NoEngine`): the engine does not start with
Latentry, and the script points you to [Settings](../guide/settings.md),
where you add them. You can also list them in `.env.local`; see
[Backends](../reference/backends.md).
