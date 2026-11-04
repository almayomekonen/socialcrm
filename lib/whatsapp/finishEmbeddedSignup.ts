import { db } from '@/config/db'
import { track, trackOncePerAgency } from '@/lib/analytics/track'
import { WA_REASON, WA_REASON_NOTICE_CODE, type WaReason } from '@/lib/connections/reasons'
import {
  fetchPhoneBizAppState,
  resolveOnboardingType,
  syncSmbAppData,
} from '@/lib/whatsapp/coexistence'
import { ensureMessagingReady } from '@/lib/whatsapp/registration'
import { resolveSignupAccount } from '@/lib/whatsapp/resolveSignupAccount'
import { errorName, saveConnection, subscribeApp, type EventDetail } from '@/lib/whatsapp/signupSteps'
import type { SignupResumeState } from '@/lib/whatsapp/signupResume'

export type SignupOwner = { agencyId: number; userId: number }

export type SignupFinish = {
  status: number
  body: Record<string, unknown>
  /** The token is still useful: keep it so the customer need not repeat Meta's flow. */
  retryable: boolean
  /** Added to what is kept for the next try. */
  keep?: Partial<SignupResumeState>
}

/**
 * Everything after Meta's OAuth code has become a token: find the account and
 * number, check ownership, subscribe, save, and report readiness. Runs for a new
 * signup and for a resumed one, so it must stay safe to repeat — subscribing is
 * idempotent at Meta and the save is an upsert.
 */
