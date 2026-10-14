import { GRAPH_BASE } from '@/lib/facebook/graph'
import {
  isOwnerWhatsappReminderSendEnabled,
  ownerWhatsappReminderAgencyIds,
  platformWhatsappAccessToken,
  platformWhatsappPhoneNumberId,
  platformWhatsappWabaId,
} from '@/lib/flags/ownerWhatsappReminderFlags'
import { REMINDER_TEMPLATE, SEND_TIMEOUT_MS } from '@/lib/ownerWhatsappReminders/constants'
import { attachReadinessDiagnostics, managementGrantedOnWaba } from './readinessDiagnostics'

/**
 * READ-ONLY readiness of the owner-reminder sender. Every Graph call here is a
 * GET; nothing is ever sent or changed at Meta, and the result never contains
 * the token, the phone number or the app secret.
 *
 *   config    which settings are present (booleans; agency ids are not secret)
 *   token     debug_token: valid, SYSTEM_USER, this app, never expires,
 *             whatsapp_business_messaging granted on this WABA
 *   phone     CONNECTED, can_send_message AVAILABLE, quality not RED
 *   template  lead_followup_alert (he) APPROVED, UTILITY, one body variable,
 *             a URL button whose link takes one variable
 *
 * What it cannot prove: that Meta accepts a send (payment method, business
 * verification limits). Only a first real send can.
 */

export type ReadinessCheck = { name: 'config' | 'token' | 'phone' | 'template'; ok: boolean; detail: Record<string, unknown> }

async function graphGet(path: string, token: string): Promise<{ status: number; body: any }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
  try {
    const res = await fetch(`${GRAPH_BASE}/${path}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
    return { status: res.status, body: await res.json().catch(() => null) }
  } catch (err) {
    return { status: 0, body: { error: { message: (err as Error)?.name === 'AbortError' ? 'timeout' : 'network' } } }
  } finally {
    clearTimeout(timer)
  }
}

const graphError = (r: { status: number; body: any }) => ({ httpStatus: r.status, code: r.body?.error?.code ?? null, message: r.body?.error?.message ?? null })

export async function checkOwnerReminderReadiness(): Promise<{ ready: boolean; checks: ReadinessCheck[] }> {
  const phoneId = platformWhatsappPhoneNumberId()
  const wabaId = platformWhatsappWabaId()
  const token = platformWhatsappAccessToken()
  const appId = process.env.META_APP_ID?.trim() || null
  const appSecret = process.env.META_APP_SECRET?.trim() || null
  const checks: ReadinessCheck[] = []
  const config = {
    phoneNumberId: !!phoneId, wabaId: !!wabaId, accessToken: !!token, appId: !!appId, appSecret: !!appSecret,
    sendEnabled: isOwnerWhatsappReminderSendEnabled(), allowlistedAgencies: ownerWhatsappReminderAgencyIds(),
  }
  checks.push({ name: 'config', ok: !!(phoneId && wabaId && token && appId && appSecret), detail: config })
  if (!phoneId || !wabaId || !token) return { ready: false, checks }

  if (appId && appSecret) {
    const r = await graphGet(`debug_token?input_token=${encodeURIComponent(token)}`, `${appId}|${appSecret}`)
    const d = r.body?.data
    const granted = (d?.granular_scopes ?? []) as { scope: string; target_ids?: string[] }[]
    const messaging = granted.find((g) => g.scope === 'whatsapp_business_messaging')
    const detail = d
      ? {
          isValid: d.is_valid === true, type: d.type ?? null, appMatches: String(d.app_id) === appId,
          neverExpires: d.expires_at === 0, scopes: d.scopes ?? [],
          messagingGrantedOnWaba: !messaging?.target_ids || messaging.target_ids.includes(wabaId),
          managementGrantedOnWaba: managementGrantedOnWaba(d.granular_scopes, wabaId),
        }
      : graphError(r)
    const ok = !!d && d.is_valid === true && d.type === 'SYSTEM_USER' && String(d.app_id) === appId && !!messaging &&
      (!messaging.target_ids || messaging.target_ids.includes(wabaId))
    checks.push({ name: 'token', ok, detail })
  }

  const p = await graphGet(`${phoneId}?fields=status,quality_rating,messaging_limit_tier,name_status,code_verification_status,health_status`, token)
  if (p.status === 200 && p.body) {
    const canSend = p.body.health_status?.can_send_message ?? null
    const detail = { status: p.body.status ?? null, qualityRating: p.body.quality_rating ?? null, messagingLimitTier: p.body.messaging_limit_tier ?? null, nameStatus: p.body.name_status ?? null, canSendMessage: canSend }
    checks.push({ name: 'phone', ok: p.body.status === 'CONNECTED' && canSend === 'AVAILABLE' && p.body.quality_rating !== 'RED', detail })
  } else checks.push({ name: 'phone', ok: false, detail: graphError(p) })

  const t = await graphGet(`${wabaId}/message_templates?name=${REMINDER_TEMPLATE.name}&fields=name,status,category,language,components`, token)
  const tpl = ((t.body?.data ?? []) as any[]).find((x) => x.name === REMINDER_TEMPLATE.name && x.language === REMINDER_TEMPLATE.language)
  if (tpl) {
    const body = (tpl.components ?? []).find((c: any) => c.type === 'BODY')?.text ?? ''
    const urlButton = ((tpl.components ?? []).find((c: any) => c.type === 'BUTTONS')?.buttons ?? []).find((b: any) => b.type === 'URL')
    const detail = {
      status: tpl.status, category: tpl.category, bodyVariables: (String(body).match(/\{\{\d+\}\}/g) ?? []).length,
      urlButtonHasVariable: typeof urlButton?.url === 'string' && /\{\{1\}\}$/.test(urlButton.url),
    }
    checks.push({ name: 'template', ok: tpl.status === 'APPROVED' && tpl.category === 'UTILITY' && detail.bodyVariables === 1 && detail.urlButtonHasVariable, detail })
  } else checks.push({ name: 'template', ok: false, detail: t.status === 200 ? { found: false } : graphError(t) })

  attachReadinessDiagnostics(checks, { phone: p, template: t })
  return { ready: checks.every((c) => c.ok), checks }
}
