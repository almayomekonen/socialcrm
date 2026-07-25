/**
 * trial.started event email — registry wiring, event routing, dedup, and the
 * transactional/never-throws guarantees. Fully DB-free: exercises the REAL
 * registry automation and the REAL dispatcher via injected I/O deps (the same
 * pattern as dispatch.test.ts). No email is ever sent; sendEmail is a spy.
 */
import { describe, it, expect, vi } from 'vitest'
import { AUTOMATIONS } from '@/lib/emailAutomations/registry'
import { dispatchAutomationEmail, type DispatchDeps } from '@/lib/emailAutomations/dispatch'
import { renderEmail } from '@/lib/email/render'
import type { Automation, Recipient } from '@/lib/emailAutomations/types'

const recipient: Recipient = { userId: 7, agencyId: 3, email: 'activator@example.com', firstName: 'דוד' }
const now = new Date('2026-07-25T09:00:00Z')

const trialStarted = AUTOMATIONS.find((a) => a.key === 'trial_started') as Automation
const welcome = AUTOMATIONS.find((a) => a.key === 'welcome') as Automation

// The exact filter dispatchLifecycleEvent(event, …) applies to AUTOMATIONS.
const eventAutomations = (event: NonNullable<Automation['event']>) =>
  AUTOMATIONS.filter((a) => a.enabled && a.trigger === 'event' && a.event === event)

const deps = (over: Partial<DispatchDeps> = {}): DispatchDeps => ({
  enabled: true,
  isSuppressed: vi.fn(async () => false),
  lifecycleCooldownActive: vi.fn(async () => false),
  claimSend: vi.fn(async () => true),
  markSent: vi.fn(async () => {}),
  releaseClaim: vi.fn(async () => {}),
  sendEmail: vi.fn(async () => ({ ok: true as const, id: 'mid' })),
  renderHtml: vi.fn(async () => '<p>h</p>'),
  renderText: vi.fn(async () => 't'),
  ...over,
})

describe('trial.started registry wiring', () => {
  it('is a transactional, send-once event automation for trial.started', () => {
    expect(trialStarted).toBeTruthy()
    expect(trialStarted.trigger).toBe('event')
    expect(trialStarted.event).toBe('trial.started')
    expect(trialStarted.category).toBe('transactional')
    expect(trialStarted.enabled).toBe(true)
    expect(trialStarted.recurring).toBeUndefined() // send-once ⇒ periodKey ''
  })

  it('subject matches the approved activation-confirmation copy', () => {
    expect(trialStarted.subject(recipient)).toBe('ה־SocialCRM Pro שלך פעיל 🚀')
  })

  it('renders a greeting to the recipient and the Pro-trial copy', async () => {
    const html = await renderEmail(trialStarted.template(recipient))
    expect(html).toContain('דוד') // greet uses the activator's first name
    expect(html).toContain('ברוך הבא ל־SocialCRM Pro')
    expect(html).toContain('7 ימי ה־Pro שלך התחילו עכשיו')
    expect(html).toContain('כניסה ל־SocialCRM') // CTA label
  })

  it('wraps the mixed Hebrew+Latin CTA label in an RTL embedding (bidi fix)', async () => {
    // The label carries its own direction (RLE … PDF) so the mixed Hebrew+Latin
    // CTA renders naturally as "כניסה ל־SocialCRM" even where the email client
    // does not honor an inherited dir on the button.
    const RLE = String.fromCharCode(0x202b)
    const PDF = String.fromCharCode(0x202c)
    const html = await renderEmail(trialStarted.template(recipient))
    expect(html).toContain(`${RLE}כניסה ל־SocialCRM${PDF}`)
  })
})

describe('event routing isolation (regression guard for existing emails)', () => {
  it('trial.started resolves to exactly the trial_started automation', () => {
    const matched = eventAutomations('trial.started')
    expect(matched.map((a) => a.key)).toEqual(['trial_started'])
  })

  it('user.registered still resolves to welcome only — trial_started is not pulled in', () => {
    const matched = eventAutomations('user.registered')
    expect(matched.map((a) => a.key)).toEqual(['welcome'])
    expect(matched).not.toContain(trialStarted)
  })

  it('the welcome automation is unchanged (transactional user.registered event)', () => {
    expect(welcome.trigger).toBe('event')
    expect(welcome.event).toBe('user.registered')
    expect(welcome.category).toBe('transactional')
  })
})

describe('trial.started dedup + delivery via the real dispatcher', () => {
  it('claims once, sends once, marks sent', async () => {
    const d = deps()
    expect(await dispatchAutomationEmail(trialStarted, recipient, now, d)).toBe('sent')
    expect(d.claimSend).toHaveBeenCalledTimes(1)
    expect((d.claimSend as any).mock.calls[0][0]).toMatchObject({
      automationKey: 'trial_started',
      userId: 7,
      periodKey: '', // send-once
    })
    expect(d.sendEmail).toHaveBeenCalledTimes(1)
    expect((d.sendEmail as any).mock.calls[0][0].to).toBe('activator@example.com')
    expect(d.markSent).toHaveBeenCalledTimes(1)
    expect(d.releaseClaim).not.toHaveBeenCalled()
  })

  it('a lost claim (already delivered) skips without sending', async () => {
    const d = deps({ claimSend: vi.fn(async () => false) })
    expect(await dispatchAutomationEmail(trialStarted, recipient, now, d)).toBe('skipped')
    expect(d.sendEmail).not.toHaveBeenCalled()
  })

  it('duplicate/concurrent activation produces exactly ONE delivery (claim is the lock)', async () => {
    // Model the DB unique index: the first claim wins, every later claim loses.
    let claimed = false
    const claimSend = vi.fn(async () => {
      if (claimed) return false
      claimed = true
      return true
    })
    const sendEmail = vi.fn(async () => ({ ok: true as const, id: 'mid' }))
    const d = deps({ claimSend, sendEmail })

    const results = await Promise.all([
      dispatchAutomationEmail(trialStarted, recipient, now, d),
      dispatchAutomationEmail(trialStarted, recipient, now, d),
    ])

    expect(results.filter((r) => r === 'sent')).toHaveLength(1)
    expect(results.filter((r) => r === 'skipped')).toHaveLength(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('is transactional: ignores suppression and the lifecycle cooldown', async () => {
    const d = deps({
      isSuppressed: vi.fn(async () => true),
      lifecycleCooldownActive: vi.fn(async () => true),
    })
    expect(await dispatchAutomationEmail(trialStarted, recipient, now, d)).toBe('sent')
    expect(d.isSuppressed).not.toHaveBeenCalled()
    expect(d.lifecycleCooldownActive).not.toHaveBeenCalled()
    expect(d.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('a send failure releases the claim and never throws (activation cannot be affected)', async () => {
    const d = deps({ sendEmail: vi.fn(async () => ({ ok: false as const, error: 'boom' })) })
    await expect(dispatchAutomationEmail(trialStarted, recipient, now, d)).resolves.toBe('failed')
    expect(d.releaseClaim).toHaveBeenCalledTimes(1)
    expect(d.markSent).not.toHaveBeenCalled()
  })
})
