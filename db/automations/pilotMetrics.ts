import { db } from '@/config/db'

/**
 * Internal pilot metrics (ADR-014 §Monitoring) — the numbers we watch while
 * the engine is in observation and, later, early live.
 *
 * DELIBERATELY AGENCY-SCOPED. A cross-tenant view would be more convenient
 * for us and would introduce the one thing this codebase never does: a read
 * path that ignores agencyId. Tenant isolation is a protected invariant
 * (lead-isolation tests, every db module); breaking it for an internal
 * convenience would need its own ADR. During the pilot we read one agency at
 * a time — which is exactly the pilot's size.
 */

export type PilotMetrics = {
  windowDays: number
  observation: { wouldSend: number; sent: number; skipped: number; failed: number }
  skipReasons: Array<{ reason: string; count: number }>
  identityFailures: Array<{ problem: string; count: number }>
  delivery: { sent: number; delivered: number; bounced: number; failed: number }
  bounces: number
  blockedAddresses: number
  suppressions: { total: number; unsubscribe: number; complaint: number }
  queue: { pending: number; processing: number; dead: number; oldestPendingAt: string | null }
}

const num = (v: unknown) => Number(v ?? 0)

export async function getPilotMetrics(agencyId: number, windowDays = 30): Promise<PilotMetrics> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

  const [kinds, skips, delivery, blocks, suppressions, queue, oldest] = await Promise.all([
    db('automation_activity')
      .select('kind')
      .count<{ kind: string; c: string }[]>({ c: '*' })
      .where({ agencyId })
      .where('occurredAt', '>=', since)
      .groupBy('kind'),

    db('automation_activity')
      .select('skipReason')
      .count<{ skipReason: string | null; c: string }[]>({ c: '*' })
      .where({ agencyId, kind: 'skipped' })
      .where('occurredAt', '>=', since)
      .whereNotNull('skipReason')
      .groupBy('skipReason')
      .orderBy('c', 'desc'),

    db('automation_activity')
      .select('deliveryState')
      .count<{ deliveryState: string | null; c: string }[]>({ c: '*' })
      .where({ agencyId })
      .where('occurredAt', '>=', since)
      .whereNotNull('deliveryState')
      .groupBy('deliveryState'),

    db('automation_email_blocks').count<{ c: string }[]>({ c: '*' }).where({ agencyId }),

    db('automation_lead_suppressions')
      .select('source')
      .count<{ source: string; c: string }[]>({ c: '*' })
      .where({ agencyId })
      .groupBy('source'),

    db('automation_jobs')
      .select('status')
      .count<{ status: string; c: string }[]>({ c: '*' })
      .where({ agencyId })
      .groupBy('status'),

    db('automation_jobs').min<{ min: Date | null }[]>({ min: 'notBefore' }).where({ agencyId, status: 'pending' }),
  ])

  // Identity failures are recorded on the dead job's lastError (and mirrored
  // onto the activity row's reason) — ADR-013's configuration-fault class.
  const identityRows = (await db('automation_jobs')
    .select('lastError')
    .count<{ lastError: string; c: string }[]>({ c: '*' })
    .where({ agencyId, status: 'dead' })
    .whereLike('lastError', 'identity_unavailable:%')
    .groupBy('lastError')) as Array<{ lastError: string; c: string }>

  const byKind = (k: string) => num(kinds.find((r) => r.kind === k)?.c)
  const byDelivery = (s: string) => num(delivery.find((r) => r.deliveryState === s)?.c)
  const bySource = (s: string) => num(suppressions.find((r) => r.source === s)?.c)
  const byStatus = (s: string) => num(queue.find((r) => r.status === s)?.c)

  return {
    windowDays,
    observation: {
      wouldSend: byKind('would_send'),
      sent: byKind('sent'),
      skipped: byKind('skipped'),
      failed: byKind('failed'),
    },
    skipReasons: skips.map((r) => ({ reason: String(r.skipReason), count: num(r.c) })),
    identityFailures: identityRows.map((r) => ({
      problem: String(r.lastError).replace('identity_unavailable:', ''),
      count: num(r.c),
    })),
    delivery: {
      sent: byDelivery('sent'),
      delivered: byDelivery('delivered'),
      bounced: byDelivery('bounced'),
      failed: byDelivery('failed'),
    },
    bounces: byDelivery('bounced'),
    blockedAddresses: num(blocks[0]?.c),
    suppressions: {
      total: suppressions.reduce((sum, r) => sum + num(r.c), 0),
      unsubscribe: bySource('unsubscribe_link'),
      complaint: bySource('spam_complaint'),
    },
    queue: {
      pending: byStatus('pending'),
      processing: byStatus('processing'),
      dead: byStatus('dead'),
      oldestPendingAt: oldest[0]?.min ? new Date(oldest[0].min).toISOString() : null,
    },
  }
}
