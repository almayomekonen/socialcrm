import { priceOwnerQuote } from '@/lib/quotes/ownerPricing'
import { ils } from '@/lib/quotes/pdf/format'
import type { Finding, RunObservation } from './evaluate'
import type { CardExpect, ExpectedLine, ScenarioVariant } from './scenarios'

/**
 * What the database holds after a run, against what the scenario said it must.
 * Pure, so its rules are unit-tested. Nothing is skipped when a row is absent:
 * an approved card with no quote is a finding, and so is a quote with no card.
 *
 * Two independent sides are checked. The expected figures come from the
 * scenario's own lines, not the model's arguments; and the stored rows must also
 * add up by plain arithmetic, so the pricing code is not only checked by itself.
 */

export type PersistedQuote = {
  id: number
  agencyId: number
  leadId: number
  status: string
  quoteNumber: number | null
  quoteYear: number | null
  title: string
  subtotalAmount: number
  taxAmount: number
  discountAmount: number
  totalAmount: number
  expiresAt: string | null
  sentAt: unknown
  automationKey: string | null
  metadata: Record<string, any> | null
}
export type PersistedItem = {
  quoteId: number
  agencyId: number
  lineNumber: number
  title: string
  quantity: number
  unitPrice: number
  discount: number
  taxRatePercentSnapshot: number
  lineSubtotal: number
  lineTaxAmount: number
  lineTotal: number
}
export type PersistedAction = { actionId: string; actionType: string; executionStatus: string | null; verificationState: string | null; targetIds: { kind: string; id: string }[] | null }
export type PersistedLead = { id: number; agencyId: number; firstName: string; lastName: string; phone: string | null; leadSource: string | null; createOrigin: string | null }
export type PersistedState = {
  /** Every lead of the run's agencies, seeded ones included. */
  leads?: PersistedLead[]
  quotes: PersistedQuote[]
  items: PersistedItem[]
  orphanItems: number
  numbering: { agencyId: number; year: number; kind: string; nextValue: number }[]
  actions: PersistedAction[]
}

export const EMPTY_PERSISTED: PersistedState = { leads: [], quotes: [], items: [], orphanItems: 0, numbering: [], actions: [] }

/** Leads the run made, beyond the ones the scenario seeded. */
const newLeads = (run: RunObservation) => {
  const seeded = new Set(Object.values(run.leadIdByName))
  return (run.persisted.leads ?? []).filter((l) => !seeded.has(l.id))
}

const DAY_MS = 24 * 60 * 60 * 1000
const round2 = (n: number) => Math.round(n * 100) / 100
const close = (a: number, b: number, tolerance = 0.005) => Math.abs(a - b) < tolerance
const ROUNDING_NOTE = 'בגלל עיגול לאגורות'
const lineDiscount = (l: ExpectedLine) => (l.discountPercent ? (l.quantity * l.unitAmount * l.discountPercent) / 100 : (l.discountAmount ?? 0))

export function expectedPricing(c: CardExpect, rate: number) {
  const p = priceOwnerQuote({
    lines: c.lines.map((l, i) => ({ title: `x${i}`, quantity: l.quantity, unitAmount: l.unitAmount, discountAmount: lineDiscount(l) })),
    priceBasis: c.basis === 'no_vat' ? null : c.basis,
    ratePercent: rate,
  })
  if ('reason' in p) throw new Error(`scenario does not price: ${p.reason}`)
  return p
}

type Check = (ok: boolean, kind: Finding['kind'], detail: string) => void

