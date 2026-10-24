# Upgrade fixtures

One folder per released version, each holding what that release wrote:

- `settings.json`: the settings file its Settings page saved for a full edit;
- `picture.png`: an 8x8 picture with the `parameters`, `latentry` and
  `latentry:tags` chunks its gallery wrote.

`__tests__/upgrade.verify.ts` reads them with today's code
([Compatibility](../../../docs/reference/compatibility.md) promises that this
keeps working).

Each fixture was made by **that release's own code**, from its Git tag, with
`node scripts/upgrade-fixture.mjs <version>`. The values are made up: no real
paths, pictures or tokens.

- **Never make an existing fixture again.** New code would write it the new
  way and hide the break it is there to catch. The script keeps a folder
  that is already there.
- **After each release**, add its fixture in the next PR. If the release
  added a field to the `latentry` record, add it to `RECORD_FIELDS` in the
  script first.

Since 0.7.0 the record has a `workflow` field (the ComfyUI workflow's file
name). No release reads it back, so the test does not check it.
