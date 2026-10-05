# Configuration

Latentry reads `.env.local` in its folder (the install script copies it from
`.env.example`). The [Settings](../guide/settings.md) page can set backends,
gallery folders, the tagger and profile defaults too; what it saves
(`latentry.settings.json`) takes precedence, and anything it leaves alone
falls back to `.env.local`. Restart Latentry after editing `.env.local`.

| Variable | Default | What it does |
|---|---|---|
| `GEN_BACKENDS` | — | Backends: `id\|kind\|url\|profile`, separated by `;` |
| `GEN_TOKEN_<ID>` | — | A backend's token, by its id in upper case |
| `GALLERY_SAVE_DIR` | `./output` | Where finished pictures are saved; unset: not saved |
| `GALLERY_DIRS` | — | Other folders to browse read-only, separated by `;` |
| `GALLERY_AUTO_TAG` | off | `1`: tag each saved picture with WD14 as it arrives |
| `WD14_MODEL_DIR` | — | Folder of the built-in WD14 tagger (`model.onnx`, `selected_tags.csv`) |
| `WD14_THRESHOLD`, `WD14_CHARACTER_THRESHOLD` | `0.35`, `0.85` | How sure a tag must be |
| `TAGGER_BACKEND` | automatic | `builtin`, or a backend id |
| `A1111_TAGGER_MODEL` | first "wd" model | The A1111 tagger extension's model |
| `LATENTRY_HOST` | `127.0.0.1` | `0.0.0.0` to use Latentry from other devices |
| `SETTINGS_EDIT` | `local` | Who may change settings: `local`, `lan` or `off` |
| `LATENTRY_SETTINGS_FILE` | `./latentry.settings.json` | Where the Settings page saves |
| `ALLOWED_HOSTS` | — | Extra hostnames `/api` answers for (behind a reverse proxy) |
| `REQUEST_BUDGET_*` | see below | Per-device request limits; `REQUEST_BUDGET=off` turns them off |
| `LATENTRY_ENGINE` | on | `off`: do not start the built-in engine with Latentry |
| `LATENTRY_RUNTIME_DIR` | `./.runtime` | Where the engine (uv, Python, PyTorch) is installed |
| `HF_TOKEN` | — | Only for models that need a Hugging Face login |
| `PORT` | `3000` | The install scripts' port |

The engine also reads `LATENTRY_DEVICE`, `LATENTRY_DTYPE`, `LATENTRY_OFFLOAD`,
`LATENTRY_MAX_BATCH` and `LATENTRY_VRAM_FRACTION` to override its GPU plan
(see [Setup and the engine](../guide/engine.md)).

## `.env.example`

Every variable, with its explanation:

```bash
--8<-- ".env.example"
```
