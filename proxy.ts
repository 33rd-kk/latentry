import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { serverMessage } from '@/lib/i18n/core'
import { checkRequestBudget, type BudgetRejection } from '@/lib/security/request-budget'
import { checkApiRequest } from '@/lib/security/route-guard'

/** Short page for a refused page load; a browser has no JSON handler to show. */
const TOO_MANY_REQUESTS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>429</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.6">
<h1 style="font-size:1.25rem">Too many requests</h1>
<p>Wait a few seconds, then reload.</p>
</body></html>`

function budgetRejection(rejection: BudgetRejection): NextResponse {
  const headers = {
    'Cache-Control': 'no-store',
    'Retry-After': String(rejection.retryAfter),
    'X-RateLimit-Type': `budget-${rejection.kind}-${rejection.scope}`,
  }
  if (rejection.kind === 'page') {
    return new NextResponse(TOO_MANY_REQUESTS_HTML, {
      status: 429,
      headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  return NextResponse.json(
    { error: serverMessage('system.tooManyRequests', { seconds: rejection.retryAfter }), retryAfter: rejection.retryAfter },
    { status: 429, headers }
  )
}

/**
 * Every /api route is same-origin only, from a host that cannot be DNS-rebound
 * (see lib/security/route-guard.ts), and everything is counted against a
 * per-IP budget (see lib/security/request-budget.ts).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/api/')) {
    const rejection = checkApiRequest(request, process.env)
    if (rejection) {
      return NextResponse.json({ error: rejection.error }, { status: rejection.status, headers: { 'Cache-Control': 'no-store' } })
    }
  }

  const overBudget = checkRequestBudget({ method: request.method, headers: request.headers, pathname }, process.env)
  if (overBudget) return budgetRejection(overBudget)

  const response = NextResponse.next()
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'same-origin')
  if (!pathname.startsWith('/api/')) response.headers.set('X-Frame-Options', 'DENY')
  return response
}

export const config = {
  // Next's own build files are not worth guarding or counting. Nothing is
  // excluded by extension: gallery pictures are /api/gallery/<dir>/<name>.png,
  // and those must go through the host check like every other /api route.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
