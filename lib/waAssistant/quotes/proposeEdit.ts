import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '@/config/db'
import { submitProposedAction } from '@/lib/agent/actions/bridge'
import { createWaApproval } from '@/db/waAssistantApprovals'
import { findQuoteUnderReview } from '@/db/quotes/editQuote'
import { findLiveQuoteDelivery } from '@/db/quotes/deliveries'
import { resolveConfiguredTaxRateForLine } from '@/db/billing/taxRates'
import { MAX_BUTTON_BODY_CHARS } from '@/lib/whatsapp/platform/sendText'
import { applyQuoteChanges, type QuoteEditFailure, type StoredQuoteLine } from '@/lib/quotes/edit'
import { priceOwnerQuote, validQuoteTitle, validValidityDays } from '@/lib/quotes/ownerPricing'
import { canDraftQuote } from '@/lib/quotes/permissions'
import { isAdmin, type Roles } from '@/types/roles'
import type { UserDb } from '@/db/auth'
import type { AgentScope, ProposedAction } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from '../meetings/types'
import { QUOTE_COPY, quoteCard } from './copy'
import { DELIVERY_COPY, quoteEditButtons } from './deliveryCopy'
import { isStated, statedAmounts, statedBasis, statedPercents, validityStated } from './grounding'

/**
 * "תשנה את המחיר ל-20,000" → a card showing the whole quote as it would become.
 *
 * NOTHING CHANGES HERE. The application finds the quote from the owner's own
 * open card (the model never names one), every new number must appear in the
 * owner's words, and a tap applies it through the Action Runtime.
 */

export type QuoteEditProposal = Extract<ProposedAction, { actionType: 'edit_quote' }>

const clarify = (text: string, why: string): MeetingReply => ({ status: 'answered', stopReason: `quote_clarify_edit_${why}`, text, headline: text })
const refuse = (stopReason: string, text: string): MeetingReply => ({ status: 'refused', stopReason, text, headline: null })

const EDIT_FAILURE: Record<QuoteEditFailure, string> = {
  nothing_changed: DELIVERY_COPY.noChange,
  line_ambiguous: DELIVERY_COPY.askWhichLine,
  line_not_found: DELIVERY_COPY.lineNotFound,
  price_missing: DELIVERY_COPY.askNewPrice,
  vat_basis_required: QUOTE_COPY.askVat,
  discount_exceeds_price: DELIVERY_COPY.discountTooHigh,
  no_lines_left: DELIVERY_COPY.noLinesLeft,
}

