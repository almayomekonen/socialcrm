import { NextRequest, NextResponse } from 'next/server'
import { verifyLeadUnsubscribe } from '@/lib/automations/unsubscribeToken'
import { addLeadSuppression } from '@/db/automations/suppressions'

/**
 * Lead unsubscribe — the engine's own consent surface (ADR-003).
 *
 * Scoped to (agencyId, leadId) and verified by the engine's HMAC. Deliberately
 * NOT the platform route (/api/email/unsubscribe, userId-scoped): the two
 * domains' consent must never interact (spec §0). A lead opting out here can
 * never silence a platform billing email, and vice versa.
 *
 * Idempotent: the suppression insert ignores conflicts, so repeated clicks,
 * scanner prefetches, and retries all converge to one permanent row.
 */

const PAGE_STYLE = 'font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:40px;text-align:center;color:#0f172a;'
const CARD_STYLE = 'max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;'

function page(title: string, body: string, status: number): NextResponse {
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body style="${PAGE_STYLE}"><div style="${CARD_STYLE}"><h1 style="font-size:20px;margin:0 0 12px;">${title}</h1><p style="font-size:15px;color:#475569;margin:0;line-height:1.6;">${body}</p></div></body></html>`
  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export async function GET(req: NextRequest) {
  const agencyId = Number(req.nextUrl.searchParams.get('a'))
  const leadId = Number(req.nextUrl.searchParams.get('l'))
  const token = req.nextUrl.searchParams.get('t') ?? ''

  const validIds = Number.isInteger(agencyId) && agencyId > 0 && Number.isInteger(leadId) && leadId > 0
  // One generic response for every rejection — no enumeration oracle.
  if (!validIds || !verifyLeadUnsubscribe(agencyId, leadId, token)) {
    console.log('[automations][unsubscribe] rejected', { reason: 'invalid_link' })
    return page('הקישור אינו תקין', 'לא ניתן לעבד את הבקשה. ייתכן שהקישור פג תוקף.', 400)
  }

  await addLeadSuppression(agencyId, leadId, 'unsubscribe_link')
  // The suppression row (with its unsubscribedAt) is the lead-scoped record;
  // this line is its engineering counterpart (ADR-011 observability).
  console.log('[automations][unsubscribe] suppressed', { agencyId, leadId, source: 'unsubscribe_link' })

  return page(
    'הוסרת מרשימת התפוצה',
    'לא יישלחו אליך יותר הודעות אוטומטיות מהעסק הזה. אם תרצה/י לחזור לקבל אותן, אפשר לפנות ישירות לעסק.',
    200,
  )
}
