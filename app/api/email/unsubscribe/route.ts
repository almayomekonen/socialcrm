import { NextRequest, NextResponse } from 'next/server'
import { verifyUnsubscribe } from '@/lib/emailAutomations/unsubscribeToken'
import { addSuppression } from '@/db/emailSuppressions'

function page(title: string, body: string, status: number): NextResponse {
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body style="font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:40px;text-align:center;color:#0f172a;"><div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;"><h1 style="font-size:20px;margin:0 0 12px;">${title}</h1><p style="font-size:15px;color:#475569;margin:0;line-height:1.6;">${body}</p></div></body></html>`
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

// Public, token-verified opt-out from lifecycle emails. Transactional emails
// (account/service notices) are unaffected by suppression.
export async function GET(req: NextRequest) {
  const userId = Number(req.nextUrl.searchParams.get('u'))
  const token = req.nextUrl.searchParams.get('t') ?? ''

  if (!Number.isInteger(userId) || userId <= 0 || !verifyUnsubscribe(userId, token)) {
    return page('הקישור אינו תקין', 'לא ניתן לעבד את הבקשה. ייתכן שהקישור פג תוקף.', 400)
  }

  await addSuppression(userId)
  return page(
    'הוסרת מרשימת התפוצה',
    'לא תקבל/י יותר עדכונים שיווקיים מ-SocialCRM. עדכונים חיוניים על החשבון עדיין יישלחו.',
    200,
  )
}
