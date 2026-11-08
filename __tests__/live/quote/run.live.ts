import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

/**
 * H1–H19 through the real WhatsApp path on a local test database: inbound
 * handling, worker, real Agent and tools, gates, card, tap, runtime, write.
 * Replaced: Meta (captured), the PDF step (a no-op) and, in self mode, the model.
 *
 * One complete pass runs every scenario once, then the remaining wordings of the
 * scenarios that have several, so a run the budget stops still covers all
 * nineteen first. Results are appended as they happen.
 */
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { runAgentInvestigation } from '@/lib/agent/run'
import { agency, recipient, user } from '../../ownerWhatsappReminders/reminderFixtures'
import { AUTHORIZED_AGENCY, EXEMPT_AGENCY, type LiveContext } from './env'
import { SCENARIOS, variantFor, type CardExpect, type Scenario, type ScenarioVariant } from './scenarios'
import { scoreRun, type RunObservation, type RunScore, type TurnObservation } from './evaluate'

const ctx = (globalThis as unknown as { __quoteLive: LiveContext }).__quoteLive
const REPORT_DIR = process.env.QUOTE_LIVE_REPORT_DIR || path.join('node_modules', '.cache', 'quote-live')
const JSONL = path.join(REPORT_DIR, `${ctx.mode}.jsonl`)
const TABLES = ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']
let seq = 0

async function reset() {
  for (const t of TABLES) await db(t).del()
  await db('platform_whatsapp_inbound').del()
  await db('sales_quotes').whereIn('agencyId', [AUTHORIZED_AGENCY, EXEMPT_AGENCY]).del()
  await db('bill_numbering_sequences').whereIn('agencyId', [AUTHORIZED_AGENCY, EXEMPT_AGENCY]).del()
  await db('owner_whatsapp_recipients').whereIn('agencyId', [AUTHORIZED_AGENCY, EXEMPT_AGENCY]).del()
  await db('clients').whereIn('agencyId', [AUTHORIZED_AGENCY, EXEMPT_AGENCY]).del()
}

/** What the scripted model says in self mode: the right answer, or nothing where a question is right. */
function scriptTurn(s: Scenario, v: ScenarioVariant, turn: number, leads: Record<string, number>) {
  if (!ctx.fake) return
  const step = v.steps[turn]
  const named = /דוד כהן/.test(v.turns[0]) ? 'דוד כהן' : /דוד/.test(v.turns[0]) ? 'דוד' : null
  const c: CardExpect | null = step?.kind === 'card' ? step.card : s.id === 'H4' ? { lead: 'דוד כהן', basis: 'incl_vat', lines: [{ quantity: 1, unitAmount: 18500 }] } : null
  const priced = (lines: CardExpect['lines'], basis: CardExpect['basis']) => ({
    lines: lines.map((l, i) => ({ title: `פריט ${i + 1}`, quantity: l.quantity === 1 ? null : l.quantity, unitAmount: l.unitAmount, discountAmount: l.discountAmount ?? null, discountPercent: l.discountPercent ?? null })),
    priceBasis: basis === 'no_vat' ? null : s.id === 'H4' && turn === 0 ? null : basis,
  })
  if (s.id === 'H16') {
    const id = leads['דוד כהן']
    ctx.fake.next = { findName: 'דוד כהן', headline: 'h', proposal: { actionType: 'create_quote', args: { clientId: id, title: 'חלונות', lines: Array.from({ length: 30 }, (_, i) => ({ title: `חלון ${i + 1}`, quantity: null, unitAmount: 100, discountAmount: null, discountPercent: null })), priceBasis: 'incl_vat', validityDays: null }, evidenceRefs: [`lead:${id}`] } }
    return
  }
  if ((s.id === 'H9' || s.id === 'H10') && turn === 0) {
    const id = leads['דוד כהן']
    ctx.fake.next = { findName: 'דוד כהן', headline: 'h', proposal: { actionType: 'create_quote', args: { clientId: id, title: 'שיפוץ מטבח', lines: [{ title: 'שיפוץ מטבח', quantity: null, unitAmount: 18500, discountAmount: null, discountPercent: null }], priceBasis: 'incl_vat', validityDays: null }, evidenceRefs: [`lead:${id}`] } }
    return
  }
  if (s.id === 'H5' && turn === 0) {
    const id = leads['דוד כהן']
    ctx.fake.next = { findName: 'דוד', headline: 'h', proposal: { actionType: 'create_quote', args: { clientId: id, title: 'שיפוץ מטבח', lines: [{ title: 'שיפוץ מטבח', quantity: null, unitAmount: 18500, discountAmount: null, discountPercent: null }], priceBasis: 'incl_vat', validityDays: null }, evidenceRefs: [`lead:${id}`] } }
    return
  }
  if (!c) {
    ctx.fake.next = { findName: null, headline: 'לאיזה ליד?', proposal: null }
    return
  }
  const id = leads[c.lead]
  ctx.fake.next = { findName: named, headline: 'h', proposal: { actionType: 'create_quote', args: { clientId: id, title: 'שיפוץ מטבח', ...priced(c.lines, c.basis), validityDays: c.validityDays ?? null }, evidenceRefs: [`lead:${id}`] } }
}

