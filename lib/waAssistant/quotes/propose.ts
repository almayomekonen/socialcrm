import 'server-only'
import { submitProposedAction } from '@/lib/agent/actions/bridge'
import { createWaApproval } from '@/db/waAssistantApprovals'
import { MAX_BUTTON_BODY_CHARS } from '@/lib/whatsapp/platform/sendText'
import { resolveConfiguredTaxRateForLine } from '@/db/billing/taxRates'
import { priceOwnerQuote, validQuoteTitle, validValidityDays } from '@/lib/quotes/ownerPricing'
import { canDraftQuote } from '@/lib/quotes/permissions'
import type { UserDb } from '@/db/auth'
import type { AgentScope, EvidenceRef, ProposedAction } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from '../meetings/types'
import { requestMessages } from '../request'
import { chooseLead } from '../leadChoice'
import { discountRequested, freeStated, lineGrounded, statedAmounts, statedBasis, statedPercents, validityStated } from './grounding'
import { QUOTE_COPY, quoteButtons, quoteCard } from './copy'

/**
 * "תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח, 18,500 שקל כולל מע"מ" → a
 * confirmation card, or ONE short question about what is genuinely missing.
 *
 * NOTHING IS CREATED HERE. In order:
 *   1. role: may this user draft quotes at all (`canDraftQuote`);
 *   2. the lead (leadChoice.ts): readable by THIS user; several matches → the
 *      owner chooses;
 *   3. every number grounded in the owner's own messages (./grounding.ts): a
 *      missing or unstated price, quantity or discount → a question;
 *   4. the VAT basis is read from the OWNER'S words, not the model's field;
 *      unstated (with a non-zero rate) → a question;
 *   5. the agency's CONFIGURED rate (no fallback) and the real totals
 *      (`priceOwnerQuote` → `computeQuoteTotals`, the same math the write uses);
 *   6. the application's arguments, including the card's total and rate, are
 *      recorded AWAITING_APPROVAL by the existing Action Runtime, and a
 *      single-use, recipient-bound, 15-minute token binds the buttons.
 */

export type QuoteProposal = Extract<ProposedAction, { actionType: 'create_quote' }>
export type QuoteProposeDeps = { submit?: typeof submitProposedAction; taxRate?: typeof resolveConfiguredTaxRateForLine }

const clarify = (text: string, why: string, lead?: string): MeetingReply => ({
  status: 'answered',
  stopReason: `quote_clarify_${why}`,
  text,
  headline: lead ? `${text} (הצעת מחיר · ליד: ${lead})` : text,
})
const refuse = (stopReason: string, text: string): MeetingReply => ({ status: 'refused', stopReason, text, headline: null })