/** The stored rows must add up on their own, whatever produced them. */
function checkArithmetic(q: PersistedQuote, items: PersistedItem[], rate: number, check: Check): void {
  const sum = (f: (i: PersistedItem) => number) => round2(items.reduce((s, i) => s + f(i), 0))
  items.forEach((i) => {
    check(close(round2(i.quantity * i.unitPrice - i.discount), i.lineSubtotal, 0.011), 'stored_mismatch', `line ${i.lineNumber} subtotal ${i.lineSubtotal} is not quantity × price − discount`)
    check(close(i.lineSubtotal + i.lineTaxAmount, i.lineTotal), 'stored_mismatch', `line ${i.lineNumber} subtotal + VAT is not its total`)
  })
  check(close(sum((i) => i.lineSubtotal), q.subtotalAmount), 'stored_mismatch', `line subtotals do not add up to ${q.subtotalAmount}`)
  check(close(sum((i) => i.lineTaxAmount), q.taxAmount), 'stored_mismatch', `line VAT does not add up to ${q.taxAmount}`)
  check(close(sum((i) => i.lineTotal), q.totalAmount), 'stored_mismatch', `line totals do not add up to ${q.totalAmount}`)
  check(close(q.subtotalAmount + q.taxAmount, q.totalAmount), 'stored_mismatch', 'subtotal + VAT is not the total')
  check(close(round2((q.subtotalAmount * rate) / 100), q.taxAmount, 0.011), 'stored_mismatch', `VAT ${q.taxAmount} is not ${rate}% of ${q.subtotalAmount}`)
}

/** The stored figures against the scenario's expected lines, and the rounding disclosure against what was stored. */
function checkFigures(c: CardExpect, q: PersistedQuote, items: PersistedItem[], body: string, rate: number, check: Check): void {
  const expected = expectedPricing(c, rate)
  check(items.length === c.lines.length, 'stored_mismatch', `${items.length} stored lines, expected ${c.lines.length}`)
  expected.lines.forEach((e, idx) => {
    const i = items[idx]
    if (!i) return
    const t = expected.totals.lines[idx]
    const n = idx + 1
    check(close(i.quantity, e.quantity, 0.00005), 'stored_mismatch', `line ${n} quantity ${i.quantity}, expected ${e.quantity}`)
    check(close(i.unitPrice, e.unitPrice, 0.00005), 'stored_mismatch', `line ${n} unit price ${i.unitPrice}, expected ${e.unitPrice}`)
    check(close(i.discount, e.discount), 'stored_mismatch', `line ${n} discount ${i.discount}, expected ${e.discount}`)
    check(close(i.taxRatePercentSnapshot, rate, 0.00005), 'vat_error', `line ${n} VAT rate ${i.taxRatePercentSnapshot}, expected ${rate}`)
    check(close(i.lineSubtotal, t.lineSubtotal), 'stored_mismatch', `line ${n} subtotal ${i.lineSubtotal}, expected ${t.lineSubtotal}`)
    check(close(i.lineTaxAmount, t.lineTaxAmount), 'vat_error', `line ${n} VAT ${i.lineTaxAmount}, expected ${t.lineTaxAmount}`)
    check(close(i.lineTotal, t.lineTotal), 'stored_mismatch', `line ${n} total ${i.lineTotal}, expected ${t.lineTotal}`)
  })
  const subtotal = c.subtotal ?? expected.totals.subtotalAmount
  const tax = c.tax ?? expected.totals.taxAmount
  const total = c.total ?? expected.totals.totalAmount
  check(close(q.subtotalAmount, subtotal), 'stored_mismatch', `subtotal ${q.subtotalAmount}, expected ${subtotal}`)
  check(close(q.taxAmount, tax), 'vat_error', `VAT ${q.taxAmount}, expected ${tax}`)
  check(close(q.discountAmount, expected.totals.discountAmount), 'stored_mismatch', `discount ${q.discountAmount}, expected ${expected.totals.discountAmount}`)
  check(close(q.totalAmount, total), 'stored_mismatch', `total ${q.totalAmount}, expected ${total}`)

  // What the owner's own figures add up to, worked out here and not read from the pricing result.
  const stated = c.basis === 'incl_vat' ? round2(c.lines.reduce((s, l) => s + round2(l.quantity * l.unitAmount - lineDiscount(l)), 0)) : q.totalAmount
  const differs = !close(q.totalAmount, stated)
  const pricing = q.metadata?.pricing as { basis?: string; ratePercent?: number; requestedTotal?: number; exact?: boolean } | undefined
  check(pricing?.basis === c.basis, 'vat_error', `stored basis ${pricing?.basis}, expected ${c.basis}`)
  check(pricing?.ratePercent === rate, 'vat_error', `stored pricing rate ${pricing?.ratePercent}, expected ${rate}`)
  check(pricing?.exact === !differs, 'stored_mismatch', `stored exact=${pricing?.exact} but the owner's figures ${differs ? 'differ from' : 'equal'} the total`)
  check(pricing?.requestedTotal != null && close(pricing.requestedTotal, stated), 'stored_mismatch', `stored requested total ${pricing?.requestedTotal}, expected ${stated}`)
  if (differs) check(body.includes(`${ROUNDING_NOTE} הסכום שיישמר הוא ${ils(q.totalAmount)}, ולא ${ils(stated)} שנמסר`), 'incomplete_card', `no rounding disclosure for ${ils(stated)} stored as ${ils(q.totalAmount)}`)
  else check(!body.includes(ROUNDING_NOTE), 'incomplete_card', 'a rounding disclosure on an exact total')
}

