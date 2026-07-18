import { NextRequest, NextResponse } from 'next/server'
import { IS_PROD } from '@/lib/email/config'
import { AUTOMATIONS } from '@/lib/emailAutomations/registry'
import { renderEmail, renderEmailText } from '@/lib/email/render'
import { sendEmail } from '@/lib/email/sender'
import type { Recipient } from '@/lib/emailAutomations/types'

// Fixed preview recipient — every preview goes here, never to a real user.
const PREVIEW_TO = 'alamayo274@gmail.com'

/**
 * Development-only preview: renders a single automation's template and sends it
 * to the fixed preview address through the existing email pipeline. It deliberately
 * bypasses audience, scheduling, suppression, and dedup, and writes NO database
 * records (it never touches the dispatcher / email_automation_sends). Blocked in
 * production (and Vercel preview deployments, which run as production builds).
 */
export async function POST(req: NextRequest) {
  if (IS_PROD) return new NextResponse('Not found', { status: 404 })

  let body: { automation?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const automation = AUTOMATIONS.find((a) => a.key === body?.automation)
  if (!automation) {
    return NextResponse.json(
      { ok: false, error: 'unknown_automation', supported: AUTOMATIONS.map((a) => a.key) },
      { status: 400 },
    )
  }

  const recipient: Recipient = { userId: 0, agencyId: 0, email: PREVIEW_TO, firstName: 'דוד' }
  const element = automation.template(recipient)
  const [html, text] = await Promise.all([renderEmail(element), renderEmailText(element)])

  const res = await sendEmail({ to: PREVIEW_TO, subject: `[PREVIEW] ${automation.subject(recipient)}`, html, text })
  if ('error' in res) {
    return NextResponse.json({ ok: false, automation: automation.key, error: res.error }, { status: 502 })
  }
  return NextResponse.json({ ok: true, automation: automation.key, to: PREVIEW_TO, id: res.id })
}
