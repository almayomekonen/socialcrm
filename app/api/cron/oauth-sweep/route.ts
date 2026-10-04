import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { sweepOAuthState } from '@/lib/oauth/server/sweep'

/**
 * Daily OAuth + MCP retention sweep (lib/oauth/server/sweep.ts).
 *
 * Vercel Cron calls it with `Authorization: Bearer ${CRON_SECRET}`; nothing
 * else is accepted. Fails closed: no CRON_SECRET → 500, wrong or missing
 * header → 403, and the sweep never runs. Deliberately NOT gated on
 * MCP_ENABLED: cleanup must keep running when the feature is switched off.
 *
 * Logs and returns only counts and duration — never a token, hash, code or id.
 */

export const maxDuration = 60

function isAuthorized(req: NextRequest, secret: string): boolean {
  const got = Buffer.from(req.headers.get('authorization') ?? '')
  const want = Buffer.from(`Bearer ${secret}`)
  return got.length === want.length && timingSafeEqual(got, want)
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[oauth-sweep][cron] CRON_SECRET is not set')
    return new NextResponse('Internal Server Error', { status: 500 })
  }
  if (!isAuthorized(req, secret)) return new NextResponse('Forbidden', { status: 403 })

  const started = Date.now()
  try {
    const counts = await sweepOAuthState()
    console.log('[oauth-sweep] ok', { ...counts, durationMs: Date.now() - started })
    return NextResponse.json({ ok: true, ...counts })
  } catch (e) {
    console.error('[oauth-sweep] failed', { error: (e as Error)?.name, durationMs: Date.now() - started })
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
