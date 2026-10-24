# Contributing to Latentry

Thank you for helping. This page says how to report a problem, how to set
up a checkout, and what a pull request needs.

## Reporting

- **A security problem**: report it privately, as
  [SECURITY.md](SECURITY.md) says. Please do not open a public issue.
- **A bug or an idea**: open an issue with the matching form.

Before you post an issue, a log or a screenshot, take out what is private
to you: folder paths, user names, host names, ports, tokens, and pictures
you would not show anyone. A short made-up example is just as useful.

For a larger change, open an issue first, so the approach can be agreed on
before you spend time on it.

## Setting up

You need Node.js 22.19 or newer and Git.

```bash
git clone https://github.com/33rd-kk/latentry.git
cd latentry
npm ci
npm run dev
```

Open http://localhost:3000. The built-in engine is optional: install it
from the Setup page, or point Latentry at a server you already run (see the
[README](README.md#using-servers-you-already-run)).

## Checks

Run these before you open a pull request. CI runs them too, on Ubuntu and
Windows.

```bash
npm run typecheck
npm run lint
npm test               # the verify scripts in __tests__/
npm run i18n:check     # after changing UI text
npm run test:e2e       # browser tests against mock backends (see the README)
```

- **The engine** (`engine/`): `ruff check engine`, then `python -m pytest
  tests` from `engine/` with the engine's Python
  ([engine/README.md](engine/README.md#tests)).
- **The manual** (`docs/`): `mkdocs build --strict`, with the tools from
  `docs/requirements.txt` installed in a virtual environment.

The tests use temp folders and mock servers, and remove them afterwards.
They never touch your own settings, backends or pictures.

## What a change needs

**Privacy and security come first.** Latentry keeps everything on the
user's computer unless they choose otherwise. A change should keep it that
way:

- no telemetry, and no network calls the user did not set up;
- new options off, local-only and opt-in by default;
- nothing extra left behind in browser storage, caches, logs or temp files;
- no paths, folder names or ports shown to paired devices.

The manual's
[What it protects against](https://33rd-kk.github.io/latentry/guide/threat-model/)
explains the reasons.

**Compatibility.** The
[Compatibility](https://33rd-kk.github.io/latentry/reference/compatibility/)
page lists what must keep working between releases: the settings file, the
record in saved pictures, documented environment variables, the backend API
and page addresses. `__tests__/upgrade.verify.ts` reads files saved by
earlier releases. Never remake its fixtures to make it pass.

**Code.**

- Match the code around your change: its naming, comment style and size of
  functions.
- `lib/` does not import Next.js. `lib/image-meta/` imports nothing else
  from the app, since it is meant to become its own package.
- UI text goes in `locales/en.json`; other languages are generated from it.
- Add or change a verify script in `__tests__/` for what you change.

**Docs and changelog.**

- If the change shows in the app, update the manual page that describes it.
- Add a line under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md) for
  anything a user would notice. The manual includes the changelog, so
  write links in it as full `https://` addresses.

## Pull requests

- **Title**: what changes for the user, in plain words, such as "Keep the
  button on Add to queue between queued runs". No `feat:`-style prefix.
- **Summary**: start with **Before.** (what was wrong, in a sentence or
  two), then **Now:** and a list of what changes.
- **Test plan**: a checklist of what you ran and what you saw. Leave a box
  unticked for anything not done yet.

The [pull request template](.github/pull_request_template.md) has this
layout. Keep local details out of the description: no paths, ports or
names of your own servers. One topic per pull request makes review quicker.

## License

Latentry is [MIT](LICENSE). By contributing, you agree that your
contribution is released under the same license.
