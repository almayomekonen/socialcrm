import { describe, it, expect, vi } from 'vitest'
import { dispatchAutomationEmail, type DispatchDeps } from '@/lib/emailAutomations/dispatch'
import type { Automation, Recipient } from '@/lib/emailAutomations/types'

const recipient: Recipient = { userId: 1, agencyId: 1, email: 'a@b.com', firstName: 'דוד' }
const now = new Date('2026-07-18T00:00:00Z')

const automation = (over: Partial<Automation> = {}): Automation => ({
  key: 'test',
  enabled: true,
  priority: 'normal',
  category: 'lifecycle',
  trigger: 'scheduled',
  subject: () => 'נושא',
  template: () => ({}) as never,
  ...over,
})

const deps = (over: Partial<DispatchDeps> = {}): DispatchDeps => ({
  enabled: true,
  isSuppressed: vi.fn(async () => false),
  claimSend: vi.fn(async () => true),
  markSent: vi.fn(async () => {}),
  releaseClaim: vi.fn(async () => {}),
  sendEmail: vi.fn(async () => ({ ok: true as const, id: 'x' })),
  renderHtml: vi.fn(async () => '<p>h</p>'),
  renderText: vi.fn(async () => 't'),
  ...over,
})

describe('dispatchAutomationEmail', () => {
  it('mocks when the system is globally disabled', async () => {
    const d = deps({ enabled: false })
    expect(await dispatchAutomationEmail(automation(), recipient, now, d)).toBe('mock')
    expect(d.claimSend).not.toHaveBeenCalled()
  })

  it('skips a disabled automation', async () => {
    expect(await dispatchAutomationEmail(automation({ enabled: false }), recipient, now, deps())).toBe('skipped')
  })

  it('suppresses a lifecycle email for an opted-out user (no claim, no send)', async () => {
    const d = deps({ isSuppressed: vi.fn(async () => true) })
    expect(await dispatchAutomationEmail(automation({ category: 'lifecycle' }), recipient, now, d)).toBe('suppressed')
    expect(d.claimSend).not.toHaveBeenCalled()
    expect(d.sendEmail).not.toHaveBeenCalled()
  })

  it('sends a transactional email even to an opted-out user', async () => {
    const d = deps({ isSuppressed: vi.fn(async () => true) })
    expect(await dispatchAutomationEmail(automation({ category: 'transactional' }), recipient, now, d)).toBe('sent')
    expect(d.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('skips when the claim is lost (already sent)', async () => {
    const d = deps({ claimSend: vi.fn(async () => false) })
    expect(await dispatchAutomationEmail(automation(), recipient, now, d)).toBe('skipped')
    expect(d.sendEmail).not.toHaveBeenCalled()
  })

  it('on success marks sent and does not release', async () => {
    const d = deps()
    expect(await dispatchAutomationEmail(automation(), recipient, now, d)).toBe('sent')
    expect(d.markSent).toHaveBeenCalledTimes(1)
    expect(d.releaseClaim).not.toHaveBeenCalled()
  })

  it('on send failure releases the claim so a retry is possible', async () => {
    const d = deps({ sendEmail: vi.fn(async () => ({ ok: false as const, error: 'boom' })) })
    expect(await dispatchAutomationEmail(automation(), recipient, now, d)).toBe('failed')
    expect(d.releaseClaim).toHaveBeenCalledTimes(1)
    expect(d.markSent).not.toHaveBeenCalled()
  })

  it('on a thrown render/send releases the claim', async () => {
    const d = deps({
      renderHtml: vi.fn(async () => {
        throw new Error('render boom')
      }),
    })
    expect(await dispatchAutomationEmail(automation(), recipient, now, d)).toBe('failed')
    expect(d.releaseClaim).toHaveBeenCalledTimes(1)
  })
})
