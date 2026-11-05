"use client"

import { useEffect } from "react"

// Asks before the page is left while `active` (a form with unsaved changes):
// closing or reloading the tab gets the browser's own question, and a link
// to another page in the app gets `message`. A link within the page (another
// #section), one opening a new tab and a modified click (Ctrl, Shift…) leave
// nothing behind, so they are let through. Back and Forward are not asked
// about: the App Router gives no way to stop them.

/** How long a confirmed link may take to unload the page without a second question. */
const CONFIRMED_MS = 1000

export function useConfirmLeave(active: boolean, message: string) {
  useEffect(() => {
    if (!active) return
    let confirmedAt = -Infinity

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // A plain <a> to this site unloads the page right after its question.
      if (Date.now() - confirmedAt < CONFIRMED_MS) return
      event.preventDefault()
    }

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null
      if (!(link instanceof HTMLAnchorElement)) return
      if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return
      const to = new URL(link.href, window.location.href)
      // Another site: the browser's own question comes with unloading.
      if (to.origin !== window.location.origin) return
      if (to.pathname === window.location.pathname && to.search === window.location.search) return
      if (window.confirm(message)) {
        confirmedAt = Date.now()
        return
      }
      // Caught on the way down, before next/link's own handler sees it.
      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener("beforeunload", onBeforeUnload)
    window.addEventListener("click", onClick, true)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      window.removeEventListener("click", onClick, true)
    }
  }, [active, message])
}