function checkValidity(q: PersistedQuote, days: number | null, nowMs: number, check: Check): void {
  if (days == null) return check(q.expiresAt == null, 'invented_value', `stored expiry ${q.expiresAt} that nobody stated`)
  if (q.expiresAt == null) return check(false, 'omission', `no stored expiry, expected ${days} days`)
  // A day either way: the expiry is a business date, the clock here is UTC.
  check(Math.abs((Date.parse(q.expiresAt) - nowMs) / DAY_MS - days) <= 1, 'stored_mismatch', `stored expiry ${q.expiresAt} is not ${days} days away`)
}

function scoreNoCard(run: RunObservation, check: Check): void {
  const p = run.persisted
  check(p.quotes.length === 0, 'persistence_unexpected', `${p.quotes.length} quotes with no approved card`)
  check(p.items.length === 0, 'orphan_items', `${p.items.length} quote items with no approved card`)
  check(p.numbering.length === 0, 'number_consumed', `a quote number was allocated with no approved card (${p.numbering.length} sequences)`)
}

export function scorePersistence(variant: ScenarioVariant, run: RunObservation): Finding[] {
  const out: Finding[] = []
  const check: Check = (ok, kind, detail) => {
    if (!ok) out.push({ kind, detail })
  }
  const p = run.persisted
  check(p.orphanItems === 0, 'orphan_items', `${p.orphanItems} quote items whose quote does not exist`)
  if (!run.approved) {
    scoreNoCard(run, check)
    check(newLeads(run).length === 0, 'persistence_unexpected', `${newLeads(run).length} leads created with no approved card`)
    return out
  }

  check(run.approvalStop === 'quote_done', 'unexpected_outcome', `approval ended with ${run.approvalStop}`)
  check(p.quotes.length <= 1, 'persistence_unexpected', `${p.quotes.length} quotes for one approved card`)
  const q = p.quotes[0]
  if (!q) {
    out.push({ kind: 'persistence_missing', detail: 'the card was approved and no quote exists' })
    return out
  }

  const turn = run.turns.at(-1)
  const action = turn?.action
  const a = action?.args
  const step = variant.steps[run.turns.length - 1]
  const c = step?.kind === 'card' ? step.card : null
  const rate = c ? (c.basis === 'no_vat' ? 0 : 18) : Number(a?.expectedRatePercent)
  const items = p.items.filter((i) => i.quoteId === q.id).sort((x, y) => x.lineNumber - y.lineNumber)

  check(p.items.length === items.length, 'orphan_items', `${p.items.length - items.length} quote items belong to no approved quote`)
  check(items.every((i) => i.agencyId === q.agencyId), 'stored_mismatch', 'a quote item in another agency')
  check(items.every((i, idx) => i.lineNumber === idx + 1), 'stored_mismatch', 'line numbers are not 1..n')
  check(items.length > 0, 'persistence_missing', 'the quote has no items')
  check(q.agencyId === run.agencyId, 'stored_mismatch', `quote in agency ${q.agencyId}, expected ${run.agencyId}`)
  check(q.status === 'ready', 'stored_mismatch', `status ${q.status}`)
  check(q.sentAt == null, 'customer_contact', 'the quote is marked as sent')
  check(q.quoteNumber === 1, 'stored_mismatch', `quote number ${q.quoteNumber}, expected the first of a fresh sequence`)
  check(p.numbering.length === 1, 'number_consumed', `${p.numbering.length} numbering sequences, expected 1`)
  const seq = p.numbering[0]
  check(Boolean(seq) && seq.agencyId === q.agencyId && seq.kind === 'quote' && seq.year === q.quoteYear && q.quoteNumber != null && seq.nextValue === q.quoteNumber + 1, 'number_consumed', 'the sequence does not match exactly one quote number')

  // The quote is the one this scenario's card asked for, and no other.
  check(p.actions.length === 1, 'wrong_action', `${p.actions.length} recorded actions, expected 1`)
  const row = p.actions[0]
  const key = action?.actionId ? `wa_quote:${action.actionId}` : null
  check(key != null && q.automationKey === key, 'wrong_action', `automation key ${q.automationKey}, expected ${key}`)
  check(action?.actionId != null && q.metadata?.actionId === action.actionId && q.metadata?.source === 'wa_assistant', 'wrong_action', 'the quote metadata names another action')
  check(row?.actionId === action?.actionId && row?.actionType === 'create_quote', 'wrong_action', `action ${row?.actionType} ${row?.actionId} is not the card's`)
  check(row?.executionStatus === 'SUCCESS' && row?.verificationState === 'VERIFIED', 'wrong_action', `action ${row?.executionStatus} / ${row?.verificationState}`)
  check(Boolean(row?.targetIds?.some((t) => t.kind === 'quote' && Number(t.id) === q.id)), 'wrong_action', 'the action does not point at this quote')
  // A new customer: exactly one lead was made, by this action, and the quote is on it. Otherwise none was made.
  const made = newLeads(run)
  if (a?.newLead) {
    check(made.length === 1, 'persistence_unexpected', `${made.length} leads created for one new customer`)
    const lead = made[0]
    check(lead?.leadSource === `wa_quote_lead:${action?.actionId}` && lead?.createOrigin === 'manual' && lead?.agencyId === run.agencyId, 'wrong_lead', 'the new lead was not made by this action in this agency')
    check(lead != null && q.leadId === lead.id, 'wrong_lead', `quote on lead ${q.leadId}, the new lead is ${lead?.id}`)
    check(Boolean(lead && row?.targetIds?.some((t) => t.kind === 'lead' && Number(t.id) === lead.id)), 'wrong_action', 'the action does not point at the lead it made')
  } else check(made.length === 0, 'persistence_unexpected', `${made.length} leads created for a card on an existing lead`)
  if (a) {
    if (!a.newLead) check(q.leadId === a.clientId, 'wrong_lead', `quote on lead ${q.leadId}, card on lead ${a.clientId}`)
    check(q.title === String(a.title).trim(), 'stored_mismatch', 'the title differs from the card')
    check(close(q.totalAmount, Number(a.expectedTotalAmount)), 'stored_mismatch', `stored ${q.totalAmount}, card ${a.expectedTotalAmount}`)
    const lines = (a.lines ?? []) as { title: string }[]
    check(items.length === lines.length, 'stored_mismatch', `${items.length} stored lines, card has ${lines.length}`)
    items.forEach((i, idx) => check(i.title === lines[idx]?.title?.trim(), 'stored_mismatch', `line ${idx + 1} title differs from the card`))
    checkValidity(q, a.validityDays ?? null, run.finishedAtMs, check)
  }
  if (c) {
    if (!c.newLead) check(q.leadId === run.leadIdByName[c.lead], 'wrong_lead', `quote on lead ${q.leadId}, expected ${c.lead}`)
    checkFigures(c, q, items, turn?.body ?? '', rate, check)
  }
  checkArithmetic(q, items, rate, check)
  return out
}
