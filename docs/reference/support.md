# Support

This page says which computers, browsers and versions Latentry is made and
checked for, and which releases get fixes.

**Supported** means it is checked before a release, and a problem there is
treated as a bug. **Experimental** means it should work, but nobody checks
it on a real machine before a release. Reports are welcome, and fixes come
where they can.

## Releases

Only the latest release gets fixes, security fixes included (see
[SECURITY.md](https://github.com/33rd-kk/latentry/blob/main/SECURITY.md)).
To get one, update to the latest release.
[Compatibility](compatibility.md) says what an update may change.

## Computers

| System | Status | Notes |
|---|---|---|
| Windows 11, x64 | Supported | CI on every pull request |
| Linux, x64 | Supported | CI on every pull request (Ubuntu) |
| macOS 14 or newer, Apple Silicon | Experimental | CI after each merge to main and once a week; not checked on a real Mac |
| Windows 10, x64 | Not checked | Microsoft no longer updates it, so it is not a safe home for a server |
| Anything else (Arm on Windows or Linux, Intel Macs, older macOS) | Not supported | The engine has no pinned install there; see below |

Latentry itself, the web UI and the gallery, needs only Node.js. On a
computer the engine does not support, you can still use Latentry with
[backends](backends.md) you run yourself.

## Node.js

Latentry needs **Node.js 22.19 or newer**. CI tests the 22, 24 and 26
release lines on Linux, and 22 on Windows.

- Use a release line the Node.js project still maintains. When a line
  reaches its end of life, a later Latentry release may stop supporting it.
  The changelog says so first.
- Keep Node.js up to date within your line. Some Node.js updates fix
  certificate trust and security problems that Latentry depends on. The
  changelog points out the ones that matter.

## GPUs for the built-in engine

The engine is installed from [Setup](../guide/engine.md), with a PyTorch
build chosen for your GPU and driver. Its Python packages are pinned for
each of the supported systems above.

| GPU | Status | Notes |
|---|---|---|
| NVIDIA, driver 580 or newer | Supported | Gets current PyTorch (CUDA 13.0) |
| NVIDIA, driver 560–579 | Supported | Current PyTorch for CUDA 12.6 |
| NVIDIA RTX 50 series, driver 570–579 | Works, not recommended | CUDA 12.8, which only an older PyTorch with known vulnerabilities supports. Setup asks for a driver update |
| NVIDIA, driver older than 560 | Works, not recommended | CUDA 11.8, the same. Setup asks for a driver update |
| NVIDIA RTX 50 series, driver older than 570 | Not supported | Setup asks for a driver update first |
| Apple Silicon (Metal) | Experimental | As for macOS above |
| AMD or Intel GPUs | Not supported | The engine runs on the CPU there. Use a backend that supports the GPU instead |
| No GPU | Works, slowly | The CPU build of PyTorch |

How much the engine draws at once depends on free video memory; see
[Setup and the engine](../guide/engine.md).

Where Latentry has no pinned install (a system above marked not
supported, or a GPU newer than the pinned PyTorch knows), the engine is
installed with the newest packages instead, and Setup says so.

## Browsers

| Browser | Status |
|---|---|
| Chrome and Edge on a computer | Supported. The browser tests run on Chromium |
| Chrome on Android | Supported, for paired phones |
| Safari (Mac, iPhone, iPad) and Firefox | Experimental |

Use an up-to-date browser.

## Backends

[Backends](backends.md) lists what Latentry can do with each kind. Where a
page names a version that was checked, such as Forge Neo 2.30, newer
versions are expected to work too. A backend's own bugs are its project's
to fix, but tell us if Latentry could work around one.
