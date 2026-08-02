import { db } from '@/config/db'

/**
 * automation_email_blocks — deliverability memory: this ADDRESS hard-bounced
 * for this business. Keyed by normalized address (not lead) on purpose: when
 * the business corrects a lead's email, the new address simply doesn't match
 * the block and sends resume — no unblock mechanism needed (migration plan
 * §1.0). Insert-only, permanent, small.
 *
 * API: addEmailBlock (idempotent, normalizes), isEmailBlocked (normalizes).
 */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function addEmailBlockQuery(agencyId: number, emailNormalized: string, reason: string) {
  return db.raw(
    `
    INSERT INTO automation_email_blocks ("agencyId","emailNormalized",reason)
    VALUES (:agencyId, :emailNormalized, :reason)
    ON CONFLICT ("agencyId","emailNormalized") DO NOTHING
  `,
    { agencyId, emailNormalized, reason },
  )
}

export async function addEmailBlock(agencyId: number, email: string, reason = 'hard_bounce'): Promise<void> {
  await addEmailBlockQuery(agencyId, normalizeEmail(email), reason)
}

export function isEmailBlockedQuery(agencyId: number, emailNormalized: string) {
  return db('automation_email_blocks').select('id').where({ agencyId, emailNormalized }).first()
}

export async function isEmailBlocked(agencyId: number, email: string): Promise<boolean> {
  return Boolean(await isEmailBlockedQuery(agencyId, normalizeEmail(email)))
}
