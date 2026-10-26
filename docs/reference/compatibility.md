# Compatibility

This page says which parts of Latentry you can rely on from one release to
the next, and how a change to them is announced.

## Versions

Latentry uses `major.minor.patch` version numbers.

- **From 1.0 on**, only a new major version (2.0) may break what is listed
  under [What stays compatible](#what-stays-compatible). A minor version
  (1.1) adds things, and a patch (1.0.1) fixes them.
- **Before 1.0**, a minor version (0.12 → 0.13) may still break these
  things. Each release that does says so in the [changelog](../changelog.md),
  under **Upgrading from …**.

To remove or rename something on the list, a minor version first marks it
**Deprecated** in the changelog and keeps it working. It is removed in the
next major version at the earliest.

**Security fixes come first.** If keeping something working would leave a
hole open, a minor or patch release may change it. The changelog then says
what changed and what to do.

## What stays compatible

### Pictures in the gallery

The `latentry` record that Latentry writes into each PNG, and the
`parameters` text next to it, are described in
[Backend API → What Latentry writes into PNGs](../backend-api.md#what-latentry-writes-into-pngs).

- The record carries a `schema` number. It is `1` today.
- A later Latentry reads every picture an earlier one saved.
- A new field may be added without changing `schema`. `schema` goes up only
  when an existing field changes meaning.
- An earlier Latentry still reads a picture with a higher `schema`. It shows
  the fields it knows and ignores the rest.

### The settings file

`latentry.settings.json`, written by the [Settings](../guide/settings.md)
page, carries a `version` number. It is `1` today.

- A later Latentry reads a settings file written by an earlier one.
- An earlier Latentry reads a file with a higher `version` for the parts it
  knows. It does **not** save over that file, because saving would drop the
  parts it does not know. The Settings page says so instead.
- A part that cannot be read is skipped with a warning. The rest of the file
  still applies.

`latentry.models.json`, the [model info](../guide/generate.md#model-info)
kept next to the settings file, carries its own `version`, `1` today, and
follows the same rules. An entry that cannot be read is skipped.

The tests of every release read a picture and a settings file saved by each
release since 0.5.0, so a change that breaks an old one fails before it
ships.

### Environment variables

Every variable on the [Configuration](configuration.md) page, in
`.env.example` or in the guide keeps its name and meaning. That includes
the ones without the `LATENTRY_` prefix, such as `GALLERY_SAVE_DIR` or
`GEN_BACKENDS`.

A variable that appears only in the code is internal. It may change in any
release.

### The backend API

[Backend API](../backend-api.md) is **version 1**. It describes:

- what Latentry expects of a diffusers-compatible server;
- what it needs from AUTOMATIC1111 / Forge and ComfyUI;
- what it writes into PNGs.

A server that works with one 1.x release keeps working with later 1.x
releases. Something new that Latentry asks of a server is optional, and
Latentry works without it.

### Page addresses

The pages `/`, `/gallery`, `/settings`, `/setup` and `/pair` keep their
addresses, so bookmarks keep working.

## What is not covered

These may change in any release:

- **The `/api` routes that the pages call.** They exist for Latentry's own
  pages. That includes everything a paired device calls: it is kept free to
  change so a security fix never waits for a major version.
- How the pages look and where things sit on them.
- Query parameters in page addresses, and what the browser keeps for a tab
  (such as the chosen language).
- Files Latentry keeps for itself next to the settings file or under
  `LATENTRY_RUNTIME_DIR`, such as keys, caches and the installed engine.
- Which backends, models and engine features are supported. Supported
  backends are listed in [Backends](backends.md), and the changelog
  announces a removal.
