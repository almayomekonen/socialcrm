import { describe, expect, it, vi } from 'vitest'
import { emailExecutor } from '@/lib/automations/executors/email'
import type { EmailDeps } from '@/lib/automations/executors/email'
import type { ExecutionContext } from '@/lib/automations/executors/types'

/**
 * B5 — `email.send` as an ordinary executor.
 *
 * Every string asserted here was previously produced by the worker: the
 * dead-reason format, the two log transitions, the log classification, the
 * send arguments and the activity summary. Pinning them is how "byte-identical
 * behaviour" stops being a claim and becomes a test.
 */

const ctx = (over: Partial<ExecutionContext> = {}): ExecutionContext => ({
  agencyId: 7,
  automationId: 3,
  leadId: 42,
  mode: 'log',
  subject: { leadFirstName: 'דנה', businessName: null, repName: null },
  recipients: { email: 'dana@example.com' },
  parameters: { subject: 'שלום {{שם הליד}}', body: 'תודה מ{{שם העסק}}' },
  ...over,
})

const deps = (over: Partial<EmailDeps> = {}): EmailDeps => ({
  agencyName: vi.fn(async () => 'העסק שלי'),
  replyTo: vi.fn(async () => 'owner@business.example'),
  repName: vi.fn(async () => null),
  from: () => 'bot@mail.example',
  send: vi.fn(async () => ({ ok: true as const, id: 'msg_1' })),
  ...over,
})

/**
 * B6b: the sending address is one of the executor's OWN dependencies, so a
 * test overrides it directly instead of reaching into process.env.
 */
const withFrom = async <T>(from: string, run: (d: EmailDeps) => Promise<T>, over: Partial<EmailDeps> = {}): Promise<T> =>
  run(deps({ from: () => from, ...over }))

describe('preflight — identity, resolved before the claim', () => {
  it('resolves a complete identity', async () => {
    const res = await withFrom('bot@mail.example', (d) => emailExecutor.preflight(ctx(), d))
    expect(res.problem).toBe(null)
    expect(res.ready?.identity?.replyTo).toBe('owner@business.example')
    expect(res.ready?.businessName).toBe('העסק שלי')
  })

  it('reports a missing sending domain with the worker’s exact strings', async () => {
    const res = await withFrom('', (d) => emailExecutor.preflight(ctx(), d))
    expect(res.problem).toEqual({
      reason: 'no_sending_domain',
      deadReason: 'identity_unavailable:no_sending_domain',
      warnTransition: 'identity_incomplete',
      logClass: 'identity',
    })
  })

  it('reports a missing reply-to the same way', async () => {
    const res = await withFrom('bot@mail.example', (d) => emailExecutor.preflight(ctx(), d), {
      replyTo: vi.fn(async () => null),
    })
    expect(res.problem?.deadReason).toBe('identity_unavailable:no_reply_to')
  })

  it('still hands back what it has, so log mode can render a truthful preview', async () => {
    const res = await withFrom('', (d) => emailExecutor.preflight(ctx(), d))
    expect(res.ready).not.toBe(null)
    expect(res.ready?.identity).toBe(null)
    expect(res.ready?.businessName).toBe('העסק שלי')
  })
})

describe('execute — log mode', () => {
  it('renders from the ACTION PARAMETERS and never touches the transport', async () => {
    const d = deps()
    const out = await emailExecutor.execute(ctx(), { identity: null, businessName: 'העסק שלי' }, d)
    expect(d.send).not.toHaveBeenCalled()
    expect(out).toMatchObject({
      kind: 'would_send',
      summary: 'שלום דנה',
      log: { reason: 'log_mode', subject: 'שלום דנה' },
    })
  })

  it('a missing first name degrades gracefully rather than leaving a token', async () => {
    const out = await emailExecutor.execute(
      ctx({ subject: { leadFirstName: null }, recipients: { email: 'x@y.example' } }),
      { identity: null, businessName: 'העסק שלי' },
      deps(),
    )
    expect(out.summary).toBe('שלום')
  })
})

describe('execute — live mode', () => {
  const identity = { from: '"העסק שלי" <bot@mail.example>', displayName: 'העסק שלי', replyTo: 'owner@business.example' }

  it('sends with the resolved identity and reports the provider id', async () => {
    const d = deps()
    const out = await emailExecutor.execute(ctx({ mode: 'live' }), { identity, businessName: 'העסק שלי' }, d)
    const sent = (d.send as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(sent).toMatchObject({
      from: identity.from,
      replyTo: identity.replyTo,
      to: 'dana@example.com',
      subject: 'שלום דנה',
    })
    expect(sent.html).toContain('תודה מהעסק שלי')
    expect(out).toMatchObject({
      kind: 'sent',
      summary: 'שלום דנה',
      deliveryState: 'sent',
      providerMessageId: 'msg_1',
      log: { reason: 'transport_accepted', providerMessageId: 'msg_1' },
    })
  })

  it('a transport failure THROWS, so the worker releases the claim and retries', async () => {
    const d = deps({ send: vi.fn(async () => ({ ok: false as const, error: 'rate_limited' })) })
    await expect(emailExecutor.execute(ctx({ mode: 'live' }), { identity, businessName: 'העסק שלי' }, d)).rejects.toThrow(
      'transport: rate_limited',
    )
  })

  it('live mode WITHOUT a resolved identity degrades to would_send, never a blind send', async () => {
    const d = deps()
    const out = await emailExecutor.execute(ctx({ mode: 'live' }), { identity: null, businessName: 'העסק' }, d)
    expect(d.send).not.toHaveBeenCalled()
    expect(out.kind).toBe('would_send')
  })

  it('the signature and the From display name are the same resolved value', async () => {
    const d = deps()
    await emailExecutor.execute(
      ctx({ mode: 'live' }),
      { identity: { ...identity, displayName: 'שם מהזהות' }, businessName: 'שם אחר לגמרי' },
      d,
    )
    const sent = (d.send as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(sent.html).toContain('שם מהזהות')
    expect(sent.html).not.toContain('שם אחר לגמרי')
  })
})
