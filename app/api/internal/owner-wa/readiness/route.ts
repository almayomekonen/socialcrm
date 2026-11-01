import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { checkOwnerReminderReadiness } from '@/lib/whatsapp/platform/readiness'
import { checkAgentPlatformReadiness } from '@/lib/whatsapp/platform/agentReadiness'

/**
 * READ-ONLY readiness of the owner-reminder sender (see
 * lib/whatsapp/platform/readiness.ts). GET only, CRON_SECRET only. It reads
 * Meta and never sends or changes anything.
 */
function authorized(req: NextRequest, secret: string): boolean {
  const given = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return new NextResponse('Internal Server Error', { status: 500 })
  if (!authorized(req, secret)) return new NextResponse('Forbidden', { status: 403 })
  // ?scope=agent: the WhatsApp assistant's readiness (lib/whatsapp/platform/agentReadiness.ts).
  // Without it the response is the owner-reminder readiness, exactly as before.
  const result = req.nextUrl.searchParams.get('scope') === 'agent' ? await checkAgentPlatformReadiness() : await checkOwnerReminderReadiness()
  return NextResponse.json(result, { status: 200 })
}