export async function proposeQuote(input: {
  job: WaAssistantJob
  scope: AgentScope
  proposal: QuoteProposal
  evidence: readonly EvidenceRef[]
  agentRunId: string
  question: string
  nowMs: number
  deps?: QuoteProposeDeps
}): Promise<MeetingReply> {
  const { job, scope, nowMs, proposal: p } = input
  if (!canDraftQuote({ role: scope.role } as UserDb)) return refuse('quote_role_not_allowed', QUOTE_COPY.notAllowed)
  const said = await requestMessages('quote', job, input.question)

  const clientId = Number(p.args.clientId)
  if (!Number.isSafeInteger(clientId) || clientId <= 0) return clarify(QUOTE_COPY.askLead, 'lead')
  const choice = await chooseLead({ scope, proposedId: clientId, evidence: input.evidence, said })
  if ('refused' in choice) return refuse('quote_lead_not_allowed', QUOTE_COPY.leadNotAllowed)
  if ('ask' in choice) return clarify(choice.ask, 'lead')
  const lead = choice.lead

  const proposed = (p.args.lines ?? []).filter((l) => typeof l?.title === 'string' && l.title.trim())
  const title = validQuoteTitle(p.args.title) ? p.args.title.trim() : proposed[0]?.title.trim()
  if (!proposed.length || !validQuoteTitle(title)) return clarify(QUOTE_COPY.askItems, 'items', lead.name)
  const amounts = statedAmounts(said)
  const percents = statedPercents(said)
  if (!proposed.every((l) => lineGrounded(l, amounts, percents))) return clarify(QUOTE_COPY.askPrice, 'price', lead.name)
  // The owner asked for a discount and the proposal carries none: never a clean-looking card without it.
  if (discountRequested(said) && !proposed.some((l) => (l.discountPercent ?? 0) > 0 || (l.discountAmount ?? 0) > 0))
    return clarify(QUOTE_COPY.askDiscount, 'discount', lead.name)

  const validityDays = p.args.validityDays ?? null
  if (validityDays != null && (!validValidityDays(validityDays) || !validityStated(validityDays, said)))
    return clarify(QUOTE_COPY.askValidity, 'validity', lead.name)

  const tax = await (input.deps?.taxRate ?? resolveConfiguredTaxRateForLine)(scope.agencyId)
  if (!tax) return refuse('quote_tax_missing', QUOTE_COPY.taxMissing)
  const stated = statedBasis(said)
  const priceBasis = stated === 'incl_vat' || stated === 'excl_vat' ? stated : null
  if (tax.ratePercent !== 0 && !priceBasis) return clarify(QUOTE_COPY.askVat, 'vat', lead.name)

  const lines = proposed.map((l) => {
    const quantity = l.quantity ?? 1
    const unitAmount = l.unitAmount as number
    const discountPercent = l.discountPercent && l.discountPercent > 0 ? l.discountPercent : null
    const computed = discountPercent != null ? Math.round(quantity * unitAmount * discountPercent) / 100 : null
    return { title: l.title.trim(), quantity, unitAmount, discountAmount: computed ?? (l.discountAmount && l.discountAmount > 0 ? l.discountAmount : null), discountPercent }
  })
  const priced = priceOwnerQuote({
    lines: lines.map(({ discountPercent: _percent, ...l }) => ({ ...l, discountAmount: l.discountAmount ?? undefined })),
    priceBasis,
    ratePercent: tax.ratePercent,
  })
  if ('reason' in priced) {
    if (priced.reason === 'too_many_lines') return refuse('quote_too_many_lines', QUOTE_COPY.tooManyLines)
    if (priced.reason === 'vat_basis_required') return clarify(QUOTE_COPY.askVat, 'vat', lead.name)
    return clarify(QUOTE_COPY.askPrice, 'price', lead.name)
  }
  // A ₪0 quote takes a real number, and "0" alone may be a slip: the owner says it is free before any card exists.
  if (priced.totals.totalAmount === 0 && !freeStated(said)) return clarify(QUOTE_COPY.askFree, 'free', lead.name)

  const text = quoteCard({
    lead: lead.name,
    title,
    lines: priced.lines,
    discountPercents: lines.map((l) => l.discountPercent),
    totals: priced.totals,
    basis: priced.basis,
    ratePercent: priced.ratePercent,
    requestedTotal: priced.requestedTotal,
    exact: priced.exact,
    validityDays,
  })
  // The send path cuts a button message at Meta's limit. A cut card could lose its total, and nobody approves what they cannot see.
  if (text.length > MAX_BUTTON_BODY_CHARS) return refuse('quote_card_too_long', QUOTE_COPY.tooLongForCard)

  const evidenceRefs = p.evidenceRefs.includes(`lead:${lead.id}`) ? p.evidenceRefs : [...p.evidenceRefs, `lead:${lead.id}`]
  const final: QuoteProposal = {
    actionType: 'create_quote',
    args: {
      clientId: lead.id,
      title,
      lines,
      priceBasis,
      validityDays,
      expectedTotalAmount: priced.totals.totalAmount,
      expectedRatePercent: tax.ratePercent,
    },
    evidenceRefs,
  }
  const outcome = await (input.deps?.submit ?? submitProposedAction)({ proposal: final, scope, agentRunId: input.agentRunId })
  if (!outcome || outcome.report !== 'AWAITING_APPROVAL') {
    return { status: 'failed', stopReason: `quote_propose_${outcome?.report ?? 'unparsed'}`, text: QUOTE_COPY.notPrepared, headline: null }
  }
  const { token } = await createWaApproval({
    recipientId: job.recipientId,
    agencyId: scope.agencyId,
    userId: scope.userId,
    jobId: job.id,
    actionId: outcome.actionId,
    argsHash: outcome.argsHash,
    now: new Date(nowMs),
  })
  return {
    status: 'answered',
    stopReason: 'quote_awaiting_approval',
    text,
    buttons: quoteButtons(token),
    headline: 'ממתין לאישור יצירת הצעת מחיר',
  }
}
