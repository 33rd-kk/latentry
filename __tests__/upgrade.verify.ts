/**
 * Upgrades: settings files and pictures written by earlier releases (0.5 on),
 * read by this one. The fixtures in fixtures/upgrade/<version>/ were made by
 * that release's own code (see the README there) and are never regenerated,
 * so a change here that breaks an old file fails this script.
 *
 * Run with: npm test -- upgrade
 */
import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { check, done, eq } from './assert'
import { listPage } from '../lib/gallery/fs'
import type { GalleryDir } from '../lib/gallery/dirs'
import { LATENTRY_KEY, metaFromText, PARAMETERS_KEY, parseA1111Parameters, readImageInfo } from '../lib/image-meta'
import { parseStoredSettings, validateSettings, type SettingsInput } from '../lib/settings/schema'

const FIXTURES = path.join(__dirname, 'fixtures', 'upgrade')

async function main() {
  const versions = (await readdir(FIXTURES, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  check(versions[0] === '0.5.0' && versions.length >= 8, `fixtures from 0.5.0 on (${versions.join(', ')})`)

  for (const version of versions) {
    const at = path.join(FIXTURES, version)

    // ── The settings file: every part comes back as it was written ──
    const stored = JSON.parse(await readFile(path.join(at, 'settings.json'), 'utf8'))
    eq(parseStoredSettings(stored, {}), stored, `${version}: its settings file is read whole`)
    const edited = validateSettings({ tagger: null } as SettingsInput, parseStoredSettings(stored, {}), {})
    eq(edited.ok ? { ...edited.settings, tagger: stored.tagger } : null, stored, `${version}: and an unrelated edit keeps every other part`)

    // ── The picture: its record and its infotext ──
    const info = await readImageInfo(path.join(at, 'picture.png'))
    const record = JSON.parse(info?.text[LATENTRY_KEY] ?? 'null')
    const meta = info ? metaFromText(info.text) : null
    eq(
      [meta?.source, meta?.prompt, meta?.negativePrompt, meta?.seed, meta?.width, meta?.height, meta?.steps, meta?.cfg, meta?.sampler, meta?.scheduler],
      ['latentry', record.prompt, record.negative_prompt, record.seed, record.width, record.height, record.steps, record.cfg, record.sampler, record.scheduler],
      `${version}: its picture's settings are read from the record`
    )
    eq(
      [meta?.backend, meta?.kind, meta?.profile, meta?.model, meta?.mode, meta?.created],
      [record.backend, record.kind, record.profile, record.model, record.mode, record.created],
      `${version}: with where and when it was drawn`
    )
    eq(meta?.loras, record.loras?.map((lora: { name: string }) => lora.name), `${version}: the LoRAs it applied, when it recorded them`)
    eq(meta?.hires, record.hires, `${version}: its hires fix, when it recorded one`)
    eq(meta?.promptTemplate, record.prompt_template, `${version}: its wildcard prompt, when it recorded one`)
    eq(meta?.grid, record.grid, `${version}: its place in an X/Y grid, when it recorded one`)
    eq(meta?.tags?.map((tag) => tag.name), ['smile'], `${version}: its WD14 tags`)
    const infotext = parseA1111Parameters(info?.text[PARAMETERS_KEY] ?? '')
    eq([infotext.prompt, infotext.seed, infotext.steps], [record.prompt, record.seed, record.steps], `${version}: its A1111 infotext, for other tools`)
  }

  // ── The gallery: old pictures are listed, searched and filtered ──
  const root = await mkdtemp(path.join(tmpdir(), 'latentry-upgrade-'))
  try {
    for (const version of versions) await copyFile(path.join(FIXTURES, version, 'picture.png'), path.join(root, `${version}.png`))
    const dir: GalleryDir = { index: 0, path: root, label: 'old', autoLabel: true, writable: false }
    const names = async (filter: Parameters<typeof listPage>[1]['filter']) =>
      (await listPage(dir, { limit: 100, filter })).items.map((item) => item.name.replace('.png', '')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    eq(await names({ source: 'latentry' }), versions, "every release's picture counts as Latentry's")
    eq(await names({ q: 'smile' }), versions, 'and is found by its prompt')
    eq(await names({ lora: 'style' }), versions.filter((version) => version !== '0.5.0'), 'by its LoRA, from 0.6.0 on')
    eq(await names({ grid: 'cells' }), versions.filter((version) => version.localeCompare('0.12.0', 'en', { numeric: true }) >= 0), 'as a grid cell, from 0.12.0 on')
  } finally {
    await rm(root, { recursive: true, force: true })
  }

  done('upgrade')
}

void main()
