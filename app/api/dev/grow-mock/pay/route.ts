import { NextRequest, NextResponse } from 'next/server'
import { isGrowLocalMockEnabled, MOCK_CARD_TOKEN } from '@/lib/payments/grow/localMock'

/**
 * A LOCAL STAND-IN for Grow's hosted payment page, for the demo walkthrough.
 * 404 unless the local mock is explicitly enabled (see localMock.ts). No card
 * data is collected or stored: the buttons post a synthetic callback to the real
 * /api/payments/grow/notify route, so the real parser, correlation and
 * verification path run.
 */
export async function GET(req: NextRequest) {
  if (!isGrowLocalMockEnabled()) return new NextResponse('Not found', { status: 404 })
  const p = req.nextUrl.searchParams
  const field = (name: string, value: string) => `<input type="hidden" name="${name}" value="${value.replace(/"/g, '&quot;')}">`
  const common = field('processId', p.get('processId') ?? '') + field('processToken', p.get('processToken') ?? '') + field('reference', p.get('reference') ?? '') + field('successUrl', p.get('successUrl') ?? '')

  return new NextResponse(
    `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>סימולציית Grow (מקומי)</title>
<style>body{font-family:system-ui;background:#f8fafc;margin:0;padding:40px;display:flex;justify-content:center}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;max-width:460px;width:100%}
.banner{background:#fef3c7;border:1px solid #fde68a;color:#92400e;padding:10px 12px;border-radius:8px;font-size:13px;margin-bottom:16px}
button{width:100%;padding:12px;border-radius:8px;border:0;font-size:15px;font-weight:600;cursor:pointer;margin-top:8px}
.ok{background:#4f46e5;color:#fff}.bad{background:#fff;border:1px solid #cbd5e1}.link{display:block;text-align:center;margin-top:12px;color:#64748b;font-size:13px}</style>
</head><body><div class="card">
<div class="banner">סימולציה מקומית של עמוד התשלום של Grow. אין כאן סליקה אמיתית, לא נשמרים פרטי כרטיס, ולא מתבצע חיוב.</div>
<h1 style="font-size:18px;margin:0 0 4px">שמירת אמצעי תשלום</h1>
<p style="color:#64748b;font-size:14px;margin:0 0 16px">כרטיס דמו: Visa •••• 4242</p>
<form method="post" action="/api/dev/grow-mock/callback">${common}${field('cardToken', MOCK_CARD_TOKEN)}
<button class="ok" type="submit">אישור ושמירת הכרטיס (הצלחה)</button></form>
<form method="post" action="/api/dev/grow-mock/callback">${common}${field('cardToken', 'refused-card-token')}
<button class="bad" type="submit">סימולציית סירוב אימות</button></form>
<a class="link" href="${p.get('cancelUrl') ?? '/dashboard'}">ביטול וחזרה למערכת</a>
</div></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}
