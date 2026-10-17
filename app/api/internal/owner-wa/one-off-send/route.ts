import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { ownerWhatsappOneOffRecipientId } from '@/lib/flags/ownerWhatsappReminderFlags'
import { sendOneOffReminder } from '@/lib/ownerWhatsappReminders/oneOffSend'

/**
 * ONE owner reminder for a test (see lib/ownerWhatsappReminders/oneOffSend.ts).
 * POST only, CRON_SECRET only, 404 unless OWNER_WA_ONE_OFF_RECIPIENT_ID is set.
 * Body: exactly `{ "conversationId": <positive integer> }`. The recipient is
 * never taken from the request.
 */

function authorized(req: NextRequest, secret: string): boolean {
  const given = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function conversationIdFrom(body: unknown): number | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'conversationId') return null
  const id = (body as { conversationId: unknown }).conversationId
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null
}

export async function POST(req: NextRequest) {
  if (!ownerWhatsappOneOffRecipientId()) return new NextResponse('Not Found', { status: 404 })
  const secret = process.env.CRON_SECRET
  if (!secret) return new NextResponse('Internal Server Error', { status: 500 })
  if (!authorized(req, secret)) return new NextResponse('Forbidden', { status: 403 })

  const conversationId = conversationIdFrom(await req.json().catch(() => null))
  if (!conversationId) return NextResponse.json({ ok: false, reason: 'invalid_body' }, { status: 400 })

  try {
    const result = await sendOneOffReminder({ conversationId })
    console.log('[OwnerWaReminder][one-off]', { conversationId, ...result })
    return NextResponse.json({ ok: result.outcome === 'sent', ...result }, { status: result.outcome === 'refused' ? 409 : 200 })
  } catch (err) {
    // An interrupted attempt leaves its delivery `sending`: it is never resent.
    console.error('[OwnerWaReminder][one-off] failed', { conversationId, code: (err as { code?: string })?.code ?? null })
    return NextResponse.json({ ok: false, outcome: 'error' }, { status: 500 })
  }
}
