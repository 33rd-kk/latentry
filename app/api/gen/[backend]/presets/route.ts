import { NextResponse } from 'next/server'
import { adapterOr404, json } from '@/lib/api'

export const runtime = 'nodejs'

/** The backend's speed/quality presets; an empty list when it has none or is down. */
export async function GET(_request: Request, ctx: RouteContext<'/api/gen/[backend]/presets'>) {
  const adapter = adapterOr404((await ctx.params).backend)
  if (adapter instanceof NextResponse) return adapter
  // Short cache: presets only change when the backend restarts.
  return json(await adapter.presets(), { headers: { 'Cache-Control': 'private, max-age=60' } })
}
