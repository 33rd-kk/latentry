// SPDX-License-Identifier: MIT
//
// lib/image-meta: generation settings in AI pictures, read from PNG, JPEG
// and WebP without loading the image, and written into PNG text chunks.
// Kept free of the app (see README.md) so it can become its own package.

export { parametersComment, readImageInfo, readImageInfoFrom, sdcppXmpParameters, type ImageFormat, type ImageInfo } from './read'
export { exifOrientation, stripJpeg, stripMetadata, stripPng, stripWebp } from './strip'
export { stripPngBytes } from './png-strip'
export { decodeUserComment, readExifText, tiffOf, type ExifText } from './exif'
export {
  decodeTextChunk,
  encodeChunk,
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
  isSdcppParameters,
  loraCallsInPrompt,
  loraName,
  lorasInPrompt,
  metaFromText,
  modelFileName,
  parseA1111Parameters,
  parseComfyPrompt,
  parseComfyWorkflow,
  parseLatentryRecord,
  parseSdcppParameters,
  parseTags,
  type ComfyRoles,
  type ComfySlot,
  type GridAxisUse,
  type ControlUse,
  type IpAdapterUse,
  type GridUse,
  type HiresUse,
  type ImageMeta,
  type ImageTag,
  type LatentryRecord,
  type LoraUse,
} from './meta'
