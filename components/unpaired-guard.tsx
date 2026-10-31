"use client"

import { useEffect } from "react"
import { UNPAIRED_HEADER } from "@/lib/security/unpaired"

/**
 * Sends this browser to the pairing page as soon as an API request says it
 * is not paired: its pairing ended, it was removed, or every device was
 * forgotten while a page was open. Moving between pages does not always ask
 * the server (Next keeps pages it has shown or prefetched for a while), so
 * proxy.ts's redirect alone may never come. A full load, not the router, so
 * no kept page is shown instead.
 *
 * It watches window.fetch for proxy.ts's mark (lib/security/unpaired.ts);
 * other 401s, such as a backend asking for its login, pass untouched.
 */
export function UnpairedGuard() {
  useEffect(() => {
    const original = window.fetch
    const guarded: typeof window.fetch = async (...args) => {
      const response = await original(...args)
      if (response.status === 401 && response.headers.get(UNPAIRED_HEADER) && window.location.pathname !== "/pair") {
        window.location.replace("/pair")
      }
      return response
    }
    window.fetch = guarded
    return () => {
      if (window.fetch === guarded) window.fetch = original
    }
  }, [])
  return null
}
