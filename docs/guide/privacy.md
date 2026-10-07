# Privacy

Latentry runs on your own computer, and is built to send nothing anywhere
you did not choose and to leave as little behind as it can. This page says
what goes over the network, and what is kept where, so you can check it
against what you expect.

## What goes over the network

- **To your backends**, the ones you set up: prompts, settings and source
  pictures for each run, and the backend's token if it has one. A token is
  only ever sent to the server it was set up for.
- **Downloads you start**: installing and building Latentry (npm packages,
  and the UI's font, which the build fetches once and then serves itself),
  and, from the Setup page, the engine (uv, Python, PyTorch, diffusers), the
  models you pick and the WD14 tagger.
- **Nothing else.** No telemetry, no update checks, no analytics. The
  anonymous usage reports of Next.js and Hugging Face are turned off.

The browser only talks to Latentry itself. Latentry listens on 127.0.0.1
unless you set `LATENTRY_HOST`; see
[Other devices and security](network.md) before opening it to a network.

## What is kept, and where

| Where | What | When it goes |
|---|---|---|
| The gallery's save folder | Every finished picture, with its prompt and settings inside the file; WD14 tags, when you tag a picture there | When you delete the files |
| `.env.local`, `latentry.settings.json` | Backends, folders and options, and backend tokens (in the settings file when typed on Settings) | When you change or delete them |
| `.runtime/`, `models/` | The engine, the models and the tagger you downloaded | When you delete them, or uninstall |
| This browser (localStorage) | The generate form, the prompt shared across backends, saved characters, the chosen backend, and display preferences such as tags under cards | Kept between visits. Clear the site's data to remove it |
| Latentry's memory | Runs in progress, thumbnails, and the gallery's index of a folder (date made, size, model, LoRAs, a hash of each prompt, the seed) | When Latentry stops |

Not kept anywhere: the gallery's search, order and filters (they last only
as long as the page), and pictures from other folders, which are only read.

## Secret mode

[Secret mode](secret-mode.md) keeps what you type out of the browser's
storage, blurs the gallery and hides prompts and settings until you choose
to show them. Pictures are still saved to the gallery folder.

## What Latentry does not do to your files

It writes only into its own save folder: new pictures, and tags you ask for.
Folders of other tools are read-only. It never deletes, moves or renames a
picture. To do that, **Show in folder** opens the picture in your file
manager (only from the computer Latentry runs on).

## Reading other tools' pictures

From a picture's metadata the gallery reads only what holds generation
settings: PNG text, and in JPEG and WebP a few EXIF fields (UserComment,
ImageDescription, Make, Model). It never reads location, camera details or
embedded thumbnails.
