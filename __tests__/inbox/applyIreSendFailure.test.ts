import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * applyIreWhatsappSendFailure decides an IRE job's next state after a failed
 * send. An UNKNOWN outcome must end the job without any reset, whatever the
 * caller does next; a definite refusal still retries; an account block is dead.
 */

const h = vi.hoisted(() => ({
  fail: vi.fn(async () => undefined),
  dead: vi.fn(async () => undefined),
  park: vi.fn(async () => undefined),
  restriction: vi.fn(async () => undefined),
}))
vi.mock('@/db/autoResponseJobs', () => ({ failAutoResponseJob: h.fail, deadLetterAutoResponseJob: h.dead }))
vi.mock('@/lib/inbox/autoresponse/ambiguousSend', () => ({ parkAmbiguousSend: h.park }))
vi.mock('@/lib/inbox/recordAccountRestriction', () => ({ recordAccountRestriction: h.restriction }))

const { applyIreWhatsappSendFailure } = await import('@/lib/inbox/onWhatsappSendFailure')
const { boundedSend } = await import('@/lib/inbox/autoresponse/jobLease')
const { AUTOMATED_SEND_TIMEOUT_MS } = await import('@/lib/whatsapp/sendOutcome')

const job = { id: 11, agencyId: 7, conversationId: 21, leadId: 31 }
const ctx = { businessPhoneNumberId: 'pn', customerWaId: '972501234567', customerName: null, sentByUserId: null, text: 'שלום' }

beforeEach(() => {
  for (const f of Object.values(h)) f.mockClear()
})

describe('applyIreWhatsappSendFailure', () => {
  it('an ambiguous outcome parks the job and NEVER resets it for a retry', async () => {
    await applyIreWhatsappSendFailure(job, { ok: false, error: 'send-timeout', ambiguous: true }, ctx)
    expect(h.park).toHaveBeenCalledWith(job, expect.stringContaining('send-timeout'))
    expect(h.fail).not.toHaveBeenCalled()
    expect(h.dead).not.toHaveBeenCalled()
    expect(h.restriction).not.toHaveBeenCalled()
  })

  it('a definite Graph refusal (nothing delivered) stays retryable', async () => {
    await applyIreWhatsappSendFailure(job, { ok: false, error: 'Invalid parameter', code: '100', httpStatus: 400 }, ctx)
    expect(h.fail).toHaveBeenCalledWith(11, expect.any(String))
    expect(h.park).not.toHaveBeenCalled()
  })

  it('an account block is still dead at once', async () => {
    await applyIreWhatsappSendFailure(job, { ok: false, error: 'restricted', code: '131031', httpStatus: 400 }, ctx)
    expect(h.dead).toHaveBeenCalledWith(11, expect.any(String))
    expect(h.fail).not.toHaveBeenCalled()
    expect(h.park).not.toHaveBeenCalled()
  })
})

describe('boundedSend', () => {
  it('gives an unbounded send the automated deadline', async () => {
    const send = vi.fn(async (a: { timeoutMs?: number }) => a)
    await boundedSend(send)({})
    expect(send).toHaveBeenCalledWith({ timeoutMs: AUTOMATED_SEND_TIMEOUT_MS })
  })

  it("keeps the caller's own deadline", async () => {
    const send = vi.fn(async (a: { timeoutMs?: number }) => a)
    await boundedSend(send)({ timeoutMs: 20_000 })
    expect(send).toHaveBeenCalledWith({ timeoutMs: 20_000 })
  })
})
