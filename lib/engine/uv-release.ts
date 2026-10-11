// The uv release the engine install uses, and the SHA-256 of each build.
// Pinned rather than "latest", so what runs is what was checked. To move to
// another release, run `node scripts/pin-downloads.mjs uv <version>` and paste
// what it prints here.

export const UV_VERSION = '0.13.0'

export const UV_SHA256: Record<string, string> = {
  'uv-x86_64-pc-windows-msvc.zip': '088962f9e7b7bd9ea740c04c650b2a21c8928c345bd99ac24350dc924dba656c',
  'uv-aarch64-pc-windows-msvc.zip': 'cb54028b59aa87f11cf6dec293ce000420043a49a8aea522e822a671321f8932',
  'uv-x86_64-apple-darwin.tar.gz': '5f44dcbde809b632f47c36fadb241cb4d6f9af71d0c8f172b5d2026d3dde742c',
  'uv-aarch64-apple-darwin.tar.gz': 'a9c1b29002cf3c83f07fa9cd8a887a3be0107d90e23189721221e7257db8e3d6',
  'uv-x86_64-unknown-linux-gnu.tar.gz': '1468ebd5a5541121837c5a2817b9972ba6090fa6caa3d142620850a47fb75154',
  'uv-aarch64-unknown-linux-gnu.tar.gz': '3ccfb6af6e242433eb552f7d9676abd5412c6595c497e990d9c8cb7b5bd4d2c3',
}

/** Where a build of the pinned release is downloaded from. */
export function uvUrl(asset: string, version: string = UV_VERSION): string {
  return `https://github.com/astral-sh/uv/releases/download/${version}/${asset}`
}
