import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  unansweredInboundFromLatest,
  enqueueInboundAutoResponse,
  findLatestUnansweredInbound,
} from '@/lib/inbox/autoresponse/enqueueInboundAutoResponse'

const enqueueAutoResponse = vi.hoisted(() => vi.fn())
const skipPendingNoResponseJobs = vi.hoisted(() => vi.fn())

vi.mock('@/db/autoResponseJobs', () => ({
  enqueueAutoResponse,
  skipPendingNoResponseJobs,
}))

function messagesTrx(row: { id: number; direction: string; sequence: number } | undefined) {
  const q = {
    where() {
      return this
    },
    orderBy() {
      return this
    },
    async first() {
      return row
    },
  }
  return Object.assign((table: string) => {
    if (table !== 'inbox_messages') throw new Error(`unexpected table ${table}`)
    return q
  }, q)
}

function settingsTrx(settings: { mode?: string; delaySeconds?: number } | undefined) {
  const q = {
    where() {
      return this
    },
    async first() {
      return settings
    },
  }
  return Object.assign((table: string) => {
    if (table !== 'auto_response_settings') throw new Error(`unexpected table ${table}`)
    return q
  }, q)
}

describe('unanswered inbound detection', () => {
  it('no messages → no IRE', () => {
    expect(unansweredInboundFromLatest(null)).toBeNull()
    expect(unansweredInboundFromLatest(undefined)).toBeNull()
  })

  it('latest inbound is eligible', () => {
    expect(unansweredInboundFromLatest({ id: 364, direction: 'inbound', sequence: 2 })).toEqual({
      id: 364,
      sequence: 2,
    })
  })

  it('multiple inbounds collapse to the latest sequence', () => {
    const latest = unansweredInboundFromLatest({ id: 364, direction: 'inbound', sequence: 2 })
    expect(latest?.sequence).toBe(2)
    expect(latest?.id).toBe(364)
  })

  it('outbound after inbound → no IRE', () => {
    expect(unansweredInboundFromLatest({ id: 365, direction: 'outbound', sequence: 3 })).toBeNull()
  })
})

describe('findLatestUnansweredInbound', () => {
  it('reads the latest message and ignores earlier inbounds', async () => {
    const trx = messagesTrx({ id: 364, direction: 'inbound', sequence: 2 })
    await expect(findLatestUnansweredInbound(trx as never, 371)).resolves.toEqual({ id: 364, sequence: 2 })
    expect(trx.orderBy).toBeDefined()
  })

  it('returns null when the latest message is outbound', async () => {
    const trx = messagesTrx({ id: 365, direction: 'outbound', sequence: 3 })
    await expect(findLatestUnansweredInbound(trx as never, 371)).resolves.toBeNull()
  })
})

describe('enqueueInboundAutoResponse — existing ingest path', () => {
  beforeEach(() => {
    enqueueAutoResponse.mockReset()
    enqueueAutoResponse.mockResolvedValue(51)
    skipPendingNoResponseJobs.mockReset().mockResolvedValue(0)
  })

  it('qualify mode uses qualify_turn and preserves delaySeconds=5', async () => {
    const trx = settingsTrx({ mode: 'qualify', delaySeconds: 5 })
    const result = await enqueueInboundAutoResponse(trx as never, {
      agencyId: 103,
      conversationId: 371,
      leadId: 1416,
      triggerSequence: 2,
    })
    expect(result).toEqual({ jobId: 51, reason: 'qualify_turn', delaySeconds: 5 })
    expect(enqueueAutoResponse).toHaveBeenCalledTimes(1)
    expect(enqueueAutoResponse).toHaveBeenCalledWith(
      trx,
      expect.objectContaining({
        agencyId: 103,
        conversationId: 371,
        leadId: 1416,
        channel: 'whatsapp',
        triggerSequence: 2,
        reason: 'qualify_turn',
        delaySeconds: 5,
      }),
    )
  })

  it('acknowledge mode keeps first_contact', async () => {
    const trx = settingsTrx({ mode: 'acknowledge', delaySeconds: 0 })
    const result = await enqueueInboundAutoResponse(trx as never, {
      agencyId: 103,
      conversationId: 9,
      leadId: 12,
      triggerSequence: 1,
    })
    expect(result.reason).toBe('first_contact')
    expect(result.delaySeconds).toBe(0)
  })

  it('existing enqueueAutoResponse returning null is not a second job', async () => {
    enqueueAutoResponse.mockResolvedValue(null)
    const trx = settingsTrx({ mode: 'qualify', delaySeconds: 5 })
    const result = await enqueueInboundAutoResponse(trx as never, {
      agencyId: 103,
      conversationId: 371,
      leadId: 1416,
      triggerSequence: 2,
    })
    expect(result.jobId).toBeNull()
    expect(enqueueAutoResponse).toHaveBeenCalledTimes(1)
  })

  it('skips pending no-response jobs in the same transaction before qualify_turn', async () => {
    skipPendingNoResponseJobs.mockImplementation(async () => {
      expect(enqueueAutoResponse).not.toHaveBeenCalled()
      return 1
    })
    const trx = settingsTrx({ mode: 'qualify', delaySeconds: 5 })
    await enqueueInboundAutoResponse(trx as never, {
      agencyId: 103,
      conversationId: 371,
      leadId: 1416,
      triggerSequence: 2,
    })
    expect(skipPendingNoResponseJobs).toHaveBeenCalledWith(trx, 371)
    expect(skipPendingNoResponseJobs.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueAutoResponse.mock.invocationCallOrder[0],
    )
  })
})