async function runScenario(s: Scenario, repeat: number): Promise<{ variant: ScenarioVariant; run: RunObservation; score: RunScore; costUsd: number }> {
  await reset()
  const before = ctx.budget.spentUsd
  const agencyId = s.agency === 'authorized' ? AUTHORIZED_AGENCY : EXEMPT_AGENCY
  await db('agencies').where({ id: agencyId }).update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
  const owner = await user(agencyId, 'ADMIN')
  const digits = `9725000079${String(++seq % 100).padStart(2, '0')}`
  await recipient(agencyId, owner, digits, undefined, 'v4')
  const leadIdByName: Record<string, number> = {}
  for (const [firstName, lastName] of s.leads) {
    const [c] = await db('clients').insert({ firstName, lastName, phone: `05277${String(10000 + ++seq)}`, agencyId, userId: owner, createdById: owner, lead: true, status: 'new' }).returning('id')
    leadIdByName[`${firstName} ${lastName}`] = Number(c.id)
  }

  const variant = variantFor(s, repeat)
  const outboundTo: string[] = []
  let replies: { body: string; buttons?: { id: string }[] }[] = []
  let proposal: TurnObservation['proposal'] = null
  const deps = {
    runAgent: (async (input: Parameters<typeof runAgentInvestigation>[0]) => {
      const r = await runAgentInvestigation(input)
      proposal = r.ok === true ? ((r.answer.proposedAction ?? null) as typeof proposal) : null
      if (process.env.QUOTE_LIVE_DEBUG) console.log('[quote-live][agent]', JSON.stringify({ ok: r.ok, reason: r.ok === true ? null : r.reason, message: r.ok === true ? null : (r as { message?: string }).message, evidence: r.ok === true ? r.evidence : null, proposal }).slice(0, 700))
      return r
    }) as never,
    sendText: (async (i: { toE164: string; body: string; buttons?: { id: string }[] }) => {
      outboundTo.push(i.toE164)
      replies.push({ body: i.body, buttons: i.buttons })
      return { kind: 'sent' as const, wamid: `wamid.LIVE_${++seq}` }
    }) as never,
    typing: (async () => undefined) as never,
    quotes: { decide: { startPdf: (async () => 'skipped') as never } },
  }
  const inbound = (extra: Record<string, unknown>) => processPlatformMessage({ id: `wamid.__live_${++seq}`, from: digits, timestamp: String(Math.floor(Date.now() / 1000)), ...extra } as never)

  const turns: TurnObservation[] = []
  for (let i = 0; i < variant.turns.length && !ctx.budget.stopped; i++) {
    replies = []
    proposal = null
    scriptTurn(s, variant, i, leadIdByName)
    await inbound({ type: 'text', text: { body: variant.turns[i] } })
    await runWaAssistantWorker({}, deps)
    const job = (await db('wa_assistant_jobs').orderBy('id', 'desc').first('stopReason')) as { stopReason: string | null }
    const action = (await db('agent_actions').where({ agencyId }).orderBy('createdAt', 'desc').first('args')) as { args: Record<string, any> } | undefined
    const last = replies.at(-1)
    turns.push({ stopReason: job?.stopReason ?? null, body: last?.body ?? '', buttons: last?.buttons?.length ?? 0, proposal, action: last?.buttons?.length ? (action ?? null) : null })
  }

  let stored: RunObservation['stored'] = null
  const approve = replies.at(-1)?.buttons?.[0]?.id
  if (approve) {
    await inbound({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: approve, title: 'x' } } })
    await runWaAssistantWorker({}, deps)
    const q = (await db('sales_quotes').where({ agencyId }).first('id', 'totalAmount', 'status')) as { id: string; totalAmount: string; status: string } | undefined
    if (q) stored = { totalAmount: Number(q.totalAmount), status: q.status, lineCount: (await db('sales_quote_items').where({ quoteId: q.id })).length }
  }

  const run: RunObservation = { turns, leadIdByName, ownerE164: `+${digits}`, outboundTo, stored }
  return { variant, run, score: scoreRun(variant, run), costUsd: ctx.budget.spentUsd - before }
}

