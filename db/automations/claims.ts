import { db } from '@/config/db'

/**
 * automation_send_claims — the once-per-lead-per-automation memory (ADR-005),
 * consumed by evaluation in BOTH live and log modes (ADR-009: observation
 * consumes eligibility). Claim-before-send: claim → send → confirm, release
 * on transport failure so a retry may re-claim. Rows are permanent once
 * confirmed — they define "ever".
 *
 * API: claimSendOnce (conflict-ignore insert; true = we own the allowance),
 * confirmSendClaim, releaseSendClaim, hasSendClaim. Builders exported for
 * `.toSQL()` shape tests.
 */

export function claimSendOnceQuery(args: {
  agencyId: number
  automationId: number
  leadId: number
  mode: 'live' | 'log'
}) {
  return db.raw(
    `
    INSERT INTO automation_send_claims ("agencyId","automationId","leadId",semantics,mode,status)
    VALUES (:agencyId, :automationId, :leadId, 'ever', :mode, 'claimed')
    ON CONFLICT ("automationId","leadId",semantics) DO NOTHING
    RETURNING id
  `,
    { ...args },
  )
}

/** True when the allowance was claimed by this call; false = already consumed. */
export async function claimSendOnce(args: Parameters<typeof claimSendOnceQuery>[0]): Promise<boolean> {
  const res = await claimSendOnceQuery(args)
  return (res.rows?.length ?? 0) > 0
}

export async function confirmSendClaim(automationId: number, leadId: number): Promise<void> {
  await db('automation_send_claims')
    .where({ automationId, leadId, semantics: 'ever' })
    .update({ status: 'confirmed', confirmedAt: db.fn.now() })
}

/**
 * Release an unconfirmed claim after a transport failure so the retry can
 * re-claim. Deletes ONLY 'claimed' rows — a confirmed claim is permanent.
 */
export function releaseSendClaimQuery(automationId: number, leadId: number) {
  return db('automation_send_claims')
    .where({ automationId, leadId, semantics: 'ever', status: 'claimed' })
    .delete()
}

export async function releaseSendClaim(automationId: number, leadId: number): Promise<void> {
  await releaseSendClaimQuery(automationId, leadId)
}

export function hasSendClaimQuery(automationId: number, leadId: number) {
  return db('automation_send_claims').select('id').where({ automationId, leadId, semantics: 'ever' }).first()
}

export async function hasSendClaim(automationId: number, leadId: number): Promise<boolean> {
  return Boolean(await hasSendClaimQuery(automationId, leadId))
}

export type SendClaimState = 'none' | 'claimed' | 'confirmed'

export function getSendClaimStateQuery(automationId: number, leadId: number) {
  return db('automation_send_claims').select('status').where({ automationId, leadId, semantics: 'ever' }).first()
}

/**
 * Crash-recovery distinction (ADR-011): 'confirmed' = the effect happened
 * (already_sent law applies); 'claimed' = an unconfirmed claim from a crashed
 * attempt — the worker's recovery rules apply, never a plain re-send.
 */
export async function getSendClaimState(automationId: number, leadId: number): Promise<SendClaimState> {
  const row = (await getSendClaimStateQuery(automationId, leadId)) as { status: string } | undefined
  if (!row) return 'none'
  return row.status === 'confirmed' ? 'confirmed' : 'claimed'
}
