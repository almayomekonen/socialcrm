'use server'

import { db } from '@/config/db'
import { requireAgencyUser } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { validateTemplateInput } from '@/lib/whatsapp/templates/validate'
import { buildComponents, hasUnexampledParameters } from '@/lib/whatsapp/templates/components'
import { bodyParameterCount } from '@/lib/whatsapp/templates/parameters'
import { editTemplateOnMeta } from '@/lib/whatsapp/templates/graph'
import { loadTemplateForEdit, updateTemplateContent } from '@/db/whatsappTemplates'
import type { Template, TemplateInput } from '@/lib/whatsapp/templates/types'

/**
 * Safe edit-in-place of an APPROVED template (RFC R-B hybrid amendment, MVP §1).
 *
 * Only the wording changes; the template's SHAPE is preserved: same category, same
 * parameter arity, same name, same language. That guarantee is what makes it safe —
 * a send can never break and no staging is needed (Meta keeps the approved version
 * live during its re-review, and our arity is unchanged so params always match).
 *
 * Any unsupported shape change (category or arity) does NOT mutate the template —
 * it returns `needsNew: true` so the UI routes the user to create-new. Non-approved
 * templates and non-admins are refused. Layering: UI → this action → service
 * (`editTemplateOnMeta`) → Graph → Meta. Token resolved server-side, never returned.
 */

export type EditTemplateResult = { ok: true; template: Template } | { ok: false; error: string; needsNew?: boolean }

const PERM_ERROR = 'אין הרשאה לערוך הודעות מוכנות.'
const INVALID_INPUT = 'בקשה לא תקינה.'
const NOT_FOUND = 'ההודעה המוכנה לא נמצאה.'
const NOT_APPROVED = 'אפשר לערוך רק הודעה שאושרה.'
const CONNECT_ERROR = 'צריך לחבר וואטסאפ עסקי כדי לערוך הודעות.'
const INVALID_CONTENT = 'יש למלא שם ותוכן להודעה.'
const NEEDS_NEW_CATEGORY = 'שינוי מטרת ההודעה דורש יצירת הודעה חדשה.'
const NEEDS_NEW_ARITY = 'שינוי מספר הפרטים האישיים בהודעה דורש יצירת הודעה חדשה.'
const GENERIC = 'משהו השתבש בשמירת ההודעה. נסו שוב.'

/** Positional arity a body+variables assemble to (built `{{n}}` count). */
function arityOf(bodyText: string, variables: TemplateInput['variables']): number {
  return bodyParameterCount(buildComponents(bodyText, variables)[0]?.text ?? '')
}

export async function editTemplate(idRaw: number | string, input: TemplateInput): Promise<EditTemplateResult> {
  const id = Number(idRaw)
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: INVALID_INPUT }

  const user = await requireAgencyUser()
  if (!isAdmin(user.role)) return { ok: false, error: PERM_ERROR }

  // Load current state, agency-scoped.
  const existing = await loadTemplateForEdit(id, user.agencyId)
  if (!existing) return { ok: false, error: NOT_FOUND }
  // Safe path is APPROVED only (rejected/paused editing is deferred).
  if (existing.status !== 'approved' || !existing.metaTemplateId) return { ok: false, error: NOT_APPROVED }

  const valid = validateTemplateInput(input)
  if ('errors' in valid) return { ok: false, error: valid.errors[0] ?? INVALID_CONTENT }

  // Same-shape guards (defense in depth; the UI also locks category). An unsupported
  // change never mutates the template — it routes the user to create-new.
  if (input.purpose !== existing.category) return { ok: false, error: NEEDS_NEW_CATEGORY, needsNew: true }
  if (arityOf(input.bodyText, input.variables) !== arityOf(existing.bodyText, existing.variables)) {
    return { ok: false, error: NEEDS_NEW_ARITY, needsNew: true }
  }

  const components = buildComponents(input.bodyText, input.variables)
  if (hasUnexampledParameters(components)) return { ok: false, error: INVALID_CONTENT }

  // Token resolved server-side; never returned to the client.
  const conn = await db('whatsapp_connections').where({ agency_id: user.agencyId }).first('access_token')
  if (!conn?.access_token) return { ok: false, error: CONNECT_ERROR }

  // Submit the edit to Meta FIRST — persist locally only on success, so a failed
  // Meta edit never mutates our content.
  const meta = await editTemplateOnMeta(existing.metaTemplateId, conn.access_token, { components })
  if ('error' in meta) return { ok: false, error: meta.error }

  const template = await updateTemplateContent(id, user.agencyId, {
    displayTitle: input.displayTitle.trim(),
    bodyText: input.bodyText.trim(),
    components,
    variables: input.variables,
  })
  if (!template) return { ok: false, error: GENERIC }

  return { ok: true, template }
}
