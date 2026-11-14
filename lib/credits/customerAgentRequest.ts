import 'server-only'
import { admitAgentRequest, voidUndeliveredRequest } from '@/db/credits/agentRequests'

/**
 * The customer-facing WhatsApp agent spends the SAME agency balance as the
 * owner's own AI: the monthly allowance first, then purchased credits.
 *
 * ONE TURN, ONE REQUEST. The unit is one auto-response job — one customer turn
 * the agent answers — however many model calls it makes (qualify, generate,
 * summary). The operation is the job's own usage-ledger operation
 * (`auto_response_job`, the job id; see lib/inbox/autoresponse/worker.ts), so
 * settlement charges a paid turn its actual provider cost under one row, and
 * reporting keeps it apart from the owner's requests by operation kind.
 *
 * IDEMPOTENT ACROSS RETRIES. A job retried after a provider failure re-admits
 * the same (agency, operation) and gets the original decision back: one turn is
 * never counted twice. A turn that ends without a reply (skipped, dead) is
 * released — immediately when the worker knows, otherwise at settlement.
 *
 * Refused means NO model runs for this turn. The customer's message is still
 * persisted and visible in the inbox for a human; the auto-response worker tells
 * the owner by email (credits.exhausted, once per credit month — this module
 * sends nothing itself). Human replies are never metered.
 */

export const CUSTOMER_AGENT_OPERATION_KIND = 'auto_response_job'
/** Skip reason recorded on the job when the agency has no allowance or credits left. */
export const CREDITS_EXHAUSTED = 'credits_exhausted' as const

export type CustomerTurnAdmission = 'admitted' | 'credits_exhausted' | 'unavailable'

export async function admitCustomerAgentTurn(job: { id: number; agencyId: number }): Promise<CustomerTurnAdmission> {
  const access = await admitAgentRequest({
    agencyId: job.agencyId,
    userId: null,
    source: 'whatsapp',
    operation: { kind: CUSTOMER_AGENT_OPERATION_KIND, id: String(job.id) },
    nowMs: Date.now(),
  })
  if (!('reason' in access)) return 'admitted'
  return access.reason === 'credits_required' ? 'credits_exhausted' : 'unavailable'
}

/** The turn ended without a reply to the customer: it does not count. No-op when nothing was admitted. */
export async function releaseCustomerAgentTurn(job: { id: number; agencyId: number }): Promise<void> {
  await voidUndeliveredRequest(job.agencyId, { kind: CUSTOMER_AGENT_OPERATION_KIND, id: String(job.id) })
}
