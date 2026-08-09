'use server'

import { revalidatePath } from 'next/cache'
import { requireProductAccess } from '@/lib/requireUser'
import { canDraftQuote, canManageQuoteTemplates } from '@/lib/quotes/permissions'
import type { QuoteTemplateDraft } from '@/lib/quotes/templateValidation'
import type { QuoteTemplateState } from '@/db/quotes/templates'
import { listQuoteTemplatesSystem, type QuoteTemplateOption } from '@/db/quotes/templates'
import { saveQuoteTemplateSystem, setQuoteTemplateStateSystem } from '@/db/quotes/templateWrites'
import { resolveActiveTaxRateForLine } from '@/db/billing/taxRates'
import { getAgencyById } from '@/db/agencies'

/**
 * Quote templates — the SESSION-GATED boundary.
 *
 * This is the interactive half of the split the quotation domain was built for:
 *
 *   UI     → actions/quotes/*  → session + product gate → domain primitives
 *   Worker →                                             → domain primitives
 *
 * A cron worker has no cookie, which is why the domain functions take an
 * explicit `agencyId` and never call `requireUser`. THIS file is the only place
 * a session is read; it resolves the tenant from the server-trusted session and
 * passes it down. `agencyId` is never accepted from the wire — a caller may name
 * a template id, and the domain re-reads it under the session's agency before
 * touching anything.
 *
 * The automation worker must never call these actions. It calls the same domain
 * functions directly.
 *
 * Result shape follows the house convention: typed machine codes, translated by
 * the client (`quoteTemplateErrorMessage`), never thrown errors.
 */

const PATH = '/settings/quote-templates'

export type QuoteTemplateActionResult = { ok: true; templateId?: number } | { ok: false; reason: string }

async function requireTemplateAdmin() {
  const user = await requireProductAccess()
  if (!canManageQuoteTemplates(user)) return { user: null, reason: 'forbidden' as const }
  return { user, reason: null }
}

export async function saveQuoteTemplateAction(input: {
  templateId?: number | null
  draft: QuoteTemplateDraft
}): Promise<QuoteTemplateActionResult> {
  const { user, reason } = await requireTemplateAdmin()
  if (!user) return { ok: false, reason }

  const res = await saveQuoteTemplateSystem({
    agencyId: user.agencyId,
    createdByUserId: user.id,
    // Re-read under the session's agency inside the domain write; a template id
    // from the wire can only ever address this tenant's rows.
    templateId: input.templateId ?? null,
    draft: input.draft,
  })
  // `'reason' in res` rather than `!res.ok`: this repo compiles with
  // strictNullChecks off, under which a boolean discriminant does not narrow —
  // the same reason `actions/billing/send.ts` tests `'error' in result`.
  if ('reason' in res) return { ok: false, reason: res.reason }

  revalidatePath(PATH)
  return { ok: true, templateId: res.templateId }
}

export async function setQuoteTemplateStateAction(
  templateId: number,
  state: QuoteTemplateState,
): Promise<QuoteTemplateActionResult> {
  const { user, reason } = await requireTemplateAdmin()
  if (!user) return { ok: false, reason }

  const res = await setQuoteTemplateStateSystem(user.agencyId, templateId, state)
  if ('reason' in res) return { ok: false, reason: res.reason }

  revalidatePath(PATH)
  return { ok: true, templateId }
}

/**
 * Active templates for a picker.
 *
 * Exists so an interactive surface can populate a dropdown without a page load.
 * It is a thin session-gated wrapper over `listQuoteTemplatesSystem` — the SAME
 * primitive the future Automation Builder will reach through its own action, so
 * the two can never disagree about which templates are selectable.
 *
 * Gated on drafting rather than management: choosing a template is using one,
 * and every internal role may do that.
 */
export async function listQuoteTemplateOptionsAction(): Promise<
  { ok: true; options: QuoteTemplateOption[] } | { ok: false; reason: string }
> {
  const user = await requireProductAccess()
  if (!canDraftQuote(user)) return { ok: false, reason: 'forbidden' }
  return { ok: true, options: await listQuoteTemplatesSystem(user.agencyId) }
}

export type QuoteComposerData = {
  templates: QuoteTemplateOption[]
  /**
   * The agency's EFFECTIVE rate — the live VAT row filtered through the
   * business-type rule, so an exempt business previews 0%. Read here so the
   * composer can show a truthful total without storing a rate on the template:
   * VAT stays agency policy, applied when the quote is created.
   */
  taxRatePercent: number
  /** For the document header, so the preview looks like what will be sent. */
  businessName: string
}

/**
 * Everything the inline quotation composer needs, in one round trip.
 *
 * Exists so the first automation install needs no trip to settings: the
 * composer can offer the price lists that already exist AND build a new one in
 * place. Gated on managing templates rather than drafting, because it is the
 * surface that creates them.
 */
export async function getQuoteComposerDataAction(): Promise<
  { ok: true; data: QuoteComposerData } | { ok: false; reason: string }
> {
  const { user, reason } = await requireTemplateAdmin()
  if (!user) return { ok: false, reason }

  const [templates, tax, agency] = await Promise.all([
    listQuoteTemplatesSystem(user.agencyId),
    resolveActiveTaxRateForLine(user.agencyId),
    getAgencyById(user.agencyId),
  ])

  return {
    ok: true,
    data: { templates, taxRatePercent: tax.ratePercent, businessName: String(agency?.name ?? '') },
  }
}