export async function finishEmbeddedSignup(owner: SignupOwner, state: SignupResumeState): Promise<SignupFinish> {
  const { agencyId, userId } = owner
  const { accessToken, browserOnboardingType, attemptId } = state
  const withAttempt = (props: EventDetail): EventDetail => (attemptId ? { ...props, attemptId } : props)

  /** A structured failure WITHOUT an operational connection (the Oren 2026-07-21 guard). */
  const fail = (reason: WaReason, stage: string, status: number, retryable = false, detail: EventDetail = {}): SignupFinish => {
    track({ agencyId, userId, event: 'whatsapp_connect_failed', props: withAttempt({ reason, stage, ...detail }) })
    return { status, body: { ok: false, error: WA_REASON_NOTICE_CODE[reason], reason }, retryable }
  }

  // 1. Which account and number. Needs the token, so it runs after the exchange:
  //    Meta does not guarantee a `phone_number_id`, and may return several accounts.
  const account = await resolveSignupAccount({
    wabaId: state.wabaId,
    wabaCandidates: state.wabaCandidates,
    phoneNumberId: state.phoneNumberId,
    accessToken,
  })
  if ('reason' in account) {
    console.error('[WA EmbeddedSignup] could not resolve the account or number', { reason: account.reason, browserOnboardingType })
    const detail = { resolution: account.reason, accountCount: state.wabaCandidates?.length ?? 1 }
    return account.reason === 'ambiguous' && !state.wabaId
      ? fail(WA_REASON.WABA_NOT_FOUND, 'discover', 400, false, detail)
      : fail(WA_REASON.PHONE_NOT_FOUND, 'discover', 400, account.reason === 'lookup_failed', detail)
  }
  const { wabaId, phoneNumberId } = account

  // 2. Cross-tenant safety: never silently move a phone number between agencies.
  //    Same agency reconnecting is allowed (updates token/waba below).
  let existing: { agency_id: number; onboarding_type?: string | null } | undefined
  try {
    existing = await db('whatsapp_connections').where({ phone_number_id: phoneNumberId }).first()
  } catch (err) {
    console.error('[WA EmbeddedSignup] connection lookup failed:', errorName(err))
    track({ agencyId, userId, event: 'whatsapp_connect_failed', props: withAttempt({ reason: 'SAVE_FAILED', stage: 'persist' }) })
    return { status: 500, body: { error: 'DB error' }, retryable: true }
  }
  if (existing && existing.agency_id !== agencyId) {
    console.warn('[WA EmbeddedSignup] cross-tenant claim rejected', {
      phoneNumberId,
      requestingAgency: agencyId,
      // NOTE: the owning agency id/name is deliberately NOT returned to the client.
    })
    return fail(WA_REASON.RESOURCE_CLAIMED, 'ownership', 409)
  }

  // Server-side authority: Graph `is_on_biz_app` wins over the browser type,
  // except that an existing Coexistence connection is never converted here.
  const bizApp = await fetchPhoneBizAppState(phoneNumberId, accessToken)
  const onboardingType = resolveOnboardingType({
    isOnBizApp: bizApp.isOnBizApp,
    browserOnboardingType,
    existingOnboardingType: existing?.onboarding_type,
  })
  if (existing?.onboarding_type === 'coexistence' && bizApp.known && !bizApp.isOnBizApp) {
    // Meta now says the number is not on the WhatsApp Business app. Moving it to
    // Cloud API must be the customer's explicit choice, so it stays Coexistence
    // (no /register, no re-sync) and the conflict is left for a human to review.
    console.warn('[WA EmbeddedSignup] coexistence reconnect: is_on_biz_app=false conflicts with the stored connection; kept coexistence', {
      phoneNumberId,
      browserOnboardingType,
    })
  }

  // 3. Subscribe the app to the WABA. This is the webhook subscription that lets
  //    inbound messages/leads reach SocialCRM. It MUST succeed before we persist
  //    a connection — a saved-but-unsubscribed row is a false "connected" state.
  const subscribed = await subscribeApp(wabaId, accessToken)
  if ('detail' in subscribed) {
    const { permanent, ...detail } = subscribed.detail
    return fail(WA_REASON.SUBSCRIBED_APPS_FAILED, 'subscribe', 502, !permanent, detail)
  }

  track({ agencyId, userId, event: 'whatsapp_webhook_subscribed', props: withAttempt({}) })

  // 4. Subscription confirmed — now safe to persist the connection.
  const saved = await saveConnection({
    user_id: userId,
    agency_id: agencyId,
    phone_number_id: phoneNumberId,
    access_token: accessToken,
    waba_id: wabaId,
    onboarding_type: onboardingType,
  })
  if (saved === 'claimed') {
    console.warn('[WA EmbeddedSignup] cross-tenant claim rejected at save', { phoneNumberId, requestingAgency: agencyId })
    return fail(WA_REASON.RESOURCE_CLAIMED, 'ownership', 409)
  }
  if (saved === 'failed') {
    track({ agencyId, userId, event: 'whatsapp_connect_failed', props: withAttempt({ reason: 'SAVE_FAILED', stage: 'persist' }) })
    // A save reported as failed may have committed, and the row would then look
    // like an earlier connection on the next run. Meta allows the sync only once.
    return { status: 500, body: { error: 'DB error' }, retryable: true, keep: { syncPending: existing?.onboarding_type !== 'coexistence' } }
  }

  // Both events belong AFTER the WABA subscription and durable connection row:
  // this is the first point at which SocialCRM has confirmed the phone identity
  // and completed the signup. `existing` is read before the upsert, so repeated
  // callbacks/retries for the same connection cannot create a new funnel step.
  // `trackOncePerAgency` additionally protects a reconnect after disconnect.
  if (!existing || state.syncPending) {
    await Promise.all([
      trackOncePerAgency(agencyId, 'whatsapp_signup_completed', userId, withAttempt({ onboardingType })),
      trackOncePerAgency(agencyId, 'whatsapp_phone_discovered', userId, withAttempt({ onboardingType })),
    ])
  }

  // 5. Readiness is a softer, separate state: the connection is subscribed, but
  //    Meta may not have registered the number for send/receive yet. We persist
  //    the (subscribed) connection and report readiness honestly — the settings
  //    UI shows "setup incomplete" until the number is CONNECTED.
  const readiness = await ensureMessagingReady(phoneNumberId, accessToken, {
    skipRegistration: onboardingType === 'coexistence',
  })

  // 5b. Coexistence only: request the one-time contact and message-history sync.
  //     Meta gives 24 hours before the customer must be offboarded and redo the
  //     flow, and the step can only be performed once — so it runs now, inline,
  //     rather than being deferred to a job that might not run in time.
  //     A failure degrades the connection (no imported history); it must never
  //     fail an onboarding that otherwise succeeded.
  if (onboardingType === 'coexistence') {
    const alreadySynced = existing?.onboarding_type === 'coexistence' && !state.syncPending
    if (alreadySynced) {
      console.log('[WA EmbeddedSignup] coexistence reconnect; smb_app_data already requested', { phoneNumberId })
    } else {
      const sync = await syncSmbAppData(phoneNumberId, accessToken)
      // History being absent is only "incomplete" when it was actually asked
      // for. While the Wave 2A.0 gate holds it is a deliberate omission that
      // PRESERVES the one-time archive, and reporting that as a failure every
      // time would train us to ignore the line that matters.
      const historyFailed = sync.historyRequested && !sync.history
      if (!sync.contacts || historyFailed) {
        console.warn('[WA EmbeddedSignup] coexistence sync incomplete', {
          phoneNumberId,
          contacts: sync.contacts,
          history: sync.history,
          historyRequested: sync.historyRequested,
        })
      }
    }
  }

  if (readiness.ready) {
    track({ agencyId, userId, event: 'whatsapp_messaging_ready', props: withAttempt({}) })
    track({ agencyId, userId, event: 'whatsapp_connected_operational', props: withAttempt({}) })
  } else {
    track({
      agencyId,
      userId,
      event: 'whatsapp_connect_failed',
      props: withAttempt({ reason: WA_REASON.PHONE_NOT_READY, stage: 'readiness' }),
    })
  }

  return { status: 200, body: { ok: true, messagingReady: readiness.ready, reason: readiness.reason }, retryable: false }
}
