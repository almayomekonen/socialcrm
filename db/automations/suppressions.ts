import { db } from '@/config/db'

/**
 * automation_lead_suppressions — consent memory (ADR-003): the lead
 * unsubscribed from this business's automated email. Insert-only, permanent,
 * per-business (never cross-tenant). NEVER the platform's userId-keyed
 * email_suppressions — the two domains' consent must not interact (spec §0).
 *
 * API: addLeadSuppression (idempotent), isLeadSuppressed.
 */

export function addLeadSuppressionQuery(agencyId: number, leadId: number, source: string) {
  return db.raw(
    `
    INSERT INTO automation_lead_suppressions ("agencyId","leadId",source)
    VALUES (:agencyId, :leadId, :source)
    ON CONFLICT ("agencyId","leadId") DO NOTHING
  `,
    { agencyId, leadId, source },
  )
}

export async function addLeadSuppression(
  agencyId: number,
  leadId: number,
  source = 'unsubscribe_link',
): Promise<void> {
  await addLeadSuppressionQuery(agencyId, leadId, source)
}

export function isLeadSuppressedQuery(agencyId: number, leadId: number) {
  return db('automation_lead_suppressions').select('id').where({ agencyId, leadId }).first()
}

export async function isLeadSuppressed(agencyId: number, leadId: number): Promise<boolean> {
  return Boolean(await isLeadSuppressedQuery(agencyId, leadId))
}
