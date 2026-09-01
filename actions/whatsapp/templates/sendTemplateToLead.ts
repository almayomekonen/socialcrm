'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { isTemplatesEnabledForAgency } from '@/lib/whatsapp/templates/flag'
import { loadTemplateForSend } from '@/db/whatsappTemplates'
import { getAgencyById } from '@/db/agencies'
import {
  resolveWhatsappOutboundTarget,
  resolveWhatsappOutboundTargetForConversation,
} from '@/lib/inbox/whatsappOutboundTarget'
import { loadWhatsappComposerContext } from '@/lib/inbox/whatsappComposerContext'
import { renderResolvedBody } from '@/lib/whatsapp/templates/variables'
import { resolveTemplateSendParameters, renderPositionalBody } from '@/lib/whatsapp/templates/parameters'
import { sendWhatsappTemplate } from '@/lib/whatsapp/sendTemplateMessage'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { recordHumanTakeover } from '@/lib/inbox/humanTakeover'
import { onWhatsappSendFailure } from '@/lib/inbox/onWhatsappSendFailure'

/**
 * Send an APPROVED ready-made message to ONE lead (RFC §0 R-A, §15 Phase 6).
 *
 * Layering: UI → this Server Action → service (`sendWhatsappTemplate`) → Graph →
 * Meta. The connection token is resolved server-side and never leaves it.
 *
 * Permission model (RFC §1): sending to a lead is an **agent** action — any agency
 * member — so this is `requireProductAccess`, NOT admin-gated (unlike create/retry/
 * archive). Tenant isolation is total: the template is loaded scoped to the
 * caller's agency, and the send target is resolved within the same agency.
 *
 * Discipline mirrors `sendWhatsappReply`: SEND first, persist only on a confirmed
 * wamid, so a failed Cloud API call never leaves a fake conversation entry. The
 * outbound's `sent → delivered → read / failed` lifecycle is handled entirely by
 * the already-shipped `statuses` webhook — no new status path here. One lead only:
 * no bulk, no schedule, no automation. An Inbox `conversationId` targets that
 * conversation's phone; omitting it keeps the lead-page / existing lead-based path.
 */

export type SendTemplateToLeadResult = { ok: true } | { ok: false; error: string }

const NOT_AVAILABLE = 'שליחת הודעות WhatsApp מוכנות אינה זמינה.'
const INVALID_INPUT = 'בקשה לא תקינה.'
const NOT_FOUND = 'ההודעה המוכנה לא נמצאה.'
const NOT_APPROVED = 'אפשר לשלוח רק הודעה שאושרה.'
const NO_CONNECTION = 'צריך לחבר וואטסאפ עסקי כדי לשלוח.'
const NO_RECIPIENT = 'אין מספר וואטסאפ פעיל לליד הזה.'
const HEALTH_BLOCKED = 'לא ניתן לשלוח הודעות כרגע'
const SEND_FAILED = 'ההודעה לא נשלחה. נסו שוב.'
const PERSIST_FAILED = 'ההודעה נשלחה אך לא נשמרה בשיחה. רעננו את הדף.'
const NEEDS_MAPPING = 'ההודעה הזו סונכרנה מ‑Meta וצריך להגדיר אילו פרטים ממלאים אותה לפני השליחה.'

