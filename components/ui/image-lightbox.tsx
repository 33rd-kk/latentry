"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Eye, EyeOff } from "lucide-react"
import { openViewer, type ViewerHandle, type ViewerItem } from "panorail"
import "panorail/style.css"
import { useSecretMode } from "@/components/app-header"
import { tStatic } from "@/lib/i18n/core"
import { preferences } from "@/lib/storage"

export type LightboxItem = ViewerItem

// One setting for every viewer that has a panel, remembered across visits.
const PANEL_OPEN_KEY = "lightboxPanelOpen"

function readPanelOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_OPEN_KEY) === "1"
  } catch {
    return false
  }
}

function writePanelOpen(open: boolean) {
  try {
    localStorage.setItem(PANEL_OPEN_KEY, open ? "1" : "0")
  } catch {
    // Storage unavailable — the choice just isn't remembered.
  }
}

// Secret mode blurs every slide, so a swipe never shows the next image sharp,
// and spares only the one the user chose to show. panorail sets the blur
// before an image loads.
function veilFor(veiled: boolean, shownSrc: string | null) {
  return veiled ? (item: LightboxItem) => item.src !== shownSrc : undefined
}

interface ImageLightboxProps {
  items: LightboxItem[]
  /** The item on screen; `null` means closed. */
  index: number | null
  onIndexChange: (index: number) => void
  onClose: () => void
  /** More items exist past the end of `items`; `onLoadMore` fetches them. */
  hasMore?: boolean
  onLoadMore?: () => Promise<void> | void
  /**
   * Accepted for existing callers. Unused: the viewer asks for a page early and
   * again whenever the list grows, and every `onLoadMore` guards its own re-entry.
   */
  loadingMore?: boolean
  /**
   * What the viewer's side panel shows for the image at `index`. Without it the
   * viewer has no panel, and no button for one.
   */
  renderPanel?: (index: number) => ReactNode
  /**
   * Blurs the viewer's images (secret mode), every one of them: the next and
   * previous slides are already loaded, and a swipe brings them on screen
   * before the index changes.
   */
  veiled?: boolean
  /** With `veiled`: the one image (by its `src`) the user chose to show, left sharp. */
  shownSrc?: string | null
  /**
   * Opens the panel when the viewer opens, or when this turns on while it is
   * open, whatever was last chosen (and does not remember it).
   */
  panelOpenOnStart?: boolean
}

/**
 * Full-screen image preview (panorail): swipe or
 * arrow keys move between images, pinch / double-tap / wheel zoom, a vertical
 * drag or Esc closes. The viewer mounts on <body>; the only thing rendered from
 * here is `renderPanel`, portaled into the viewer's side panel.
 */
export function ImageLightbox({
  items,
  index,
  onIndexChange,
  onClose,
  hasMore,
  onLoadMore,
  renderPanel,
  veiled = false,
  shownSrc = null,
  panelOpenOnStart = false,
}: ImageLightboxProps) {
  const open = index !== null && index >= 0 && index < items.length

  const viewer = useRef<ViewerHandle | null>(null)
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null)
  // The secret-mode switch, a button panorail puts in the viewer's bar.
  const [secretEl, setSecretEl] = useState<HTMLButtonElement | null>(null)
  const secret = useSecretMode()
  // Whether there is a panel is settled when the viewer opens.
  const hasPanel = !!renderPanel
  const veil = veilFor(veiled, shownSrc)

  // The viewer outlives renders, so it reads the latest props through a ref.
  // Declared first, so it is current by the time the effects below run.
  const latest = useRef({ items, hasMore, onIndexChange, onClose, onLoadMore, panelOpenOnStart, secret, veil })
  useEffect(() => {
    latest.current = { items, hasMore, onIndexChange, onClose, onLoadMore, panelOpenOnStart, secret, veil }
  })

  useEffect(() => {
    if (!open) return
    const handle = openViewer({
      items: latest.current.items,
      index: index!,
      hasMore: !!latest.current.hasMore,
      veil: latest.current.veil,
      loadMore: () => latest.current.onLoadMore?.(),
      onIndexChange: (i) => latest.current.onIndexChange(i),
      onClose: () => {
        viewer.current = null
        latest.current.onClose()
      },
      labels: {
        close: tStatic("system.viewerClose"),
        prev: tStatic("system.viewerPrev"),
        next: tStatic("system.viewerNext"),
        zoom: tStatic("system.viewerZoom"),
        download: tStatic("system.viewerDownload"),
        error: tStatic("system.viewerError"),
        panel: tStatic("system.viewerPanel"),
      },
      panel: hasPanel
        ? {
            open: latest.current.panelOpenOnStart || readPanelOpen(),
            onToggle: writePanelOpen,
            mount: (el) => {
              setPanelEl(el)
              return () => setPanelEl(null)
            },
          }
        : undefined,
      // The secret-mode switch, in the viewer's own bar so it is in reach
      // without closing the picture. Its icon is portaled in below.
      buttons: [
        {
          label: tStatic("app.secretMode"),
          onClick: () => preferences.setSecretMode(!latest.current.secret),
          mount: (el) => {
            setSecretEl(el)
            return () => setSecretEl(null)
          },
        },
      ],
    })
    viewer.current = handle
    return () => {
      viewer.current = null
      handle.destroy()
    }
    // Opening and closing only; the list and the index are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (panelOpenOnStart) viewer.current?.setPanelOpen(true)
  }, [panelOpenOnStart])

  useEffect(() => {
    viewer.current?.setVeil(veilFor(veiled, shownSrc))
  }, [veiled, shownSrc])

  useEffect(() => {
    secretEl?.setAttribute("aria-pressed", String(secret))
  }, [secretEl, secret])

  useEffect(() => {
    viewer.current?.setItems(items, !!hasMore)
  }, [items, hasMore])

  useEffect(() => {
    if (index !== null && viewer.current && viewer.current.index !== index) viewer.current.goTo(index)
  }, [index])

  if (!open) return null
  return (
    <>
      {secretEl && createPortal(secret ? <EyeOff aria-hidden /> : <Eye aria-hidden />, secretEl)}
      {panelEl && renderPanel && createPortal(renderPanel(index!), panelEl)}
    </>
  )
}
