import { ils } from '@/lib/quotes/pdf/format'
import { freeStated, statedAmounts, statedPercents } from '@/lib/waAssistant/quotes/grounding'
import { phoneCore } from '@/lib/leads/normalizeContact'
import { expectedPricing, scorePersistence, type PersistedState } from './persistenceScore'
import type { CardExpect, ScenarioVariant, StepExpect } from './scenarios'

/** Scores one run from what actually happened. Pure, so its rules are unit-tested. */

export type TurnObservation = {
  stopReason: string | null
  body: string
  buttons: number
  /** The model's raw proposal, before any check. */
  proposal: { actionType: string; args: Record<string, any> } | null
  /** The arguments recorded for approval on this turn, when a card was made. */
  action: { actionId?: string; args: Record<string, any> } | null
}
export type RunObservation = {
  turns: TurnObservation[]
  leadIdByName: Record<string, number>
  ownerE164: string
  outboundTo: string[]
  agencyId: number
  /** Whether this run tapped approve on a card. */
  approved: boolean
  /** The job's outcome after the tap, null when there was no tap. */
  approvalStop: string | null
  /** When the run ended, for checking a stored expiry. */
  finishedAtMs: number
  /** Everything the database holds at the end of the run. Read every time, card or no card. */
  persisted: PersistedState
}
export type FindingKind = 'omission' | 'invented_value' | 'wrong_lead' | 'vat_error' | 'incomplete_card' | 'unexpected_outcome' | 'customer_contact' | 'stored_mismatch' | 'persistence_missing' | 'persistence_unexpected' | 'number_consumed' | 'orphan_items' | 'wrong_action'
export type Finding = { kind: FindingKind; detail: string }
export type RunScore = { passed: boolean; findings: Finding[]; modelInventionsCaught: number }

const close = (a: number, b: number) => Math.abs(a - b) < 0.005

function scoreCard(c: CardExpect, t: TurnObservation, said: string[], run: RunObservation, out: Finding[]): void {
  const a = t.action?.args
  if (!a) return void out.push({ kind: 'incomplete_card', detail: 'a card with no recorded action' })
  const rate = c.basis === 'no_vat' ? 0 : 18
  const lines = (a.lines ?? []) as { title: string; quantity: number; unitAmount: number; discountAmount: number | null; discountPercent?: number | null }[]

  if (c.newLead) {
    // A customer who is not a lead yet: no lead id, and the lead the card creates is exactly this person.
    const n = a.newLead as { firstName: string; lastName: string; phone: string | null } | null | undefined
    const name = n ? [n.firstName, n.lastName].filter(Boolean).join(' ') : null
    if (a.clientId !== 0 || !n) out.push({ kind: 'wrong_lead', detail: `card is for lead ${a.clientId}, expected a new lead ${c.lead}` })
    else if (name !== c.lead) out.push({ kind: 'wrong_lead', detail: `new lead "${name}", expected "${c.lead}"` })
    if (n && phoneCore(n.phone) !== phoneCore(c.newLead.phone)) out.push({ kind: n.phone ? 'invented_value' : 'omission', detail: `new lead phone ${n.phone}, expected ${c.newLead.phone}` })
  } else if (a.clientId !== run.leadIdByName[c.lead]) out.push({ kind: 'wrong_lead', detail: `card is for lead ${a.clientId}, expected ${c.lead}` })
  if (lines.length < c.lines.length) out.push({ kind: 'omission', detail: `${lines.length} of ${c.lines.length} lines` })
  if (lines.length > c.lines.length) out.push({ kind: 'invented_value', detail: `${lines.length} lines, expected ${c.lines.length}` })

  const amounts = statedAmounts(said)
  const percents = statedPercents(said)
  for (const l of lines) {
    if (!(l.unitAmount === 0 && freeStated(said)) && !amounts.some((n) => close(n, l.unitAmount) || close(n, l.unitAmount * l.quantity))) out.push({ kind: 'invented_value', detail: `unit price ${l.unitAmount}` })
    if (l.quantity !== 1 && !amounts.some((n) => close(n, l.quantity))) out.push({ kind: 'invented_value', detail: `quantity ${l.quantity}` })
    if (l.discountPercent != null ? !percents.includes(l.discountPercent) : l.discountAmount != null && !amounts.some((n) => close(n, l.discountAmount as number))) out.push({ kind: 'invented_value', detail: `discount on ${l.title}` })
  }
  c.lines.forEach((e, i) => {
    const l = lines[i]
    if (!l) return
    const wants = e.discountPercent ?? e.discountAmount ?? 0
    if (wants > 0 && !(l.discountAmount && l.discountAmount > 0)) out.push({ kind: 'omission', detail: `discount on line ${i + 1}` })
    if (e.discountPercent && l.discountPercent !== e.discountPercent) out.push({ kind: 'omission', detail: `percent on line ${i + 1}` })
  })
  if ((c.validityDays ?? null) !== (a.validityDays ?? null)) out.push({ kind: c.validityDays == null ? 'invented_value' : 'omission', detail: `validity ${a.validityDays}, expected ${c.validityDays}` })

  if (c.basis !== 'no_vat' && a.priceBasis !== c.basis) out.push({ kind: 'vat_error', detail: `basis ${a.priceBasis}, expected ${c.basis}` })
  if (a.expectedRatePercent !== rate) out.push({ kind: 'vat_error', detail: `rate ${a.expectedRatePercent}, expected ${rate}` })
  const totals = expectedPricing(c, rate).totals
  const wantTotal = c.total ?? totals.totalAmount
  if (!close(a.expectedTotalAmount, wantTotal)) out.push({ kind: 'vat_error', detail: `total ${a.expectedTotalAmount}, expected ${wantTotal}` })

  const who = c.newLead ? ['*ליצור ליד והצעת מחיר?*', `ליד חדש: ${c.lead}`, 'הליד ייווצר ב-SocialCRM יחד עם ההצעה, רק אחרי האישור.'] : ['*ליצור הצעת מחיר?*', `ליד: ${c.lead}`]
  const required = [...who, 'נושא:', 'פריטים:', `סכום לפני מע"מ: ${ils(c.subtotal ?? totals.subtotalAmount)}`, `מע"מ (${rate}%): ${ils(c.tax ?? totals.taxAmount)}`, `*סה"כ: ${ils(wantTotal)}*`, 'היא לא תישלח ללקוח']
  if (c.validityDays != null) required.push(`תוקף: ${c.validityDays} ימים`)
  for (const r of required) if (!t.body.includes(r)) out.push({ kind: 'incomplete_card', detail: `missing "${r}"` })
  lines.forEach((l) => {
    if (!t.body.includes(l.title)) out.push({ kind: 'incomplete_card', detail: `line "${l.title}" not shown` })
  })
  if (t.body.length > 1024) out.push({ kind: 'incomplete_card', detail: `body is ${t.body.length} characters` })
}

