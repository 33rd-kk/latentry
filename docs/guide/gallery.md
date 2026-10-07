# Gallery

![The gallery](../assets/screenshot-gallery.webp)

Every finished picture is saved to the **save folder** with its settings
embedded in the PNG (A1111's PNG Info reads them too). Other folders, such as
ComfyUI's or a web UI's output, can be browsed **read-only**. Choose the
folders on [Settings](settings.md); with several, tabs switch between them.

Pictures load newest first as you scroll; what is on screen stays in place
while more load.

## Search

Type in **Search prompts, tags, models, file names**:

- Commas separate terms, and every term must match. A term can be several
  words.
- Quotes match one tag exactly: `"long hair"` does not match `very long hair`.
  Tags sent from the viewer are quoted.
- Underscores and spaces are the same, and case does not matter.
- Unquoted terms also match the model and the file name.

**Show search tips** under the box repeats this. Filter by **backend** or
**profile** with the two menus, and **Refresh** for pictures that arrived
from elsewhere.

## Tags

- **Tags** shows each picture's tags under its card: its prompt, or the WD14
  tags read from it. Click a tag to search for it.
- **Select** picks pictures (or **Select all**, **Select untagged**) and **Tag
  … with WD14** reads tags for all of them, skipping pictures that already
  have tags if you like. In the save folder the tags are written into the
  files; read-only folders show them without writing.
- Settings can tag every new picture as it is saved.

Tagging needs a tagger; see [Settings](settings.md).

## The viewer

![The viewer's side panel](../assets/screenshot-viewer.webp)

Click a picture to open it. Arrows or the keyboard move between pictures; the
magnifier zooms; the download button saves it. The side panel shows the
backend, model, mode, seed, size, steps, CFG, sampler and strength it was made
with, its prompt and negative prompt as tags, and its WD14 tags. In
[secret mode](secret-mode.md) thumbnails are blurred and the panel hides all
of that until you choose **Show for this picture**.

From the panel:

- **Generate with these settings**: the prompts and seed go to the form (and,
  on the same backend, size, steps, CFG and sampler). Tags already in the form
  are replaced.
- **Use as source**: the picture becomes the form's source image; prompts and
  settings stay.
- **Use as pose reference**: its pose carries over to the
  [skeleton pose](pose.md), not its hair or outfit.
- **Analyze with WD14**: read its tags now (saved into the file in a writable
  folder).
- Each tag: copy it, search for it, or add it to the positive or negative
  prompt. Each section: **Copy all**, **All to positive**, **All to
  negative** (tags already in the prompt are skipped).
