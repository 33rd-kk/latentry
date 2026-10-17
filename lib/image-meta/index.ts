// SPDX-License-Identifier: MIT
//
// lib/image-meta: generation settings in AI pictures, read from PNG, JPEG
// and WebP without loading the image, and written into PNG text chunks.
// Kept free of the app (see README.md) so it can become its own package.

export { readImageInfo, readImageInfoFrom, type ImageFormat, type ImageInfo } from './read'
export { decodeUserComment, readExifText, tiffOf, type ExifText } from './exif'
export {
  decodeTextChunk,
  encodeTextChunk,
  isPng,
  LATENTRY_KEY,
  PARAMETERS_KEY,
  PNG_SIGNATURE,
  pngSize,
  readChunks,
  readPngText,
  removePngText,
  TAGS_KEY,
  writePngText,
  type PngChunk,
} from './png'
export {
  comfyGraphRoles,
  COMFY_MARKERS,
  formatA1111Parameters,
  loraCallsInPrompt,
  loraName,
  lorasInPrompt,
  metaFromText,
  modelFileName,
  parseA1111Parameters,
  parseComfyPrompt,
  parseComfyWorkflow,
  parseLatentryRecord,
  parseTags,
  type ComfyRoles,
  type ComfySlot,
  type HiresUse,
  type ImageMeta,
  type ImageTag,
  type LatentryRecord,
  type LoraUse,
} from './meta'