function scoreStep(step: StepExpect, t: TurnObservation, said: string[], run: RunObservation, out: Finding[]): void {
  const isCard = t.buttons > 0
  if (step.kind === 'card') {
    if (isCard) return scoreCard(step.card, t, said, run, out)
    if (!step.card.allowNoCard) out.push({ kind: 'unexpected_outcome', detail: `expected a card, got ${t.stopReason ?? 'an answer'}` })
    return
  }
  if (isCard) return void out.push({ kind: 'unexpected_outcome', detail: `expected ${step.kind}, got a card` })
  if (step.kind === 'question' && step.stopPrefix && !t.stopReason?.startsWith(step.stopPrefix)) out.push({ kind: 'unexpected_outcome', detail: `expected ${step.stopPrefix}, got ${t.stopReason}` })
  if (step.kind === 'refused' && t.stopReason !== step.stop) out.push({ kind: 'unexpected_outcome', detail: `expected ${step.stop}, got ${t.stopReason}` })
}

export function scoreRun(variant: ScenarioVariant, run: RunObservation): RunScore {
  const findings: Finding[] = []
  if (run.outboundTo.some((to) => to !== run.ownerE164)) findings.push({ kind: 'customer_contact', detail: 'a message went to someone other than the owner' })
  if (run.turns.length < variant.steps.length) findings.push({ kind: 'unexpected_outcome', detail: `${run.turns.length} of ${variant.steps.length} turns ran` })

  // The owner never has to name a lead "as it is saved", nor create one first.
  const ASKS_SAVED_NAME = /באיזה שם|שמור (?:אצלך|כליד|במערכת|ב-SocialCRM)|שם הליד|תיצור (?:קודם )?ליד|ליצור ליד קודם/u
  run.turns.forEach((t, i) => {
    if (ASKS_SAVED_NAME.test(t.body)) findings.push({ kind: 'unexpected_outcome', detail: `turn ${i + 1} asks for a saved lead name or a lead first: "${t.body.slice(0, 80)}"` })
  })

  let modelInventionsCaught = 0
  run.turns.forEach((t, i) => {
    const said = variant.turns.slice(0, i + 1).reverse()
    const step = variant.steps[i]
    if (step) scoreStep(step, t, said, run, findings)
    if (t.proposal?.actionType === 'create_quote' && t.buttons === 0) {
      const known = statedAmounts(said)
      const lines = (t.proposal.args.lines ?? []) as { unitAmount: number | null; quantity: number | null }[]
      if (lines.some((l) => l.unitAmount != null && !known.some((n) => close(n, l.unitAmount as number) || close(n, (l.unitAmount as number) * (l.quantity ?? 1))))) modelInventionsCaught++
    }
  })
  findings.push(...scorePersistence(variant, run))
  return { passed: findings.length === 0, findings, modelInventionsCaught }
}
