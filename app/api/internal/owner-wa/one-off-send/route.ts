import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { ownerWhatsappOneOffRecipientId } from '@/lib/flags/ownerWhatsappReminderFlags'
import { sendOneOffReminder } from '@/lib/ownerWhatsappReminders/oneOffSend'

/**
 * ONE owner reminder for a test (see lib/ownerWhatsappReminders/oneOffSend.ts).
 * POST only, CRON_SECRET only, 404 unless OWNER_WA_ONE_OFF_RECIPIENT_ID is set.
 * Body: `{ "conversationId": <positive integer> }`, optionally with
 * `"mode": "immediate"` (test: 1-minute minimum wait, wait stated in minutes).
 * Nothing else is accepted; the recipient is never taken from the request.
 */

function authorized(req: NextRequest, secret: string): boolean {
  const given = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function parseBody(body: unknown): { conversationId: number; mode: 'standard' | 'immediate' } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const { conversationId: id, mode, ...rest } = body as Record<string, unknown>
  if (Object.keys(rest).length) return null
  if (mode !== undefined && mode !== 'immediate') return null
  if (!(typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) return null
  return { conversationId: id, mode: mode === 'immediate' ? 'immediate' : 'standard' }
}

export async function POST(req: NextRequest) {
  if (!ownerWhatsappOneOffRecipientId()) return new NextResponse('Not Found', { status: 404 })
  const secret = process.env.CRON_SECRET
  if (!secret) return new NextResponse('Internal Server Error', { status: 500 })
  if (!authorized(req, secret)) return new NextResponse('Forbidden', { status: 403 })

  const parsed = parseBody(await req.json().catch(() => null))
  if (!parsed) return NextResponse.json({ ok: false, reason: 'invalid_body' }, { status: 400 })
  const { conversationId, mode } = parsed

  try {
    const result = await sendOneOffReminder({ conversationId, mode })
    console.log('[OwnerWaReminder][one-off]', { conversationId, mode, ...result })
    return NextResponse.json({ ok: result.outcome === 'sent', ...result }, { status: result.outcome === 'refused' ? 409 : 200 })
  } catch (err) {
    // An interrupted attempt leaves its delivery `sending`: it is never resent.
    console.error('[OwnerWaReminder][one-off] failed', { conversationId, code: (err as { code?: string })?.code ?? null })
    return NextResponse.json({ ok: false, outcome: 'error' }, { status: 500 })
  }
}
