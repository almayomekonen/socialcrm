import { recordAccountRestriction } from '@/lib/inbox/recordAccountRestriction'
import {
  failureTextForCategory,
  mapWhatsappError,
  type WhatsappErrorCategory,
} from '@/lib/inbox/whatsappErrorCopy'
import { formatWhatsappSendFailure, type SendWhatsappTextFailure } from '@/lib/whatsapp/sendMessage'
import { deadLetterAutoResponseJob, failAutoResponseJob } from '@/db/autoResponseJobs'
import { parkAmbiguousSend } from '@/lib/inbox/autoresponse/ambiguousSend'

/**
 * Shared outbound-failure contract: classify once, persist an account
 * restriction only for Meta account-level blocks, never for window /
 * recipient / generic / token failures.
 *
 * agencyId and phone come from the authenticated session or job + the
 * server-resolved outbound target. Callers must not pass client-supplied
 * tenant or phone identifiers.
 */

export type WhatsappSendFailureInput = {
  code?: string | number | null
  httpStatus?: number
}

export type OnWhatsappSendFailureContext = {
  agencyId: number
  leadId: number | null
  businessPhoneNumberId: string
  customerWaId: string
  customerName: string | null
  sentByUserId: number | null
  text: string
}

export type OnWhatsappSendFailureResult = {
  category: WhatsappErrorCategory
  text: string
}

function graphCode(failure: WhatsappSendFailureInput): number | null {
  if (failure.code == null || failure.code === '') return null
  const n = Number(failure.code)
  return Number.isFinite(n) ? n : null
}

function isTokenFailure(failure: WhatsappSendFailureInput, code: number | null): boolean {
  return failure.httpStatus === 401 || code === 190
}

export async function onWhatsappSendFailure(
  failure: WhatsappSendFailureInput,
  ctx: OnWhatsappSendFailureContext,
): Promise<OnWhatsappSendFailureResult> {
  const code = graphCode(failure)
  const mapped = mapWhatsappError(code)

  if (isTokenFailure(failure, code)) {
    return { category: 'generic', text: failureTextForCategory('generic') ?? mapped.text }
  }

  if (mapped.category === 'account') {
    try {
      await recordAccountRestriction({
        agencyId: ctx.agencyId,
        leadId: ctx.leadId,
        businessPhoneNumberId: ctx.businessPhoneNumberId,
        customerWaId: ctx.customerWaId,
        customerName: ctx.customerName,
        sentByUserId: ctx.sentByUserId,
        text: ctx.text,
      })
    } catch (err) {
      console.error(`[WhatsappSend][lead=${ctx.leadId}] record account restriction failed`, err)
    }
  }

  return mapped
}

/**
 * IRE send failure → the job's next state:
 *   - outcome UNKNOWN (`ambiguous`): terminal and handed to a person, never
 *     retried — the customer may already have the message (parkAmbiguousSend);
 *   - an account restriction: dead (existing status);
 *   - any other Graph refusal: nothing was delivered, so retry with backoff.
 * Both writes are owner-checked by `job.ownerWorkerId`: a worker that lost its
 * lease while the refusal came back leaves the new owner's job untouched.
 */
export async function applyIreWhatsappSendFailure(
  job: { id: number; agencyId: number; conversationId: number; leadId: number | null; ownerWorkerId?: string },
  failure: SendWhatsappTextFailure,
  ctx: Omit<OnWhatsappSendFailureContext, 'agencyId' | 'leadId'>,
): Promise<OnWhatsappSendFailureResult> {
  if (failure.ambiguous) {
    await parkAmbiguousSend(job, formatWhatsappSendFailure(failure))
    return { category: 'generic', text: failureTextForCategory('generic') ?? mapWhatsappError(null).text }
  }
  const result = await onWhatsappSendFailure(failure, {
    agencyId: job.agencyId,
    leadId: job.leadId,
    ...ctx,
  })
  const detail = formatWhatsappSendFailure(failure)
  if (result.category === 'account') {
    await deadLetterAutoResponseJob(job.id, detail, job.ownerWorkerId)
  } else {
    await failAutoResponseJob(job.id, detail, job.ownerWorkerId)
  }
  return result
}

/**
 * Automation execute() throws this so the worker can dead-letter immediately
 * (existing `dead` status) instead of treating the send as a transient retry.
 */
export class TerminalWhatsappAccountError extends Error {
  readonly terminal = true as const
  readonly category = 'account' as const
  constructor(message: string) {
    super(message)
    this.name = 'TerminalWhatsappAccountError'
  }
}

export function isTerminalWhatsappAccountError(err: unknown): err is TerminalWhatsappAccountError {
  if (err instanceof TerminalWhatsappAccountError) return true
  return (
    err != null &&
    typeof err === 'object' &&
    (err as { name?: string; terminal?: unknown; category?: unknown }).name ===
      'TerminalWhatsappAccountError' &&
    (err as { terminal?: unknown }).terminal === true &&
    (err as { category?: unknown }).category === 'account'
  )
}
