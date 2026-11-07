/**
 * Task 13 — the durable Contact job (group A1).
 *
 * The original defect: a WhatsApp Contact produced no auto_response_jobs row at
 * all, because leadId was NOT NULL, so IRE never started and the customer got
 * no answer. A Contact must now get a real durable job with leadId = NULL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enqueueInboundAutoResponse } from '@/lib/inbox/autoresponse/enqueueInboundAutoResponse'

const enqueueAutoResponse = vi.hoisted(() => vi.fn())
const skipPendingNoResponseJobs = vi.hoisted(() => vi.fn())

vi.mock('@/db/autoResponseJobs', () => ({ enqueueAutoResponse, skipPendingNoResponseJobs }))

function settingsTrx(settings: { mode?: string; delaySeconds?: number } | undefined, trigger: { type: string; text: string } = { type: 'text', text: 'שלום, אפשר פרטים?' }) {
  const q = {
    where() {
      return this
    },
    async first() {
      return settings
    },
  }
  // The trigger message, read to keep an opt-out command unanswered (Item 3).
  const messages = {
    where() {
      return this
    },
    orderBy() {
      return this
    },
    async first() {
      return trigger
    },
  }
  return Object.assign((table: string) => {
    if (table === 'inbox_messages') return messages
    if (table !== 'auto_response_settings') throw new Error(`unexpected table ${table}`)
    return q
  }, q)
}

beforeEach(() => {
  enqueueAutoResponse.mockReset().mockResolvedValue(90)
  skipPendingNoResponseJobs.mockReset().mockResolvedValue(0)
})

describe('Task 13 A1 — an unknown Contact gets a durable job', () => {
  it('enqueues qualify_turn with leadId NULL and keeps the configured delay', async () => {
    const trx = settingsTrx({ mode: 'qualify', delaySeconds: 5 }) as never

    const result = await enqueueInboundAutoResponse(trx, {
      agencyId: 103,
      conversationId: 1290,
      leadId: null,
      triggerSequence: 1,
    })

    expect(result.jobId).toBe(90)
    expect(result.reason).toBe('qualify_turn')
    expect(result.delaySeconds).toBe(5)

    const args = enqueueAutoResponse.mock.calls[0]![1] as {
      leadId: number | null
      conversationId: number
      agencyId: number
      reason: string
    }
    // conversationId stays the durable identity; no sentinel or fake Lead id.
    expect(args.leadId).toBeNull()
    expect(args.conversationId).toBe(1290)
    expect(args.agencyId).toBe(103)
    expect(args.reason).toBe('qualify_turn')
  })

  it('acknowledge mode also supports a Contact job', async () => {
    const trx = settingsTrx({ mode: 'acknowledge', delaySeconds: 0 }) as never

    const result = await enqueueInboundAutoResponse(trx, {
      agencyId: 103,
      conversationId: 1290,
      leadId: null,
      triggerSequence: 1,
    })

    expect(result.reason).toBe('first_contact')
    expect((enqueueAutoResponse.mock.calls[0]![1] as { leadId: number | null }).leadId).toBeNull()
  })

  it('an existing Lead still enqueues with its own leadId (no regression)', async () => {
    const trx = settingsTrx({ mode: 'qualify', delaySeconds: 5 }) as never

    await enqueueInboundAutoResponse(trx, {
      agencyId: 103,
      conversationId: 1290,
      leadId: 1417,
      triggerSequence: 1,
    })

    expect((enqueueAutoResponse.mock.calls[0]![1] as { leadId: number | null }).leadId).toBe(1417)
  })

  it('pending no-response jobs are still cleared before the new job', async () => {
    const trx = settingsTrx({ mode: 'qualify', delaySeconds: 5 }) as never

    await enqueueInboundAutoResponse(trx, {
      agencyId: 103,
      conversationId: 1290,
      leadId: null,
      triggerSequence: 1,
    })

    expect(skipPendingNoResponseJobs).toHaveBeenCalledTimes(1)
    expect(skipPendingNoResponseJobs.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueAutoResponse.mock.invocationCallOrder[0],
    )
  })
})

describe('Task 13 — the migration that makes the Contact job storable', () => {
  it('drops NOT NULL on auto_response_jobs.leadId and keeps the FK', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const file = path.join(
      process.cwd(),
      'migrations/20260819233000_auto_response_jobs_leadid_nullable.cjs',
    )
    const src = fs.readFileSync(file, 'utf8')

    expect(src).toContain('ALTER TABLE auto_response_jobs')
    expect(src).toContain('ALTER COLUMN "leadId" DROP NOT NULL')
    expect(src).toContain('ALTER COLUMN "leadId" SET NOT NULL')
    // No other schema surface may be touched by this migration.
    expect(src).not.toMatch(/DROP (COLUMN|TABLE|CONSTRAINT)/i)
    expect(src).not.toMatch(/ADD COLUMN/i)
  })
})
