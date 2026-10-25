# LIGSP conformance

Latentry is the reference implementation of the
[Local Image Generation Security Profile (LIGSP)](https://github.com/33rd-kk/local-image-gen-security).
The profile says what a local image-generation setup must do to be secure by
default. This page is Latentry's conformance table, as the profile asks of
a tool that claims it.

**Claim:** Latentry 0.8.1 and later conforms to **LIGSP 0.1, level 2** (use
from devices on your local network) in its default configuration. It meets
every MUST at levels 1 and 2. The SHOULDs it meets only in part are marked
below.

## Check your own setup

The profile's checker, `ligsp`, checks what you run against the same
requirements. It only reads, and only where you point it:

```bash
uvx local-image-gen-security check http://127.0.0.1:3000 --private .
```

Add your backends' URLs (for example `http://127.0.0.1:8188` for ComfyUI)
and `--models models` to check them as well. It tries no address or port
that you did not name. `--redact` makes a report you can share.

## The table

"Met" means met in the default configuration. Where a setting can lower
the protection, that is said too.

### Network exposure

| ID | Level | State | How |
|---|---|---|---|
| NET-1 | 1 | Met | Listens on 127.0.0.1 unless `LATENTRY_HOST` is set. The engine listens on 127.0.0.1 only. |
| NET-2 | 2 | Met | A device other than this computer gets only the pairing page, and every `/api` call is refused, until it is paired. Settings and Setup stay with this computer and owner devices, paired with a code only a terminal on this computer can make. `LATENTRY_PAIRING=off` is meant only for use behind an authenticating reverse proxy. |
| NET-3 | 1 | Met | Settings warns when a ComfyUI or AUTOMATIC1111 / Forge backend is at another computer's address without a token. |
| NET-4 | 2 | Met | Decisions use the address the connection comes from; `X-Forwarded-For` is believed only from a proxy on this computer. |
| NET-5 | 1 | Met | Connects only to the backends you set and to the fixed download sources on Setup. No telemetry (DATA-1). |

### Browser-facing HTTP

| ID | Level | State | How |
|---|---|---|---|
| WEB-1 | 1 | Met | `/api` refuses requests from other sites (`Sec-Fetch-Site`, `Origin`), and request bodies that are not JSON. |
| WEB-2 | 1 | Met | `/api` answers only for `localhost`, IP addresses on your network, and hosts in `ALLOWED_HOSTS`. |
| WEB-3 | 1 | Met | `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, a `Permissions-Policy`, and `no-store` on pages and `/api`. |
| WEB-4 | 2 | Met | A body limit (48 MB with a picture, 1 MB without), request budgets per device, and limits on pose previews and tagging. |
| WEB-5 | 2 | Met | Run ids are random UUIDs. Paired devices share ordinary runs, as the profile allows; a secret run's id stays with the page that started it. |

### Devices

| ID | Level | State | How |
|---|---|---|---|
| AUTH-1 | 2 | Met | The pairing code is shown only on this computer, works once and lasts 10 minutes. |
| AUTH-2 | 2 | Met | A signed, HttpOnly, SameSite=Strict cookie for 30 days. Remove one device, or forget them all, on Settings. |
| AUTH-3 | 2 | Met | Settings and Setup work only from this computer (unless `SETTINGS_EDIT` allows more). |
| AUTH-4 | 2 | Met | Paired devices see folder display names or made-up names, model file names only, and `<path>` in errors. LoRA and workflow names only when you allow it. |
| AUTH-5 | 2 | Met | The pairing key and the device list are written with mode 600. On Windows, they get an access list with only your account and Windows itself. The key can come from the system keychain instead. |

### Hub and backends

| ID | Level | State | How |
|---|---|---|---|
| BE-1 | 1 | Met | A backend's token is sent only to that backend's server, and no backend redirect is followed. Tokens never reach the browser. |
| BE-2 | 1 | Met | The built-in engine listens on 127.0.0.1 and needs a random token that only Latentry holds. |
| BE-3 | 1 | Met | ComfyUI workflows come only from the folder you set; the browser names one, and cannot send its own. Workflows saved in pictures are never run. |
| BE-4 | 1 | Met | Uploads to ComfyUI use one fixed name per backend. A secret run blanks them and deletes the run from ComfyUI's history. |

### Model files

| ID | Level | State | How |
|---|---|---|---|
| MOD-1 | 1 | Met | The engine reads weights only from `.safetensors`. A model folder whose weights come only in a pickle format is refused. |
| MOD-2 | 1 | Met | Downloads come from a fixed commit, and each file is checked against its SHA-256 before it is used. |
| MOD-3 | 1 | Partly met | Loads read from disk. The config files a single-file SDXL checkpoint needs are fetched once from a fixed commit and checked. An SDXL inpainting checkpoint still lets diffusers fetch its configs from the Hub on its first load. |
| MOD-4 | 1 | Met | Models are listed from their safetensors headers only. |

### Extensions

| ID | Level | State | How |
|---|---|---|---|
| EXT-1 | 1 | Met | Latentry installs no extensions or custom nodes for a backend. |
| EXT-2 | 1 | Not applicable | Latentry has no plugin system. |

### Latentry's own supply chain

| ID | Level | State | How |
|---|---|---|---|
| SUP-1 | 1 | Met | `npm ci` from `package-lock.json`; the engine's Python packages from a lock with the SHA-256 of every file. |
| SUP-2 | 1 | Partly met | Each release's source is built by a workflow and attested ([checking a download](../getting-started.md#from-a-release-download-checked)), and nothing is piped into a shell. There are no prebuilt downloads yet. |
| SUP-3 | 1 | Met | Weekly `npm audit` and `pip-audit`, CodeQL, and Dependabot. |
| SUP-4 | 1 | Met | [SECURITY.md](https://github.com/33rd-kk/latentry/blob/main/SECURITY.md) and GitHub's private reporting. |

### Data and pictures

| ID | Level | State | How |
|---|---|---|---|
| DATA-1 | 1 | Met | No telemetry. Next.js's and Hugging Face's usage reports are turned off. |
| DATA-2 | 1 | Met | See [Privacy](../guide/privacy.md): prompts and pictures go only to the backends you set. |
| DATA-3 | 1 | Met | The browser keeps only the form and saved characters, and nothing in [secret mode](../guide/secret-mode.md). Logs carry no prompts. A secret run saves nothing. |
| DATA-4 | 1 | Met | The settings file and the keys are owner-only (mode 600, or an owner-only access list on Windows). |
| META-1 | 1 | Met | Saved pictures carry model and LoRA file names, never paths. A ComfyUI graph is removed. A secret run saves no picture. |
| META-2 | 1 | Met | Other tools' pictures are read from their headers: their generation text only, no location, and no camera make or model. |

### Telling you

| ID | Level | State | How |
|---|---|---|---|
| OPS-1 | 1 | Met | [What Latentry protects against](../guide/threat-model.md) goes through the profile's threats one by one. |
| OPS-2 | 1 | Met | Settings says whether Latentry is open to your network, warns when pairing is off, and warns about backends open to the network. |
| OPS-3 | 1 | Met | Settings shows the version of Latentry it runs, to this computer only. Latentry publishes its security advisories on [GitHub](https://github.com/33rd-kk/latentry/security/advisories), each with the version that fixes it, and the [changelog](../changelog.md) names every release. |
