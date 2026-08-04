import { describe, expect, it, vi } from 'vitest'
import { emailExecutor, type EmailDeps } from '@/lib/automations/executors/email'
import type { ExecutionContext } from '@/lib/automations/executors/types'
import { renderAutomationEmail } from '@/lib/automations/renderEmail'
import { AUTOMATION_RECIPES } from '@/lib/automations/recipes'
import { TEMPLATE_ENTRIES } from '@/lib/automations/templates/entries'
import { APPLE_MAIL, deliver } from './support/mailClients'

/**
 * Phase 4 — how the email presents itself in an inbox, and how it lets someone
 * out.
 */

const VARS = { leadFirstName: 'דנה', businessName: 'סטודיו אור', repName: 'יעל' }
const BODY = 'שלום {{שם הליד}},\n\nהפנייה שלך התקבלה ואנחנו כבר עליה.\n\nבברכה,\n{{שם העסק}}'

const ctx = (over: Partial<ExecutionContext> = {}): ExecutionContext => ({
  agencyId: 7,
  automationId: 3,
  leadId: 42,
  mode: 'live',
  subject: { leadFirstName: 'דנה', businessName: null, repName: null },
  recipients: { email: 'dana@example.com' },
  parameters: { subject: 'עדכון', body: BODY },
  ...over,
})

const deps = (over: Partial<EmailDeps> = {}): EmailDeps => ({
  agencyName: vi.fn(async () => 'סטודיו אור'),
  replyTo: vi.fn(async () => 'owner@business.example'),
  repName: vi.fn(async () => null),
  from: () => 'bot@mail.example',
  send: vi.fn(async () => ({ ok: true as const, id: 'msg_1' })),
  ...over,
})

describe('one-click unsubscribe headers (GML-3)', () => {
  it('sets List-Unsubscribe and List-Unsubscribe-Post on a live send', async () => {
    const send = vi.fn(async () => ({ ok: true as const, id: 'msg_1' }))
    const d = deps({ send })
    const pre = await emailExecutor.preflight(ctx(), d)
    await emailExecutor.execute(ctx(), pre.ready!, d)

    const args = (send as ReturnType<typeof vi.fn>).mock.calls[0][0] as { headers?: Record<string, string>; html: string }
    expect(args.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    // Angle-bracketed per RFC 2369, and the SAME url the body link uses — two
    // different unsubscribe targets would be two different consent records.
    const header = args.headers?.['List-Unsubscribe'] ?? ''
    expect(header).toMatch(/^<https:\/\/|^<http:\/\//)
    const url = header.slice(1, -1)
    expect(args.html).toContain(url.replace(/&/g, '&amp;'))
  })

  it('sets them on a test send too', async () => {
    const send = vi.fn(async () => ({ ok: true as const, id: 'msg_1' }))
    await emailExecutor.test!(
      { subject: 'עדכון', body: BODY },
      { agencyId: 7, toName: 'דנה', address: 'me@example.com' },
      deps({ send }),
    )
    const args = (send as ReturnType<typeof vi.fn>).mock.calls[0][0] as { headers?: Record<string, string> }
    expect(args.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    // Inert: lead 0, so acting on a test's header cannot suppress a real lead.
    expect(args.headers?.['List-Unsubscribe']).toContain('l=0')
  })

  it('sends no headers in log mode, because nothing is sent', async () => {
    const send = vi.fn(async () => ({ ok: true as const, id: 'msg_1' }))
    const d = deps({ send })
    const logCtx = ctx({ mode: 'log' })
    const pre = await emailExecutor.preflight(logCtx, d)
    const out = await emailExecutor.execute(logCtx, pre.ready!, d)
    expect(out.kind).toBe('would_send')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('the inbox snippet (GML-2)', () => {
  it('carries a hidden preheader taken from the first real paragraph', async () => {
    const { html } = await renderAutomationEmail({
      subject: 'עדכון',
      body: BODY,
      vars: VARS,
      unsubscribeUrl: 'https://x.co/u',
    })
    const { document } = deliver(html, APPLE_MAIL)
    const hidden = [...document.querySelectorAll<HTMLElement>('div')].find(
      (el) => el.style.getPropertyValue('display') === 'none',
    )
    expect(hidden, 'no preheader element').toBeDefined()
    // The greeting is what Gmail was showing, and it says nothing.
    expect(hidden!.textContent).toContain('הפנייה שלך התקבלה')
    expect(hidden!.textContent).not.toContain('שלום דנה')
  })

  it('does not leak the preheader into the visible copy', async () => {
    const { html } = await renderAutomationEmail({
      subject: 'עדכון',
      body: BODY,
      vars: VARS,
      unsubscribeUrl: 'https://x.co/u',
    })
    const { textBlocks } = deliver(html, APPLE_MAIL)
    const visible = textBlocks.filter((b) => b.style.getPropertyValue('display') !== 'none')
    const occurrences = visible.filter((b) => (b.textContent ?? '').includes('הפנייה שלך התקבלה')).length
    expect(occurrences).toBe(1)
  })
})

describe('subject lines do not repeat the From name (UX-2)', () => {
  const subjects = [
    ...AUTOMATION_RECIPES.map((r) => r.subject),
    ...TEMPLATE_ENTRIES.flatMap((t) => t.automations.map((a) => String(a.parameters.subject ?? ''))),
  ].filter(Boolean)

  it('ships no subject ending in the business-name variable', () => {
    expect(subjects.length).toBeGreaterThan(0)
    // The From header is already `"<business name>" <address>`, so a subject
    // ending in the same token spends inbox-list characters on a word that is
    // already on screen.
    const offenders = subjects.filter((s) => /—\s*\{\{שם העסק\}\}\s*$/.test(s))
    expect(offenders).toEqual([])
  })

  it('still ships non-empty, meaningful subjects', () => {
    for (const s of subjects) expect(s.trim().length).toBeGreaterThan(3)
  })
})
