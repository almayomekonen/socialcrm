import { NextRequest, NextResponse } from 'next/server'
import { verifyLeadUnsubscribe } from '@/lib/automations/unsubscribeToken'
import { addLeadSuppression } from '@/db/automations/suppressions'

/**
 * Lead unsubscribe — the engine's own consent surface (ADR-003).
 *
 * Scoped to (agencyId, leadId) and verified by the engine's HMAC. Deliberately
 * NOT the platform route (/api/email/unsubscribe, userId-scoped): the two
 * domains' consent must never interact (spec §0).
 *
 * GET RENDERS, POST MUTATES (ADR-003 amendment). Corporate mail gateways
 * (Defender Safe Links, Proofpoint, Mimecast) fetch emailed links unattended;
 * a GET-mutating endpoint would hand them a silent, permanent, invisible
 * opt-out for leads who never clicked. Scanners follow links; they do not
 * submit forms. The emailed URL is unchanged — only the mutation moved.
 *
 * POST is idempotent: the suppression insert ignores conflicts, so repeated
 * submissions and retries converge to one permanent row.
 */

const PAGE_STYLE = 'font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:40px;text-align:center;color:#0f172a;'
const CARD_STYLE = 'max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;'
const BUTTON_STYLE =
  'display:inline-block;margin-top:20px;background:#dc2626;color:#fff;border:0;border-radius:10px;padding:12px 24px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;'

function html(inner: string, title: string, status: number): NextResponse {
  const doc = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body style="${PAGE_STYLE}"><div style="${CARD_STYLE}">${inner}</div></body></html>`
  return new NextResponse(doc, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function message(title: string, body: string, status: number): NextResponse {
  return html(
    `<h1 style="font-size:20px;margin:0 0 12px;">${title}</h1><p style="font-size:15px;color:#475569;margin:0;line-height:1.6;">${body}</p>`,
    title,
    status,
  )
}

// One identical rejection for every invalid case — no enumeration oracle.
const invalid = () => message('הקישור אינו תקין', 'לא ניתן לעבד את הבקשה. ייתכן שהקישור פג תוקף.', 400)

type Parsed = { agencyId: number; leadId: number; token: string } | null

function parse(agencyRaw: string | null, leadRaw: string | null, token: string | null): Parsed {
  const agencyId = Number(agencyRaw)
  const leadId = Number(leadRaw)
  const ok =
    Number.isInteger(agencyId) &&
    agencyId > 0 &&
    Number.isInteger(leadId) &&
    leadId > 0 &&
    !!token &&
    verifyLeadUnsubscribe(agencyId, leadId, token)
  return ok ? { agencyId, leadId, token: token as string } : null
}

/** Renders the confirmation. Never mutates — safe for scanners and prefetch. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const parsed = parse(p.get('a'), p.get('l'), p.get('t'))
  if (!parsed) {
    console.log('[automations][unsubscribe] rejected', { phase: 'confirm', reason: 'invalid_link' })
    return invalid()
  }

  const esc = (s: string) => s.replace(/"/g, '&quot;')
  return html(
    `<h1 style="font-size:20px;margin:0 0 12px;">הסרה מרשימת התפוצה</h1>
<p style="font-size:15px;color:#475569;margin:0;line-height:1.6;">לאחר האישור לא יישלחו אליך יותר הודעות אוטומטיות מהעסק ששלח את ההודעה הזו.</p>
<form method="POST" action="/api/automations/unsubscribe">
<input type="hidden" name="a" value="${esc(String(parsed.agencyId))}">
<input type="hidden" name="l" value="${esc(String(parsed.leadId))}">
<input type="hidden" name="t" value="${esc(parsed.token)}">
<button type="submit" style="${BUTTON_STYLE}">אישור ההסרה</button>
</form>`,
    'הסרה מרשימת התפוצה',
    200,
  )
}

/**
 * Performs the suppression. The only mutating verb on this route.
 *
 * Identifiers are read from the form body, falling back to the QUERY STRING for
 * RFC 8058 one-click unsubscribe: a mail client acting on the
 * `List-Unsubscribe-Post` header posts `List-Unsubscribe=One-Click` as the whole
 * body, so the only place (a, l, t) can be is the URL.
 *
 * This does not weaken the GET-renders/POST-mutates protection above. That guard
 * exists because corporate link scanners FETCH emailed links unattended — they
 * issue GETs, and do not submit or synthesise POSTs. The verb is what protects
 * the mutation; where the identifiers are carried does not change it.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  const q = req.nextUrl.searchParams
  const read = (k: string) => {
    const v = form?.get(k)
    return typeof v === 'string' ? v : q.get(k)
  }

  const parsed = parse(read('a'), read('l'), read('t'))
  if (!parsed) {
    console.log('[automations][unsubscribe] rejected', { phase: 'submit', reason: 'invalid_link' })
    return invalid()
  }

  await addLeadSuppression(parsed.agencyId, parsed.leadId, 'unsubscribe_link')
  // The suppression row (with its unsubscribedAt) is the lead-scoped record;
  // this line is its engineering counterpart (ADR-011 observability).
  console.log('[automations][unsubscribe] suppressed', {
    agencyId: parsed.agencyId,
    leadId: parsed.leadId,
    source: 'unsubscribe_link',
  })

  return message(
    'הוסרת מרשימת התפוצה',
    'לא יישלחו אליך יותר הודעות אוטומטיות מהעסק הזה. אם תרצה/י לחזור לקבל אותן, אפשר לפנות ישירות לעסק.',
    200,
  )
}