beforeAll(async () => {
  mkdirSync(REPORT_DIR, { recursive: true })
  writeFileSync(JSONL, '')
  for (const [id, name] of [[AUTHORIZED_AGENCY, '__quote_live_authorized__'], [EXEMPT_AGENCY, '__quote_live_exempt__']] as const) await agency(name, id)
  await db.raw(`UPDATE agencies SET "businessType" = 'authorized' WHERE id = ?`, [AUTHORIZED_AGENCY])
  await db.raw(`UPDATE agencies SET "businessType" = 'exempt' WHERE id = ?`, [EXEMPT_AGENCY])
  await db('bill_tax_rates').where({ agencyId: AUTHORIZED_AGENCY }).del()
  await db('bill_tax_rates').insert({ agencyId: AUTHORIZED_AGENCY, code: 'VAT_STD', label: 'מע"מ', ratePercent: 18, country: 'IL', effectiveFrom: '2024-01-01' })
})
afterAll(() => ctx.guard.uninstall())

it(`H1–H19 (${ctx.mode})`, { timeout: 4 * 60 * 60 * 1000 }, async () => {
  const results: { id: string; repeat: number; score: RunScore; costUsd: number; turns: number }[] = []
  // A later pass continues the wording rotation, so repeats still spread across wordings.
  const passes = Array.from({ length: ctx.repeats }, (_, pass) => SCENARIOS.map((s) => [s, pass] as const)).flat()
  const otherWordings = ctx.repeats === 1 ? SCENARIOS.flatMap((s) => s.variants.slice(1).map((_, i) => [s, i + 1] as const)) : []
  const plan = [...passes, ...otherWordings]
  for (const [s, repeat] of plan) {
    if (ctx.budget.stopped) break
    const r = await runScenario(s, repeat)
    if (ctx.budget.stopped && r.run.turns.length < r.variant.turns.length) break
    results.push({ id: s.id, repeat, score: r.score, costUsd: r.costUsd, turns: r.run.turns.length })
    appendFileSync(JSONL, `${JSON.stringify({ id: s.id, repeat, score: r.score, costUsd: r.costUsd, turns: r.run.turns.map((t) => ({ stopReason: t.stopReason, buttons: t.buttons, body: t.body, proposal: t.proposal })) })}\n`)
  }

  const b = ctx.budget
  const summary = {
    mode: ctx.mode,
    model: ctx.model,
    capUsd: ctx.capUsd,
    spentUsd: Number(b.spentUsd.toFixed(4)),
    stoppedByBudget: b.stopped,
    runs: results.length,
    planned: plan.length,
    passed: results.filter((r) => r.score.passed).length,
    modelRequests: b.requests.length,
    largestRequestChars: Math.max(0, ...b.requests.map((r) => r.bodyChars)),
    averageCostPerRunUsd: results.length ? Number((b.spentUsd / results.length).toFixed(4)) : 0,
    projectedCostForPlanUsd: results.length ? Number(((b.spentUsd / results.length) * plan.length).toFixed(2)) : 0,
    networkRefusals: ctx.guard.refusals,
    byScenario: SCENARIOS.map((s) => ({ id: s.id, runs: results.filter((r) => r.id === s.id).length, passed: results.filter((r) => r.id === s.id && r.score.passed).length, findings: results.filter((r) => r.id === s.id).flatMap((r) => r.score.findings) })),
  }
  const text = JSON.stringify(summary, null, 2)
  const key = process.env.OPENAI_API_KEY as string
  if (ctx.mode === 'model' && text.includes(key)) throw new Error('report contained the key; discarded')
  writeFileSync(path.join(REPORT_DIR, `${ctx.mode}-summary.json`), text)
  console.log(`[quote-live] ${text}`)

  expect(ctx.guard.refusals).toEqual([])
  if (ctx.mode === 'self') {
    expect(summary.byScenario.flatMap((s) => s.findings)).toEqual([])
    expect(summary.runs).toBe(plan.length)
  }
})
