import { beforeEach, describe, expect, it, vi } from 'vitest'

const recordAccountRestriction = vi.hoisted(() => vi.fn())
const deadLetterAutoResponseJob = vi.hoisted(() => vi.fn())
const failAutoResponseJob = vi.hoisted(() => vi.fn())

vi.mock('@/lib/inbox/recordAccountRestriction', () => ({ recordAccountRestriction }))
vi.mock('@/db/autoResponseJobs', () => ({
  deadLetterAutoResponseJob,
  failAutoResponseJob,
}))

import {
  applyIreWhatsappSendFailure,
  onWhatsappSendFailure,
} from '@/lib/inbox/onWhatsappSendFailure'
import { mapWhatsappError } from '@/lib/inbox/whatsappErrorCopy'

const CTX = {
  agencyId: 23,
  leadId: 9,
  businessPhoneNumberId: 'P1',
  customerWaId: '972500000000',
  customerName: null as string | null,
  sentByUserId: 1,
  text: 'שלום',
}

beforeEach(() => {
  recordAccountRestriction.mockReset()
  recordAccountRestriction.mockResolvedValue(undefined)
  deadLetterAutoResponseJob.mockReset()
  deadLetterAutoResponseJob.mockResolvedValue(undefined)
  failAutoResponseJob.mockReset()
  failAutoResponseJob.mockResolvedValue(undefined)
})

describe('onWhatsappSendFailure — classify once, record only account', () => {
  it('131031 / 131042 / 131049 / 141006 → account + recordAccountRestriction', async () => {
    for (const code of [131031, 131042, 131049, 141006]) {
      recordAccountRestriction.mockClear()
      const res = await onWhatsappSendFailure({ code, httpStatus: 400 }, CTX)
      expect(res.category).toBe('account')
      expect(res.text).toBe(mapWhatsappError(131031).text)
      expect(recordAccountRestriction).toHaveBeenCalledTimes(1)
      expect(recordAccountRestriction).toHaveBeenCalledWith({
        agencyId: 23,
        leadId: 9,
        businessPhoneNumberId: 'P1',
        customerWaId: '972500000000',
        customerName: null,
        sentByUserId: 1,
        text: 'שלום',
      })
    }
  })

  it('131047 / recipient / generic → do NOT record', async () => {
    for (const code of [131047, 131026, 999999, null]) {
      recordAccountRestriction.mockClear()
      const res = await onWhatsappSendFailure({ code, httpStatus: 400 }, CTX)
      expect(res.category).not.toBe('account')
      expect(recordAccountRestriction).not.toHaveBeenCalled()
    }
  })

  it('token 401 / 190 must NOT become account restricted', async () => {
    const unauthorized = await onWhatsappSendFailure({ httpStatus: 401 }, CTX)
    expect(unauthorized.category).toBe('generic')
    expect(recordAccountRestriction).not.toHaveBeenCalled()

    const expired = await onWhatsappSendFailure({ code: 190, httpStatus: 400 }, CTX)
    expect(expired.category).toBe('generic')
    expect(recordAccountRestriction).not.toHaveBeenCalled()

    // 401 wins even if the body happens to carry an account code.
    const mixed = await onWhatsappSendFailure({ code: 131031, httpStatus: 401 }, CTX)
    expect(mixed.category).toBe('generic')
    expect(recordAccountRestriction).not.toHaveBeenCalled()
  })

  it('records with the server-provided agency + phone only', async () => {
    await onWhatsappSendFailure({ code: '131031' }, { ...CTX, agencyId: 7, businessPhoneNumberId: 'OTHER' })
    expect(recordAccountRestriction).toHaveBeenCalledWith(
      expect.objectContaining({ agencyId: 7, businessPhoneNumberId: 'OTHER' }),
    )
  })
})

describe('applyIreWhatsappSendFailure — account is dead, others retry', () => {
  // The running worker's id travels with the job: both writes are owner-checked.
  const job = { id: 44, agencyId: 23, conversationId: 55, leadId: 9, ownerWorkerId: 'w-1' }
  const ctx = {
    businessPhoneNumberId: 'P1',
    customerWaId: '972500000000',
    customerName: null as string | null,
    sentByUserId: 1,
    text: 'שלום',
  }

  it('131031 records restriction and dead-letters — no retry', async () => {
    const res = await applyIreWhatsappSendFailure(
      job,
      { ok: false, error: 'restricted', code: '131031', httpStatus: 400 },
      ctx,
    )
    expect(res.category).toBe('account')
    expect(recordAccountRestriction).toHaveBeenCalledTimes(1)
    expect(deadLetterAutoResponseJob).toHaveBeenCalledWith(44, expect.stringContaining('code=131031'), 'w-1')
    expect(failAutoResponseJob).not.toHaveBeenCalled()
  })

  it('131047 does not record and retries via failAutoResponseJob', async () => {
    const res = await applyIreWhatsappSendFailure(
      job,
      { ok: false, error: 'window', code: '131047', httpStatus: 400 },
      ctx,
    )
    expect(res.category).toBe('window_expired')
    expect(recordAccountRestriction).not.toHaveBeenCalled()
    expect(failAutoResponseJob).toHaveBeenCalledWith(44, expect.stringContaining('code=131047'), 'w-1')
    expect(deadLetterAutoResponseJob).not.toHaveBeenCalled()
  })
})
