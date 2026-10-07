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
  TAGS_KEY,
  writePngText,
  type PngChunk,
} from './png'
export {
  formatA1111Parameters,
  loraName,
  lorasInPrompt,
  metaFromText,
  parseA1111Parameters,
  parseComfyPrompt,
  parseLatentryRecord,
  parseTags,
  type ImageMeta,
  type ImageTag,
  type LatentryRecord,
} from './meta'
