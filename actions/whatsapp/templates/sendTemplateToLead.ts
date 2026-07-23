'use server'

import { requireAgencyUser } from '@/lib/requireUser'
import { isTemplatesEnabledForAgency } from '@/lib/whatsapp/templates/flag'
import { loadTemplateForSend } from '@/db/whatsappTemplates'
import { getAgencyById } from '@/db/agencies'
import { resolveWhatsappOutboundTarget } from '@/lib/inbox/whatsappOutboundTarget'
import { resolveTemplateParams, renderResolvedBody } from '@/lib/whatsapp/templates/variables'
import { sendWhatsappTemplate } from '@/lib/whatsapp/sendTemplateMessage'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { mapWhatsappError } from '@/lib/inbox/whatsappErrorCopy'

/**
 * Send an APPROVED ready-made message to ONE lead (RFC §0 R-A, §15 Phase 6).
 *
 * Layering: UI → this Server Action → service (`sendWhatsappTemplate`) → Graph →
 * Meta. The connection token is resolved server-side and never leaves it.
 *
 * Permission model (RFC §1): sending to a lead is an **agent** action — any agency
 * member — so this is `requireAgencyUser`, NOT admin-gated (unlike create/retry/
 * archive). Tenant isolation is total: the template is loaded scoped to the
 * caller's agency, and the send target is resolved within the same agency.
 *
 * Discipline mirrors `sendWhatsappReply`: SEND first, persist only on a confirmed
 * wamid, so a failed Cloud API call never leaves a fake conversation entry. The
 * outbound's `sent → delivered → read / failed` lifecycle is handled entirely by
 * the already-shipped `statuses` webhook — no new status path here. One lead only:
 * no bulk, no schedule, no automation.
 */

export type SendTemplateToLeadResult = { ok: true } | { ok: false; error: string }

const NOT_AVAILABLE = 'שליחת הודעות מוכנות אינה זמינה.'
const INVALID_INPUT = 'בקשה לא תקינה.'
const NOT_FOUND = 'ההודעה המוכנה לא נמצאה.'
const NOT_APPROVED = 'אפשר לשלוח רק הודעה שאושרה.'
const NO_CONNECTION = 'צריך לחבר וואטסאפ עסקי כדי לשלוח.'
const NO_RECIPIENT = 'אין מספר וואטסאפ פעיל לליד הזה.'
const SEND_FAILED = 'ההודעה לא נשלחה. נסו שוב.'
const PERSIST_FAILED = 'ההודעה נשלחה אך לא נשמרה בשיחה. רעננו את הדף.'

export async function sendTemplateToLead(
  leadIdRaw: number | string,
  templateIdRaw: number | string,
): Promise<SendTemplateToLeadResult> {
  const leadId = Number(leadIdRaw)
  const templateId = Number(templateIdRaw)
  if (!Number.isFinite(leadId) || leadId <= 0 || !Number.isFinite(templateId) || templateId <= 0) {
    return { ok: false, error: INVALID_INPUT }
  }

  const user = await requireAgencyUser()
  // Defense in depth: the UI is flag-gated, but the action re-checks so an
  // off-agency can never reach the send path even by calling directly.
  if (!isTemplatesEnabledForAgency(user.agencyId)) return { ok: false, error: NOT_AVAILABLE }

  // Template must exist, belong to THIS agency, and be APPROVED (server-enforced).
  const template = await loadTemplateForSend(templateId, user.agencyId)
  if (!template) return { ok: false, error: NOT_FOUND }
  if (template.status !== 'approved') return { ok: false, error: NOT_APPROVED }

  // Resolve the WhatsApp destination + connection token, agency-scoped (shared rules).
  const resolved = await resolveWhatsappOutboundTarget(user.agencyId, leadId)
  if (resolved.ok === false) {
    return { ok: false, error: resolved.reason === 'no-connection' ? NO_CONNECTION : NO_RECIPIENT }
  }
  const { target } = resolved

  // Business name for the {{שם העסק}} chip, agency-scoped.
  const agency = await getAgencyById(user.agencyId)
  const ctx = { leadFullName: target.leadName, businessName: (agency?.name as string | null) ?? null }

  // Positional params in {{1}},{{2}}… order — each guaranteed non-empty (RFC §10).
  const params = resolveTemplateParams(template.bodyText, template.variables, ctx)
  const renderedText = renderResolvedBody(template.bodyText, template.variables, ctx)

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
    // Map the Meta code to friendly Hebrew (never the raw message/code to the UI).
    const mapped = sent.code ? mapWhatsappError(Number(sent.code)).text : SEND_FAILED
    return { ok: false, error: mapped }
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