export async function proposeQuoteEdit(input: { job: WaAssistantJob; scope: AgentScope; proposal: QuoteEditProposal; agentRunId: string; question: string; nowMs: number }): Promise<MeetingReply> {
  const { job, scope, nowMs, proposal: p } = input
  if (!canDraftQuote({ role: scope.role } as UserDb)) return refuse('quote_edit_role_not_allowed', DELIVERY_COPY.notAllowed)

  const quoteId = await findQuoteUnderReview({ agencyId: scope.agencyId, userId: scope.userId, recipientId: job.recipientId, now: new Date(nowMs) })
  if (quoteId == null) return refuse('quote_edit_no_quote', DELIVERY_COPY.noQuote)
  const quote = (await db('sales_quotes').where({ id: quoteId, agencyId: scope.agencyId, status: 'ready' }).first('leadId', 'title', 'version', 'quoteNumber', 'totalAmount', 'recipientNameSnapshot')) as
    | { leadId: number; title: string; version: number; quoteNumber: number | string | null; totalAmount: number | string; recipientNameSnapshot: string | null }
    | undefined
  if (!quote) return refuse('quote_edit_no_quote', DELIVERY_COPY.noQuote)
  const visible = db('clients').where({ id: quote.leadId, agencyId: scope.agencyId })
  if (!isAdmin(scope.role as Roles)) visible.whereIn('userId', scope.gotPermIds ?? [])
  if (!(await visible.first('id'))) return refuse('quote_edit_lead_not_allowed', DELIVERY_COPY.notAllowed)

  if (await findLiveQuoteDelivery(scope.agencyId, quoteId)) return refuse('quote_edit_delivery_live', DELIVERY_COPY.editStale)

  // Every new number is in the owner's own message. Unchanged lines keep their stored values.
  const said = [input.question]
  const amounts = statedAmounts(said)
  const percents = statedPercents(said)
  const grounded = p.args.changes.every(
    (c) => [c.unitAmount, c.discountAmount, c.quantity].every((n) => n == null || isStated(n, amounts)) && (c.discountPercent == null || percents.some((v) => Math.abs(v - c.discountPercent!) < 0.005)),
  )
  if (!grounded) return clarify(DELIVERY_COPY.askNewPrice, 'price')
  const validityDays = p.args.validityDays ?? null
  if (validityDays != null && (!validValidityDays(validityDays) || !validityStated(validityDays, said))) return clarify(QUOTE_COPY.askValidity, 'validity')

  const tax = await resolveConfiguredTaxRateForLine(scope.agencyId)
  if (!tax) return refuse('quote_tax_missing', QUOTE_COPY.taxMissing)
  const stated = statedBasis(said)
  const priceBasis = stated === 'incl_vat' || stated === 'excl_vat' ? stated : null

  const items = (await db('sales_quote_items').where({ agencyId: scope.agencyId, quoteId }).orderBy('lineNumber', 'asc').select('title', 'description', 'quantity', 'unitPrice', 'discount')) as { title: string; description: string; quantity: string; unitPrice: string; discount: string }[]
  const stored: StoredQuoteLine[] = items.map((i) => ({ title: i.title, description: i.description ?? '', quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), discount: Number(i.discount) }))
  const newTitle = p.args.title?.trim() || null
  if (newTitle && !validQuoteTitle(newTitle)) return clarify(DELIVERY_COPY.noChange, 'title')

  const applied = p.args.changes.length ? applyQuoteChanges(stored, p.args.changes, { priceBasis, ratePercent: tax.ratePercent }) : { ok: true as const, lines: stored }
  if ('reason' in applied) return clarify(EDIT_FAILURE[applied.reason], applied.reason)
  if (!p.args.changes.length && !newTitle && validityDays == null) return clarify(DELIVERY_COPY.noChange, 'nothing')

  const priced = priceOwnerQuote({ lines: applied.lines.map((l) => ({ title: l.title, description: l.description, quantity: l.quantity, unitAmount: l.unitPrice, discountAmount: l.discount })), priceBasis: 'excl_vat', ratePercent: tax.ratePercent })
  if ('reason' in priced) return clarify(DELIVERY_COPY.noChange, priced.reason)

  const version = Number(quote.version)
  const number = quote.quoteNumber == null ? '' : ` מספר ${quote.quoteNumber}`
  const title = newTitle ?? quote.title
  const text = quoteCard({
    heading: `*לעדכן את הצעת המחיר${number}?*`,
    lead: quote.recipientNameSnapshot ?? '',
    title,
    lines: priced.lines,
    totals: priced.totals,
    basis: priced.basis,
    basisNote: '(מחירי הפריטים לפני מע"מ.)',
    ratePercent: priced.ratePercent,
    requestedTotal: priced.requestedTotal,
    exact: true,
    validityDays,
    closing: ['אחרי האישור יופק PDF חדש, והאישור הקודם לשליחה יתבטל.', 'לא יישלח דבר ללקוח לפני שתאשרו את הגרסה החדשה.', 'האישור בתוקף ל-15 דקות.'],
  })
  if (text.length > MAX_BUTTON_BODY_CHARS) return refuse('quote_card_too_long', QUOTE_COPY.tooLongForCard)

  const outcome = await submitProposedAction({
    proposal: {
      actionType: 'edit_quote',
      args: { quoteId, expectedVersion: version, title, lines: applied.lines, validityDays, expectedTotalAmount: priced.totals.totalAmount, expectedRatePercent: tax.ratePercent },
      evidenceRefs: [`lead:${quote.leadId}`],
    },
    scope,
    agentRunId: input.agentRunId || `quote_edit:${randomUUID()}`,
    nowMs,
  })
  if (!outcome || outcome.report !== 'AWAITING_APPROVAL') return { status: 'failed', stopReason: `quote_edit_propose_${outcome?.report ?? 'unparsed'}`, text: DELIVERY_COPY.editFailed, headline: null }
  const { token } = await createWaApproval({ recipientId: job.recipientId, agencyId: scope.agencyId, userId: scope.userId, jobId: job.id, actionId: outcome.actionId, argsHash: outcome.argsHash, now: new Date(nowMs) })
  return { status: 'answered', stopReason: 'quote_edit_awaiting_approval', text, buttons: quoteEditButtons(token), headline: 'ממתין לאישור עדכון הצעת מחיר' }
}