export async function sendTemplateToLead(
  leadIdRaw: number | string,
  templateIdRaw: number | string,
  conversationIdRaw?: number | string | null,
): Promise<SendTemplateToLeadResult> {
  const leadId = Number(leadIdRaw)
  const templateId = Number(templateIdRaw)
  if (!Number.isFinite(leadId) || leadId <= 0 || !Number.isFinite(templateId) || templateId <= 0) {
    return { ok: false, error: INVALID_INPUT }
  }

  const conversationId =
    conversationIdRaw == null || conversationIdRaw === ''
      ? null
      : Number(conversationIdRaw)
  if (conversationId != null && (!Number.isFinite(conversationId) || conversationId <= 0)) {
    return { ok: false, error: INVALID_INPUT }
  }

  const user = await requireProductAccess()
  // Defense in depth: the UI is flag-gated, but the action re-checks so an
  // off-agency can never reach the send path even by calling directly.
  if (!isTemplatesEnabledForAgency(user.agencyId)) return { ok: false, error: NOT_AVAILABLE }

  // Template must exist, belong to THIS agency, and be APPROVED (server-enforced).
  const template = await loadTemplateForSend(templateId, user.agencyId)
  if (!template) return { ok: false, error: NOT_FOUND }
  if (template.status !== 'approved') return { ok: false, error: NOT_APPROVED }

  // Inbox passes the open conversation: use THAT phone + wa_id. Lead page and
  // other callers omit the id and keep the existing lead-based target.
  const resolved = conversationId
    ? await resolveWhatsappOutboundTargetForConversation(user.agencyId, leadId, conversationId)
    : await resolveWhatsappOutboundTarget(user.agencyId, leadId)
  if (resolved.ok === false) {
    return { ok: false, error: resolved.reason === 'no-connection' ? NO_CONNECTION : NO_RECIPIENT }
  }
  const { target } = resolved

  // Templates are legal when the 24-hour window is CLOSED. Health is not:
  // a restricted / disconnected phone on THIS conversation must not send.
  if (conversationId) {
    const ctx = await loadWhatsappComposerContext(user.agencyId, conversationId)
    // `throttled` passes for the same reason as the free-text gate: Meta
    // rate-limited the status probe, so the check could not run. Every other
    // non-operational state still returns HEALTH_BLOCKED exactly as before.
    if (ctx.health !== 'operational' && ctx.health !== 'throttled') {
      return { ok: false, error: HEALTH_BLOCKED }
    }
  }

  // Business name for the {{שם העסק}} chip, agency-scoped.
  const agency = await getAgencyById(user.agencyId)
  const ctx = { leadFullName: target.leadName, businessName: (agency?.name as string | null) ?? null }

  // Positional params in {{1}},{{2}}… order — each guaranteed non-empty (RFC §10).
  // Source-agnostic: in-app templates resolve from their chip variables (unchanged);
  // Meta-synced templates resolve from the body's arity + explicit bindings. An
  // adopted template whose slots aren't mapped is BLOCKED here with a clear reason
  // rather than sending a mismatched count (the #132000 fix).
  const resolvedParams = resolveTemplateSendParameters(
    { bodyText: template.bodyText, variables: template.variables, bindings: template.bindings },
    ctx,
  )
  if ('positions' in resolvedParams) {
    console.error(`[TemplateSend][lead=${leadId}][tpl=${templateId}] unmapped params`, { positions: resolvedParams.positions })
    return { ok: false, error: NEEDS_MAPPING }
  }
  const params = resolvedParams.params
  const renderedText =
    template.variables.length > 0
      ? renderResolvedBody(template.bodyText, template.variables, ctx)
      : renderPositionalBody(template.bodyText, params)

  // A template a rep chose and sent is a human message: permanent takeover, marked
  // before the Graph call so a concurrent agent reply is refused at the boundary.
  await recordHumanTakeover({ agencyId: user.agencyId, leadId, conversationId })

  // SEND first — persist only on a confirmed wamid.
  const sent = await sendWhatsappTemplate({
    phoneNumberId: target.businessPhoneNumberId,
    accessToken: target.accessToken,
    to: target.customerWaId,
    name: template.name,
    language: template.language,
    params,
  })
  // Note: this repo's TS does not narrow on `.ok`; use the in-operator on the
  // discriminating field to reach the failure member's fields.
  if ('error' in sent) {
    console.error(`[TemplateSend][lead=${leadId}][tpl=${templateId}] send failed`, {
      code: sent.code,
      httpStatus: sent.httpStatus,
    })
    const classified = await onWhatsappSendFailure(sent, {
      agencyId: user.agencyId,
      leadId,
      businessPhoneNumberId: target.businessPhoneNumberId,
      customerWaId: target.customerWaId,
      customerName: target.customerName,
      sentByUserId: user.id,
      text: renderedText,
    })
    // Preserve the existing no-code Hebrew; otherwise reuse the taxonomy copy.
    return { ok: false, error: sent.code ? classified.text : SEND_FAILED }
  }

  try {
    await persistOutboundWhatsapp({
      agencyId: user.agencyId,
      leadId,
      businessPhoneNumberId: target.businessPhoneNumberId,
      customerWaId: target.customerWaId,
      customerName: target.customerName,
      sentByUserId: user.id,
      wamid: sent.wamid,
      text: renderedText,
    })
  } catch (err) {
    // Sent at Meta but local persist failed — surface honestly, never fake success.
    console.error(`[TemplateSend][lead=${leadId}] persist after successful send failed:`, err)
    return { ok: false, error: PERSIST_FAILED }
  }

  return { ok: true }
}
