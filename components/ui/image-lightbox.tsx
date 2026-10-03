"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { openViewer, type ViewerHandle, type ViewerItem } from "panorail"
import "panorail/style.css"
import { tStatic } from "@/lib/i18n/core"

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
}: ImageLightboxProps) {
  const open = index !== null && index >= 0 && index < items.length
  const viewer = useRef<ViewerHandle | null>(null)
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null)
  // Whether there is a panel is settled when the viewer opens.
  const hasPanel = !!renderPanel

  // The viewer outlives renders, so it reads the latest props through a ref.
  // Declared first, so it is current by the time the effects below run.
  const latest = useRef({ items, hasMore, onIndexChange, onClose, onLoadMore })
  useEffect(() => {
    latest.current = { items, hasMore, onIndexChange, onClose, onLoadMore }
  })

  useEffect(() => {
    if (!open) return
    const handle = openViewer({
      items: latest.current.items,
      index: index!,
      hasMore: !!latest.current.hasMore,
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
            open: readPanelOpen(),
            onToggle: writePanelOpen,
            mount: (el) => {
              setPanelEl(el)
              return () => setPanelEl(null)
            },
          }
        : undefined,
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
    viewer.current?.setItems(items, !!hasMore)
  }, [items, hasMore])

  useEffect(() => {
    if (index !== null && viewer.current && viewer.current.index !== index) viewer.current.goTo(index)
  }, [index])

  if (!open || !panelEl || !renderPanel) return null
  return createPortal(renderPanel(index!), panelEl)
}
