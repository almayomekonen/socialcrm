import { db } from '@/config/db'
import {
  insertManualOptOutException,
  lockOptOutKeyShared,
  readOptOutStatus,
  setManualExceptionProviderMessageId,
} from '@/db/whatsappOptOuts'
import { toCustomerPhoneE164 } from '@/lib/whatsapp/optOut/phone'
import type { SendWhatsappTextFailure, SendWhatsappTextResult } from '@/lib/whatsapp/sendMessage'

/**
 * THE customer-send gate. Every WhatsApp message a business sends to a customer
 * — text, interactive or template — runs through `runGatedWhatsappSend`, which
 * the send primitives call themselves (lib/whatsapp/sendMessage.ts,
 * lib/whatsapp/sendTemplateMessage.ts). A caller cannot reach Meta without
 * declaring a `consent`, and `consent` is a required argument.
 *
 * WHEN A SEND HAS STARTED. A send has started when the provider request is
 * issued (the `fetch` to Graph). For automated sends and manual templates the
 * gate holds the SHARED advisory lock on (agency, customer number) from before
 * the opt-out read until that request has returned or failed. Recording an
 * opt-out takes the EXCLUSIVE lock on the same key (db/whatsappOptOuts.ts). So:
 *   - opt-out takes the lock first → the gate waits for it to commit, then reads
 *     `opted_out` and blocks: no provider request is ever issued;
 *   - the gate takes the lock first → the opt-out waits until that one request
 *     has finished; every LATER send then reads `opted_out`.
 * Checking and then releasing the lock before the request would leave a window.
 * Here there is none.
 *
 * Holding the lock costs one pooled connection per in-flight gated send, for at
 * most the duration of one Graph call. The gate's transaction takes no other
 * lock, so it cannot deadlock with the recorder.
 *
 * KNOWN LIMITATIONS (accepted for Phase 0; revisit before widening scope):
 *  - Meta's "Stop promotions" button is not recorded: only typed text counts.
 *    Meta itself suppresses marketing templates for that button.
 *  - WhatsApp only. Messenger and Instagram sends are outside this gate.
 *  - A message Meta accepted before the opt-out committed cannot be recalled.
 *  - Ordering favours the opt-out: a same-second tie, or a re-opt-in processed
 *    before an older opt-out, leaves the customer opted out.
 *  - Wedding RSVP sends hold this gate's connection while their caller holds
 *    its own: two pooled connections per send. Monitor pool use if they scale.
 *
 * A BLOCKED SEND IS FINAL. The result carries `optOutBlocked: true`; every
 * caller turns it into a terminal skip, never a retry or a failed-message
 * bubble. Retries and scheduled jobs reach the provider only through this
 * function again, so each attempt is re-checked.
 *
 * MANUAL SENDS.
 *  - `manual_reply` (a rep's own free-text reply in the composer): not gated. A
 *    person answering a customer is not automated outreach.
 *  - `manual_template` to an opted-out customer: MARKETING (and any unknown
 *    category) is always blocked. UTILITY is sent only with an explicit
 *    exception reason, which is audited with the category, template and rep,
 *    under the same lock, before the request. There is no other bypass.
 */

export type WhatsappSendConsent =
  | { kind: 'automated'; agencyId: number }
  | { kind: 'manual_reply'; agencyId: number; userId: number }
  | {
      kind: 'manual_template'
      agencyId: number
      userId: number
      templateId: number
      templateName: string
      /** The category stored on the template row. Never taken from the client. */
      templateCategory: string | null
      /** Required to send a UTILITY template to an opted-out customer. */
      exceptionReason?: string | null
    }

export type OptOutBlockReason =
  | 'opted_out'
  | 'opted_out_marketing'
  | 'opted_out_exception_required'
  | 'invalid_recipient'
  | 'missing_consent'

/** Shortest reason a rep may give for a UTILITY exception. */
export const MIN_EXCEPTION_REASON_LENGTH = 10

export function isOptOutBlocked(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && (result as { optOutBlocked?: unknown }).optOutBlocked === true)
}

function blocked(reason: OptOutBlockReason): SendWhatsappTextFailure {
  return { ok: false, error: reason, code: reason, optOutBlocked: true, optOutBlockReason: reason }
}

function validAgency(consent: unknown): consent is WhatsappSendConsent {
  const c = consent as { kind?: unknown; agencyId?: unknown } | null | undefined
  return (
    !!c &&
    (c.kind === 'automated' || c.kind === 'manual_reply' || c.kind === 'manual_template') &&
    Number.isInteger(c.agencyId) &&
    (c.agencyId as number) > 0
  )
}

export async function runGatedWhatsappSend(
  consent: WhatsappSendConsent | undefined,
  to: string,
  send: () => Promise<SendWhatsappTextResult>,
): Promise<SendWhatsappTextResult> {
  // Fail closed: a caller that did not say who is sending, for which business,
  // is not sent for.
  if (!validAgency(consent)) {
    console.error('[optOutGate] blocked: missing_consent')
    return blocked('missing_consent')
  }
  if (consent.kind === 'manual_reply') return send()

  const phone = toCustomerPhoneE164(to)
  if (!phone) return blocked('invalid_recipient')

  const trx = await db.transaction()
  let result: SendWhatsappTextResult
  try {
    await lockOptOutKeyShared(trx, consent.agencyId, phone)
    const optedOut = (await readOptOutStatus(trx, consent.agencyId, phone)) === 'opted_out'

    let exceptionId: number | null = null
    if (optedOut) {
      if (consent.kind === 'automated') {
        await trx.rollback()
        return blocked('opted_out')
      }
      if (consent.templateCategory !== 'UTILITY') {
        await trx.rollback()
        return blocked('opted_out_marketing')
      }
      const reason = (consent.exceptionReason ?? '').trim()
      if (reason.length < MIN_EXCEPTION_REASON_LENGTH) {
        await trx.rollback()
        return blocked('opted_out_exception_required')
      }
      exceptionId = await insertManualOptOutException(trx, {
        agencyId: consent.agencyId,
        customerPhoneE164: phone,
        actorUserId: consent.userId,
        templateId: consent.templateId,
        templateName: consent.templateName,
        templateCategory: consent.templateCategory,
        reason,
      })
    }

    // The send starts here, with the shared lock held.
    result = await send()
    if (exceptionId != null && result.ok === true) {
      await setManualExceptionProviderMessageId(trx, exceptionId, result.wamid)
    }
  } catch (err) {
    await trx.rollback().catch(() => {})
    throw err
  }
  // The provider has answered. A failed commit here must not turn a delivered
  // message into an error a caller would retry: the result stands.
  await trx.commit().catch((err) => console.error('[optOutGate] commit after send failed', (err as Error)?.name))
  return result
}
