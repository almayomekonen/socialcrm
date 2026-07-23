'use server'

import { db } from '@/config/db'
import { requireAgencyUser } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { validateTemplateInput } from '@/lib/whatsapp/templates/validate'
import { buildComponents, slugifyTemplateName } from '@/lib/whatsapp/templates/components'
import { createTemplateOnMeta } from '@/lib/whatsapp/templates/graph'
import { insertOptimistic } from '@/db/whatsappTemplates'
import { isCreateRateLimited, RATE_LIMIT_MESSAGE } from '@/lib/whatsapp/templates/rateLimit'
import type { Template, TemplateInput } from '@/lib/whatsapp/templates/types'

/**
 * Create a ready-made message: validate → assemble the Meta payload → submit to
 * Meta via the Graph client → persist a local `pending` row → return it.
 *
 * Layering (Sprint 3 contract): UI → this Server Action → service → Graph client
 * → Meta. The token is resolved here from the agency's connection and never
 * leaves the server. Permission is enforced HERE (admin only, RFC §1). On any
 * failure nothing is persisted, so the client's optimistic row is rolled back.
 */

export type CreateTemplateResult = { ok: true; template: Template } | { ok: false; error: string }

const PERM_ERROR = 'אין הרשאה ליצור הודעות מוכנות.'
const CONNECT_ERROR = 'צריך לחבר וואטסאפ עסקי לפני יצירת הודעות מוכנות.'
const INVALID_ERROR = 'יש למלא שם, תוכן ומטרה להודעה.'

const LANGUAGE = 'he'

export async function createTemplate(input: TemplateInput): Promise<CreateTemplateResult> {
  const user = await requireAgencyUser()
  if (!isAdmin(user.role)) return { ok: false, error: PERM_ERROR }

  const valid = validateTemplateInput(input)
  if ('errors' in valid) return { ok: false, error: valid.errors[0] ?? INVALID_ERROR }

  // Token + WABA resolved server-side from the agency's connection; never sent to the client.
  const conn = await db('whatsapp_connections')
    .where({ agency_id: user.agencyId })
    .first('waba_id', 'access_token')
  if (!conn?.waba_id || !conn?.access_token) return { ok: false, error: CONNECT_ERROR }

  // Server-side per-agency throttle (RFC §13) — before any Graph call.
  if (await isCreateRateLimited(user.agencyId)) return { ok: false, error: RATE_LIMIT_MESSAGE }

  // Assemble the Meta payload from the friendly form.
  const existingNames = (await db('whatsapp_templates')
    .where({ wabaId: conn.waba_id, language: LANGUAGE })
    .pluck('name')) as string[]
  const name = slugifyTemplateName(input.displayTitle, existingNames)
  const components = buildComponents(input.bodyText, input.variables)
  const category = input.purpose // RFC §8: the purpose question IS the Meta category

  const meta = await createTemplateOnMeta({
    wabaId: conn.waba_id,
    accessToken: conn.access_token,
    name,
    language: LANGUAGE,
    category,
    components,
  })
  if ('error' in meta) return { ok: false, error: meta.error }

  // Meta accepted → persist the pending row (Meta's async approval arrives by webhook, Sprint 4).
  const template = await insertOptimistic({
    agencyId: user.agencyId,
    wabaId: conn.waba_id,
    metaTemplateId: meta.metaTemplateId,
    name,
    displayTitle: input.displayTitle.trim(),
    language: LANGUAGE,
    category,
    bodyText: input.bodyText.trim(),
    components,
    variables: input.variables,
    createdByUserId: user.id,
  })

  return { ok: true, template }
}
