import { describe, expect, it } from 'vitest'
import { zodSchema } from 'ai'
import { isStated, lineGrounded, statedAmounts, statedBasis, validityStated } from '@/lib/waAssistant/quotes/grounding'
import { answersPending } from '@/lib/waAssistant/continuation'
import { REQUEST_WORDS } from '@/lib/waAssistant/request'
import { agentAnswerSchema } from '@/lib/agent/answerSchema'
import { createQuoteProposal } from '@/lib/agent/waActionSchemas'
import { groundedProposal } from '@/lib/agent/proposalGate'
import { waAgentRules } from '@/lib/waAssistant/agentRules'
import type { ProposedAction } from '@/lib/agent/types'

/**
 * Every number on a quote card must be one the owner said. Pure checks of the
 * grounding rules, the VAT-basis reading, the `quote` request kind, the
 * proposal schema and the evidence gate.
 */

const REQUEST = 'תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח, 18,500 שקל כולל מע"מ.'
const line = (unitAmount: number | null, over: Partial<{ quantity: number | null; discountAmount: number | null }> = {}) => ({
  title: 'שיפוץ מטבח',
  quantity: over.quantity ?? null,
  unitAmount,
  discountAmount: over.discountAmount ?? null,
})

describe('amounts the owner wrote', () => {
  it.each([
    ['18,500 שקל', [18500]],
    ['18500 ש"ח', [18500]],
    ['₪1,234.50', [1234.5]],
    ['18.5 אלף', [18.5, 18500]],
    ['3 חלונות ב-3,000', [3, 3000]],
    ['בלי מספרים', []],
  ])('%s', (text, expected) => {
    expect(statedAmounts([text]).sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b))
  })

  it('reads every message of the request', () => {
    expect(statedAmounts(['18,500', 'הנחה 500'])).toEqual(expect.arrayContaining([18500, 500]))
  })
})

describe('a line is grounded only in what was said', () => {
  const said = statedAmounts([REQUEST])
  it('the stated price, no quantity → grounded', () => expect(lineGrounded(line(18500), said)).toBe(true))
  it('a price nobody said → not grounded', () => expect(lineGrounded(line(15677.97), said)).toBe(false))
  it('a missing price → not grounded', () => expect(lineGrounded(line(null), said)).toBe(false))
  it('an unstated quantity other than 1 → not grounded', () => expect(lineGrounded(line(18500, { quantity: 2 }), said)).toBe(false))
  it('an unstated discount → not grounded', () => expect(lineGrounded(line(18500, { discountAmount: 500 }), said)).toBe(false))
  it('a line amount over a stated quantity ("3 חלונות ב-3,000") → grounded as 3 × 1,000', () => {
    expect(lineGrounded(line(1000, { quantity: 3 }), statedAmounts(['3 חלונות ב-3,000'])))
      .toBe(true)
  })
  it('isStated is exact to the agora', () => {
    expect(isStated(18500, [18500])).toBe(true)
    expect(isStated(18500.01, [18500])).toBe(false)
  })
})

describe('the VAT basis comes from the owner, never assumed', () => {
  it.each([
    ['18,500 כולל מע"מ', 'incl_vat'],
    ['18,500 כולל מעמ', 'incl_vat'],
    ['18,500 כולל המע״מ', 'incl_vat'],
    ['18,500 לפני מע"מ', 'excl_vat'],
    ['18,500 + מע"מ', 'excl_vat'],
    ['18,500 פלוס מע"מ', 'excl_vat'],
    ['18,500 לא כולל מע"מ', 'excl_vat'],
    ['כולל', 'incl_vat'],
    ['לפני', 'excl_vat'],
    ['18,500 שקל', null],
    ['כולל מע"מ? או פלוס מע"מ', 'ambiguous'],
  ])('%s → %s', (text, expected) => {
    expect(statedBasis([text])).toBe(expected)
  })

  it('the newest message that states one decides (answering "המחיר כולל מע"מ?")', () => {
    expect(statedBasis(['לפני', '18,500 שקל'])).toBe('excl_vat')
    expect(statedBasis(['כולל', '18,500 פלוס מע"מ'])).toBe('incl_vat')
  })
})

describe('validity only when stated', () => {
  it.each([
    [30, 'בתוקף ל-30 יום', true],
    [30, 'בתוקף 30 ימים', true],
    [14, 'בתוקף שבועיים', true],
    [7, 'בתוקף לשבוע', true],
    [30, 'בתוקף לחודש', true],
    [30, 'בתוקף שבועיים', false],
    [30, REQUEST, false],
  ])('%i days in "%s" → %s', (days, text, expected) => {
    expect(validityStated(days, [text])).toBe(expected)
  })
})

describe('a quote request across messages', () => {
  it('"הצעת מחיר" opens a quote request', () => {
    expect(REQUEST_WORDS.quote.test(REQUEST)).toBe(true)
    expect(REQUEST_WORDS.quote.test('תכין הצעה מחיר')).toBe(true)
    expect(REQUEST_WORDS.quote.test('מה המחיר של המטבח?')).toBe(false)
  })

  it.each([
    ['quote_clarify_vat', 'כולל', true],
    ['quote_clarify_price', '18,500', true],
    ['quote_clarify_lead', '2', true],
    ['quote_clarify_price', 'תיצור משימה להתקשר לרון', false],
  ])('%s answered by "%s" → continues: %s', (pending, text, expected) => {
    expect(answersPending({ kind: 'quote', pendingStopReason: pending, text, request: [REQUEST] })).toBe(expected)
  })
})

describe('the create_quote proposal', () => {
  const proposal = {
    actionType: 'create_quote',
    args: { clientId: 7, title: 'שיפוץ מטבח', lines: [line(18500)], priceBasis: 'incl_vat', validityDays: null },
    evidenceRefs: ['lead:7'],
  }

  it('parses inside the agent answer, with every key nullable not optional', () => {
    expect(createQuoteProposal.safeParse(proposal).success).toBe(true)
    const answer = { headline: 'h', claims: [], unknown: null, businessState: null, proposedAction: proposal, proposedBatch: null }
    expect(agentAnswerSchema.safeParse(answer).success).toBe(true)
    // An omitted key is refused: Structured Outputs asks for every one.
    expect(createQuoteProposal.safeParse({ ...proposal, args: { ...proposal.args, validityDays: undefined } }).success).toBe(false)
    expect(createQuoteProposal.safeParse({ ...proposal, args: { ...proposal.args, priceBasis: 'with_vat' } }).success).toBe(false)
  })

  it('the emitted JSON Schema lists every quote property as required', () => {
    const js = JSON.stringify(zodSchema(agentAnswerSchema).jsonSchema)
    expect(js).toContain('"create_quote"')
    expect(js).not.toContain('"oneOf"')
  })

  it('the evidence gate keeps it only for a lead a tool returned', () => {
    const evidence = (ids: string[]) => ({ has: (kind: string, id: string) => kind === 'lead' && ids.includes(id) })
    expect(groundedProposal(proposal as ProposedAction, evidence(['7']) as never)).not.toBeNull()
    expect(groundedProposal(proposal as ProposedAction, evidence(['8']) as never)).toBeNull()
  })

  it('the Agent is told about quotes only when the switch is on', () => {
    expect(waAgentRules({ statusOn: false, notesOn: false })).not.toContain('create_quote')
    expect(waAgentRules({ statusOn: false, notesOn: false, quotesOn: true })).toContain('create_quote')
  })
})
