# image-meta

Reads the settings an AI picture was made with: prompt, negative prompt,
seed, steps, CFG, sampler, model, LoRAs. It also writes them into PNG text
chunks. It is part of Latentry for now, kept separate so it can become its
own package.

- **Formats**: PNG text chunks (`tEXt`, `zTXt`, `iTXt`), and EXIF in JPEG
  (APP1) and WebP (`EXIF` chunk).
- **Tools**: AUTOMATIC1111 / Forge infotext (`parameters`, or EXIF
  UserComment), ComfyUI's graphs (`prompt`, or else `workflow`), Latentry's
  own record (`latentry`) and WD14 tags (`latentry:tags`).
- **ComfyUI**: from the executed graph (`prompt`), the sampler that starts
  from an empty latent (so a hires or refiner pass is not taken for the
  base), with KSampler, KSamplerAdvanced and SamplerCustom(Advanced) and
  their noise, guider, sampler and sigmas nodes. Numbers given by a link to
  a seed or primitive node are followed. The model comes from any checkpoint
  or UNET loader. From the editor's graph (`workflow`), used only when there
  is no `prompt`, the stock nodes whose widget order is known. Model names
  are file names only (`modelFileName`): the folders under ComfyUI's models
  folder are someone's own.
- **Without loading the image**: it reads chunk and segment headers, and
  skips the pixel data by its length. A large picture costs a few small
  reads.
- **Only what it needs**: from EXIF it reads the fields that carry settings
  (UserComment, ImageDescription, Make, Model). It never reads GPS, maker
  notes or thumbnails. Photos from a camera can carry where they were
  taken, and there is no reason to look.
- **No dependencies**: only node's built-ins (`node:fs`, `node:zlib`).

```ts
import { readImageInfo, metaFromText } from './lib/image-meta'

const info = await readImageInfo('picture.webp')
// { format: 'webp', width: 832, height: 1216, text: { parameters: '…' } }
const meta = info && metaFromText(info.text)
// { source: 'a1111', prompt: '…', seed: 1234, loras: ['detail'], … }
```

## Rules for this folder

- Import only `node:` built-ins and files in this folder. eslint enforces
  this (`eslint.config.mjs`).
- Every file starts with `// SPDX-License-Identifier: MIT`.
- Tests live in `__tests__/image-meta.verify.ts`.
