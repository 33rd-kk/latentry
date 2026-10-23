// The uv release the engine install uses, and the SHA-256 of each build.
// Pinned rather than "latest", so what runs is what was checked. To move to
// another release, run `node scripts/pin-downloads.mjs uv <version>` and paste
// what it prints here.

export const UV_VERSION = '0.13.5'

export const UV_SHA256: Record<string, string> = {
  'uv-x86_64-pc-windows-msvc.zip': 'a38b8d1902b7cfbc76b423ba1bb456f623f42064cdc72628b6075b89afd1019a',
  'uv-aarch64-pc-windows-msvc.zip': '09f47edf90726084a70f9426f6e3ca4f46e9bf7cbf23b1716ec64d60b055fae3',
  'uv-x86_64-apple-darwin.tar.gz': 'b0f52b0e3945b4107d89024ea38e625683011fbfc05a0d98f9fa2d6dcee28c66',
  'uv-aarch64-apple-darwin.tar.gz': '743f85035a1996ecb350659e01cd9faea9709829be09b1b4b03c73eaf3c9cd73',
  'uv-x86_64-unknown-linux-gnu.tar.gz': 'f68d291c75783122dad58ab77def0e13f3233f358731db5d6d7e8715603b928f',
  'uv-aarch64-unknown-linux-gnu.tar.gz': '4bb69cf95ed13f23713bb7bc09f241896ea0c75b7c557e615a20604b82f9c403',
}

/** Where a build of the pinned release is downloaded from. */
export function uvUrl(asset: string, version: string = UV_VERSION): string {
  return `https://github.com/astral-sh/uv/releases/download/${version}/${asset}`
}
