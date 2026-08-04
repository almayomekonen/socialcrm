import { describe, expect, it, vi } from 'vitest'
import { emailExecutor, type EmailDeps } from '@/lib/automations/executors/email'
import { APPLE_MAIL, deliver } from './support/mailClients'

/**
 * PREVIEW/SEND PARITY.
 *
 * The Builder used to draw its own approximation of the email — the body as one
 * app-styled paragraph, no footer, no unsubscribe, and a placeholder business
 * name because it passed nulls. `variables.ts` claimed preview and send "share
 * ONE implementation"; they shared SUBSTITUTION, not RENDERING. A signature with
 * three run-together business names reached real inboxes through that gap.
 *
 * So parity is not a claim to be re-made in a comment: what the preview shows and
 * what the transport carries must be the same bytes.
 */

const PARAMETERS = {
  subject: 'עדכון מ{{שם העסק}}',
  body: 'שלום {{שם הליד}},\n\nהפנייה שלך בטיפול.\n\nבברכה,\n{{שם העסק}}',
  ctaLabel: 'לקביעת שיחה',
  ctaUrl: 'https://example.co.il/book',
}

const deps = (over: Partial<EmailDeps> = {}): EmailDeps => ({
  agencyName: vi.fn(async () => 'סטודיו אור'),
  replyTo: vi.fn(async () => 'owner@business.example'),
  repName: vi.fn(async () => null),
  from: () => 'bot@mail.example',
  send: vi.fn(async () => ({ ok: true as const, id: 'msg_1' })),
  ...over,
})

/** The html the transport actually received for a test send. */
async function sentHtml(parameters: Record<string, unknown>): Promise<string> {
  const send = vi.fn(async () => ({ ok: true as const, id: 'msg_1' }))
  const res = await emailExecutor.test!(
    parameters,
    { agencyId: 7, toName: 'דנה', address: 'dana@example.com' },
    deps({ send }),
  )
  expect(res.ok).toBe(true)
  return ((send as ReturnType<typeof vi.fn>).mock.calls[0][0] as { html: string }).html
}

async function previewHtml(parameters: Record<string, unknown>): Promise<string> {
  const res = await emailExecutor.preview!(parameters, { agencyId: 7, toName: 'דנה' }, deps())
  if (res.ok === false) throw new Error(`preview failed: ${res.reason}`)
  return res.html
}

describe('the Builder preview IS the email', () => {
  it('renders byte-identical html to what the transport carries', async () => {
    expect(await previewHtml(PARAMETERS)).toBe(await sentHtml(PARAMETERS))
  })

  it('is identical with no CTA block too', async () => {
    const withoutCta = { subject: PARAMETERS.subject, body: PARAMETERS.body }
    expect(await previewHtml(withoutCta)).toBe(await sentHtml(withoutCta))
  })

  it('shows the REAL business name, not the "העסק" placeholder', async () => {
    const res = await emailExecutor.preview!(PARAMETERS, { agencyId: 7, toName: 'דנה' }, deps())
    if (res.ok === false) throw new Error(res.reason)
    expect(res.fromName).toBe('סטודיו אור')
    expect(res.subjectLine).toBe('עדכון מסטודיו אור')
    // Assert at the substitution site rather than anywhere in the document: the
    // shell's own `<title>` legitimately contains the word העסק.
    const { root } = deliver(res.html, APPLE_MAIL)
    expect(root.textContent).toContain('הודעה זו נשלחה מטעם סטודיו אור')
    expect(root.textContent).not.toContain('מטעם העסק')
  })

  it('previews the footer and unsubscribe the old preview omitted entirely', async () => {
    const { root } = deliver(await previewHtml(PARAMETERS), APPLE_MAIL)
    expect(root.textContent).toContain('הודעה זו נשלחה מטעם')
    expect(root.querySelector('a[href*="unsubscribe"]')).not.toBeNull()
  })

  it('still renders when the identity is incomplete, so content stays visible', async () => {
    // A missing reply-to is a configuration fault with its own surface; blanking
    // the pane would hide the copy the customer is editing.
    const res = await emailExecutor.preview!(PARAMETERS, { agencyId: 7, toName: 'דנה' }, deps({ replyTo: async () => null }))
    if (res.ok === false) throw new Error(res.reason)
    expect(res.html).toContain('הפנייה שלך בטיפול')
    expect(res.fromName).toBe('סטודיו אור')
  })

  it('never points the preview unsubscribe at a real lead', async () => {
    const html = await previewHtml(PARAMETERS)
    // Lead 0, which no lead can ever be — clicking a preview link must not
    // suppress anyone.
    expect(html).toMatch(/l=0&/)
  })
})
