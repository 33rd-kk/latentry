// Phone width: each page, in English and in Japanese, on a 360px wide touch
// screen. A page that is wider than the screen (so it scrolls sideways) fails
// its test, and so does a button or text that reaches past a card hiding what
// overflows (a row that does not wrap cuts its last labels off). Text cut off
// by its own box, and controls smaller than 24×24px, are printed but do not
// fail it yet, the way a11y.spec.ts prints lesser findings.
//
// Everything is read inside the page; nothing is sent anywhere.

import AxeBuilder from '@axe-core/playwright'
import sharp from 'sharp'
import en from '../locales/en.json'
import ja from '../locales/ja.json'
import { expect, test, type Page } from './test'

/** A string from a catalog, by its key (`gallery.search`). */
function lookup(catalog: unknown, key: string): string {
  const found = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog)
  if (typeof found !== 'string') throw new Error(`no string at ${key}`)
  return found
}

const LOCALES = [
  { locale: 'en-US', catalog: en },
  { locale: 'ja-JP', catalog: ja },
] as const

type Text = (key: string) => string

const PAGES: { path: string; ready: (page: Page, t: Text) => ReturnType<Page['locator']> }[] = [
  { path: '/', ready: (page, t) => page.getByRole('button', { name: t('generate.generateButton'), exact: true }) },
  { path: '/gallery', ready: (page, t) => page.getByPlaceholder(t('gallery.search')) },
  { path: '/settings', ready: (page, t) => page.getByRole('heading', { name: t('settings.title'), exact: true }) },
  { path: '/setup', ready: (page, t) => page.getByRole('heading', { name: t('setup.title'), exact: true }) },
  { path: '/pair', ready: (page, t) => page.getByRole('textbox', { name: t('pair.code') }) },
]

interface Layout {
  /** How many pixels the page is wider than the screen. */
  overflow: number
  /** The outermost elements that reach past the screen's edges. */
  wide: string[]
  /** Controls and text that reach past a box which cuts them off. */
  cut: string[]
  /** Text cut off by a box that neither scrolls nor shows an ellipsis. */
  clipped: string[]
}

