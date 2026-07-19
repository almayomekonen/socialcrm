import { NextRequest, NextResponse } from 'next/server'
import { IS_PROD } from '@/lib/email/config'
import { AUTOMATIONS } from '@/lib/emailAutomations/registry'
import { STATE_CONTENT } from '@/lib/emailAutomations/content/state'
import { EDUCATIONAL } from '@/lib/emailAutomations/content/educational'
import { renderContentItem } from '@/lib/emailAutomations/contentToAutomation'
import { renderEmail, renderEmailText } from '@/lib/email/render'
import { sendEmail } from '@/lib/email/sender'
import type { Recipient } from '@/lib/emailAutomations/types'

// Fixed preview recipient — every preview goes here, never to a real user.
const PREVIEW_TO = 'alamayo274@gmail.com'

// Every individually previewable email: each content item (state + educational)
// by its key, plus the non-content-driven static automations (Welcome). The
// educational-journey drip itself is not previewable (its content is resolved
// per recipient from delivered state) — preview the individual edu_* items.
const CONTENT_BY_KEY = new Map([...STATE_CONTENT, ...EDUCATIONAL].map((c) => [c.key, c]))
const STATIC_AUTOMATIONS = AUTOMATIONS.filter((a) => !a.resolve && !CONTENT_BY_KEY.has(a.key))
const PREVIEWABLE = [...CONTENT_BY_KEY.keys(), ...STATIC_AUTOMATIONS.map((a) => a.key)]

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

  const key = body?.automation
  const recipient: Recipient = { userId: 0, agencyId: 0, email: PREVIEW_TO, firstName: 'דוד' }

  const item = key ? CONTENT_BY_KEY.get(key) : undefined
  const staticAutomation = STATIC_AUTOMATIONS.find((a) => a.key === key)
  if (!item && !staticAutomation) {
    return NextResponse.json({ ok: false, error: 'unknown_automation', supported: PREVIEWABLE }, { status: 400 })
  }

  const element = item ? renderContentItem(item, recipient) : staticAutomation!.template(recipient)
  const subject = item ? item.subject : staticAutomation!.subject(recipient)
  const [html, text] = await Promise.all([renderEmail(element), renderEmailText(element)])

  const res = await sendEmail({ to: PREVIEW_TO, subject: `[PREVIEW] ${subject}`, html, text })
  if ('error' in res) {
    return NextResponse.json({ ok: false, automation: key, error: res.error }, { status: 502 })
  }
  return NextResponse.json({ ok: true, automation: key, to: PREVIEW_TO, id: res.id })
}
