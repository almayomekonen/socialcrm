import {
  platformWhatsappAccessToken,
  platformWhatsappPhoneNumberId,
  platformWhatsappWabaId,
} from '@/lib/flags/ownerWhatsappReminderFlags'
import { waAssistantAgencyIds } from '@/lib/flags/waAssistantFlags'
import { checkOwnerReminderReadiness, graphGet, type ReadinessCheck } from './readiness'

/**
 * READ-ONLY readiness of the platform number for the WhatsApp ASSISTANT — the
 * question before more agencies talk to it, which the owner-reminder check does
 * not answer. Every Graph call is a GET; nothing is sent or changed at Meta.
 *
 * It reuses the reminder check's config, token and phone checks unchanged, and
 * leaves out the reminder template (the assistant replies inside the customer
 * service window and sends no template). It adds:
 *
 *   webhook        this app is subscribed to the platform WABA's webhooks
 *                  (GET {waba}/subscribed_apps) — without it no message arrives
 *   displayName    name_status APPROVED or AVAILABLE_WITHOUT_REVIEW
 *   quality        RED blocks; YELLOW is the deterioration warning; plus the
 *                  messaging tier and the reasons Meta gives for LIMITED/BLOCKED
 *   business       business_verification_status of the owning business
 *   accountReview  account_review_status of the WABA
 *
 * `business` and `accountReview` are each read in their own request: a field
 * this Graph version does not expose fails only its own check, as
 * `unavailable`, never as a pass. Errors carry the HTTP status and Graph code
 * only — never Meta's message text, which can echo the token.
 *
 * NOT VERIFIABLE HERE, and listed as such rather than implied: the WABA's
 * payment method, its billing status, the two-step PIN, and how much traffic
 * the number can take. Those are manual checks (docs/wa-assistant-readiness.md).
 */

export type AgentReadinessCheck = {
  name: 'config' | 'token' | 'phone' | 'webhook' | 'displayName' | 'quality' | 'business' | 'accountReview'
  /** `blocking` checks decide `ready` (ok or warning passes); `warning`-severity checks are reported only. */
  severity: 'blocking' | 'warning'
  state: 'ok' | 'warning' | 'failed' | 'unavailable'
  detail: Record<string, unknown>
}

export type AgentReadiness = {
  ready: boolean
  checks: AgentReadinessCheck[]
  notVerifiable: string[]
  assistantAgencies: number
}

export const NOT_VERIFIABLE = ['wabaPaymentMethod', 'metaBillingStatus', 'twoStepPin', 'trafficCapacity'] as const

const errorOf = (r: { status: number; body: any }) => ({ httpStatus: r.status, code: r.body?.error?.code ?? null })
const APPROVED_NAME = new Set(['APPROVED', 'AVAILABLE_WITHOUT_REVIEW'])

function fromReminder(c: ReadinessCheck | undefined, name: 'config' | 'token' | 'phone'): AgentReadinessCheck {
  if (!c) return { name, severity: 'blocking', state: 'unavailable', detail: { reason: 'not_checked' } }
  return { name, severity: 'blocking', state: c.ok ? 'ok' : 'failed', detail: c.detail }
}

export async function checkAgentPlatformReadiness(): Promise<AgentReadiness> {
  const base = await checkOwnerReminderReadiness()
  const byName = new Map(base.checks.map((c) => [c.name, c]))
  const checks: AgentReadinessCheck[] = [
    fromReminder(byName.get('config'), 'config'),
    fromReminder(byName.get('token'), 'token'),
    fromReminder(byName.get('phone'), 'phone'),
  ]

  const phoneId = platformWhatsappPhoneNumberId()
  const wabaId = platformWhatsappWabaId()
  const token = platformWhatsappAccessToken()
  const appId = process.env.META_APP_ID?.trim() || null
  const result = (): AgentReadiness => ({
    // A blocking check must be ok, or a warning (YELLOW quality); failed and unavailable both block.
    ready: checks.every((c) => c.severity !== 'blocking' || c.state === 'ok' || c.state === 'warning'),
    checks,
    notVerifiable: [...NOT_VERIFIABLE],
    assistantAgencies: waAssistantAgencyIds().length,
  })
  if (!phoneId || !wabaId || !token) return result()

  const [subs, phone, business, review] = await Promise.all([
    graphGet(`${wabaId}/subscribed_apps`, token),
    graphGet(`${phoneId}?fields=quality_rating,name_status,whatsapp_business_manager_messaging_limit,health_status`, token),
    graphGet(`${wabaId}?fields=business_verification_status`, token),
    graphGet(`${wabaId}?fields=account_review_status`, token),
  ])

  if (subs.status === 200 && Array.isArray(subs.body?.data)) {
    const ids = (subs.body.data as any[]).map((a) => String(a?.whatsapp_business_api_data?.id ?? a?.id ?? '')).filter(Boolean)
    const subscribed = !!appId && ids.includes(appId)
    checks.push({
      name: 'webhook',
      severity: 'blocking',
      state: subscribed ? 'ok' : 'failed',
      detail: { subscribed, subscribedAppCount: ids.length, appIdConfigured: !!appId },
    })
  } else checks.push({ name: 'webhook', severity: 'blocking', state: 'unavailable', detail: errorOf(subs) })

  if (phone.status === 200 && phone.body) {
    const nameStatus = phone.body.name_status ?? null
    checks.push({
      name: 'displayName',
      severity: 'blocking',
      state: APPROVED_NAME.has(nameStatus) ? 'ok' : 'failed',
      detail: { nameStatus },
    })
    const rating = phone.body.quality_rating ?? null
    const entities = ((phone.body.health_status?.entities ?? []) as any[]).map((e) => ({
      entityType: e?.entity_type ?? null,
      canSendMessage: e?.can_send_message ?? null,
      errors: ((e?.errors ?? []) as any[]).map((x) => x?.error_code ?? null),
    }))
    checks.push({
      name: 'quality',
      severity: 'blocking',
      state: rating === 'GREEN' ? 'ok' : rating === 'YELLOW' ? 'warning' : rating === 'RED' ? 'failed' : 'unavailable',
      detail: {
        qualityRating: rating,
        messagingLimitTier: phone.body.whatsapp_business_manager_messaging_limit ?? null,
        canSendMessage: phone.body.health_status?.can_send_message ?? null,
        entities,
      },
    })
  } else {
    checks.push({ name: 'displayName', severity: 'blocking', state: 'unavailable', detail: errorOf(phone) })
    checks.push({ name: 'quality', severity: 'blocking', state: 'unavailable', detail: errorOf(phone) })
  }

  const field = (r: { status: number; body: any }, key: string, okValues: string[]) => {
    const v = r.status === 200 ? r.body?.[key] : undefined
    if (typeof v !== 'string')
      return { state: 'unavailable' as const, detail: r.status === 200 ? { reason: 'field_not_returned' } : errorOf(r) }
    return { state: okValues.includes(v.toLowerCase()) ? ('ok' as const) : ('warning' as const), detail: { [key]: v } }
  }
  checks.push({ name: 'business', severity: 'warning', ...field(business, 'business_verification_status', ['verified']) })
  checks.push({ name: 'accountReview', severity: 'warning', ...field(review, 'account_review_status', ['approved']) })

  return result()
}