/** Measures the page as it is now. */
function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const describe = (el: Element) => {
      const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 4).join('.') : ''
      const text = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
      const box = el.getBoundingClientRect()
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classes ? `.${classes}` : ''} [${Math.round(box.left)}–${Math.round(box.right)}px]${text ? ` "${text}"` : ''}`
    }
    /** Inside a box that keeps it in (clips or scrolls), or fixed to the screen. */
    const contained = (el: Element) => {
      if (getComputedStyle(el).position === 'fixed') return true
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        if (style.overflowX !== 'visible' || style.position === 'fixed') return true
      }
      return false
    }
    const reachesOut = (el: Element) => {
      const box = el.getBoundingClientRect()
      return box.width > 0 && box.height > 0 && (box.right > width + 1 || box.left < -1)
    }

    const overflow = document.documentElement.scrollWidth - width
    const wide: string[] = []
    if (overflow > 1) {
      for (const el of document.body.querySelectorAll('*')) {
        if (!reachesOut(el) || contained(el)) continue
        // Only the outermost: its children reach out because it does.
        if (el.parentElement && el.parentElement !== document.body && reachesOut(el.parentElement)) continue
        wide.push(describe(el))
        if (wide.length === 5) break
      }
    }

    // A row that does not wrap can push its buttons past a card that hides
    // what overflows: the page still fits, but a label is cut off at the edge.
    const cut: string[] = []
    const CONTROL = 'button, a[href], input, select, textarea, label, [role="radio"], [role="tab"], [role="combobox"], [role="checkbox"], [role="switch"]'
    const clips = (value: string) => value === 'hidden' || value === 'clip'
    for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
      const ownText = [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim())
      if (!ownText && !el.matches(CONTROL)) continue
      const box = el.getBoundingClientRect()
      if (box.width <= 1 || box.height <= 1 || getComputedStyle(el).visibility === 'hidden') continue
      let clipper: HTMLElement | null = null
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        // A box that scrolls lets the rest be reached.
        if (/(auto|scroll)/.test(style.overflowX)) break
        if (clips(style.overflowX)) {
          clipper = parent
          break
        }
      }
      if (!clipper) continue
      const edge = clipper.getBoundingClientRect()
      if (edge.width <= 1) continue
      if (box.right > edge.right + 1 || box.left < edge.left - 1) {
        cut.push(`${describe(el)} past ${describe(clipper).split(' "')[0]}`)
        if (cut.length === 10) break
      }
    }

    const clipped: string[] = []
    for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
      const ownText = [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim())
      if (!ownText || el.clientWidth <= 1 || el.clientHeight <= 1) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden') continue
      if (!clips(style.overflowX) && !clips(style.overflowY)) continue
      if (style.textOverflow === 'ellipsis' || (style.webkitLineClamp && style.webkitLineClamp !== 'none')) continue
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) clipped.push(describe(el))
    }
    return { overflow, wide, cut, clipped }
  })
}

/** Fails on a page wider than the screen; prints the rest. */
async function check(page: Page, label: string) {
  // A page mid-animation is measured where it will not stay.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity)
  )
  const { overflow, wide, cut, clipped } = await layout(page)
  if (clipped.length) console.log(`${label}: text cut off\n  ${clipped.join('\n  ')}`)
  const { violations } = await new AxeBuilder({ page }).withRules(['target-size']).analyze()
  const small = violations.flatMap((violation) => violation.nodes.map((node) => node.target.join(' ')))
  if (small.length) console.log(`${label}: controls smaller than 24×24px\n  ${small.slice(0, 10).join('\n  ')}`)
  expect(overflow, `${label}: the page is ${overflow}px wider than the screen, past its edge:\n${wide.join('\n')}`).toBeLessThanOrEqual(1)
  expect(cut, `${label}: cut off at the edge of a box that hides what overflows`).toEqual([])
}

test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

for (const { locale, catalog } of LOCALES) {
  const t: Text = (key) => lookup(catalog, key)

  test.describe(locale, () => {
    test.use({ locale })

    for (const { path, ready } of PAGES) {
      test(`${path} fits a phone screen`, async ({ page }) => {
        await page.goto(path)
        await expect(ready(page, t)).toBeVisible()
        await check(page, `${path} (${locale})`)
      })
    }

    // Secret mode turns its header button into a wider pill.
    test('the header in secret mode fits a phone screen', async ({ page }) => {
      await page.goto('/settings')
      await expect(page.getByRole('heading', { name: t('settings.title'), exact: true })).toBeVisible()
      const secret = page.getByRole('button', { name: t('app.secretMode'), exact: true })
      await secret.click()
      await expect(secret).toHaveAttribute('aria-pressed', 'true')
      await check(page, `secret mode (${locale})`)
    })

    // Gallery-only mode: Settings with its mode card, and Setup with the tagger only.
    test('gallery-only mode fits a phone screen', async ({ page, request }) => {
      expect((await request.put('/api/settings', { data: { mode: 'gallery' } })).status()).toBe(200)
      try {
        await page.goto('/settings#mode')
        await expect(page.getByRole('switch', { name: t('settings.mode.galleryOnly') })).toBeChecked()
        await check(page, `gallery-only settings (${locale})`)
        await page.goto('/setup')
        await expect(page.getByRole('link', { name: t('setup.galleryOnlyLink') })).toBeVisible()
        await check(page, `gallery-only setup (${locale})`)
      } finally {
        // The server is shared by every spec.
        await request.put('/api/settings', { data: { mode: null } })
      }
    })

    test('img2img fits a phone screen', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('button', { name: t('generate.generateButton'), exact: true })).toBeEnabled()
      const picture = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#557799' } }).png().toBuffer()
      const chooser = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: t('generate.sourceDrop') }).click()
      await (await chooser).setFiles({ name: 'source.png', mimeType: 'image/png', buffer: picture })
      await expect(page.getByRole('button', { name: t('generate.maskDraw') })).toBeVisible()
      await check(page, `img2img (${locale})`)
    })

    test('the viewer with its panel fits a phone screen', async ({ page }) => {
      const tag = `mobile${locale.slice(0, 2)}${Date.now()}`
      await page.goto('/')
      const button = page.getByRole('button', { name: t('generate.generateButton'), exact: true })
      await expect(button).toBeEnabled()
      await page.locator('#prompt').fill(`${tag} harbour`)
      await button.click()
      await expect(page.getByRole('link', { name: t('generate.saved') })).toBeVisible()

      await page.goto('/gallery')
      const search = page.getByPlaceholder(t('gallery.search'))
      await search.fill(tag)
      await search.press('Escape')
      const thumbs = page.locator('img[src^="/api/gallery/0/"][src*="thumb=1"]')
      await expect(thumbs).toHaveCount(1)
      await thumbs.first().click()
      // As openViewerPanel (viewer.ts), with this language's name for the button.
      const details = page.getByRole('button', { name: t('system.viewerPanel') })
      await expect(details).toBeVisible()
      if ((await details.getAttribute('aria-pressed')) !== 'true') await details.click()
      await expect(details).toHaveAttribute('aria-pressed', 'true')
      await check(page, `viewer (${locale})`)
    })
  })
}
