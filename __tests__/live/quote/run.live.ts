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
// The PDF step, for scenarios that require the owner's preview: the real job runs, with the renderer, R2 and the
// owner's WhatsApp message replaced on this machine. Every other scenario keeps the no-op startPdf below.
const pdf = vi.hoisted(() => ({ jobs: [] as (() => Promise<void>)[], sent: [] as { toE164: string; document?: { link: string; filename: string } | null; body: string }[] }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (job: () => Promise<void>) => void pdf.jobs.push(job) }))
vi.mock('@/lib/pdf/renderer', async (orig) => ({ ...(await orig<typeof import('@/lib/pdf/renderer')>()), renderPdfFromHtml: async () => new Uint8Array([37, 80, 68, 70, 45]) }))
vi.mock('@/lib/storage/objects', async (orig) => ({
  ...(await orig<typeof import('@/lib/storage/objects')>()),
  putObject: async () => undefined,
  headObject: async () => ({ size: 5 }),
  presignDownload: async (i: { key: string }) => `https://r2.harness.invalid/${i.key}`,
}))
vi.mock('@/lib/whatsapp/platform/sendText', async (orig) => ({
  ...(await orig<typeof import('@/lib/whatsapp/platform/sendText')>()),
  sendPlatformText: async (i: { toE164: string; body: string; document?: { link: string; filename: string } | null }) => {
    pdf.sent.push({ toE164: i.toE164, body: i.body, document: i.document ?? null })
    return { kind: 'sent' as const, wamid: `wamid.LIVE_PDF_${pdf.sent.length}` }
  },
}))

import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { runAgentInvestigation } from '@/lib/agent/run'
import { agency, recipient, user } from '../../ownerWhatsappReminders/reminderFixtures'
import { AUTHORIZED_AGENCY, EXEMPT_AGENCY, type LiveContext } from './env'
import { SCENARIOS as FULL_SET, FREE_WORDING_SCENARIOS, NEW_CUSTOMER_SCENARIOS, ZERO_SCENARIOS, variantFor, type CardExpect, type Scenario, type ScenarioVariant } from './scenarios'
import { scoreRun, type RunObservation, type RunScore, type TurnObservation } from './evaluate'
import type { PersistedState } from './persistenceScore'

const ctx = (globalThis as unknown as { __quoteLive: LiveContext }).__quoteLive
const SETS: Record<string, readonly Scenario[]> = {
  zero: ZERO_SCENARIOS,
  free: FREE_WORDING_SCENARIOS,
  newcustomer: [...FULL_SET.filter((s) => ['H1', 'H5', 'H7'].includes(s.id)), ...NEW_CUSTOMER_SCENARIOS],
}
const chosenSet = process.env.QUOTE_LIVE_SET
if (chosenSet !== undefined && !SETS[chosenSet]) throw new Error(`unknown QUOTE_LIVE_SET: ${chosenSet}`)
const SCENARIOS = chosenSet ? SETS[chosenSet] : FULL_SET
const REPORT_DIR = process.env.QUOTE_LIVE_REPORT_DIR || path.join('node_modules', '.cache', 'quote-live')
const JSONL = path.join(REPORT_DIR, `${ctx.mode}.jsonl`)
const TABLES = ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']
let seq = 0

async function reset() {
  for (const t of TABLES) await db(t).del()
  pdf.jobs.length = 0
  pdf.sent.length = 0
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
  if (s.newCustomer) {
    // What a correct Agent does: find_lead finds nobody, so clientId 0 and the customer as the owner wrote them;
    // told the customer is new (a later turn), no details again.
    const lines = [{ title: 'שיפוץ מטבח', quantity: null, unitAmount: 18500, discountAmount: null, discountPercent: null }]
    const priceBasis = s.id === 'N4' && turn === 0 ? null : 'incl_vat'
    const args = (clientId: number, newCustomer: Scenario['newCustomer'] | null) => ({ clientId, newCustomer, title: 'שיפוץ מטבח', lines, priceBasis, validityDays: null })
    if (s.id === 'N6' && turn === 0) {
      const id = leads['דוד כהן']
      ctx.fake.next = { findName: 'דוד', headline: 'h', proposal: { actionType: 'create_quote', args: args(id, null), evidenceRefs: [`lead:${id}`] } }
      return
    }
    ctx.fake.next = { findName: turn === 0 ? s.newCustomer.firstName : null, headline: 'h', proposal: { actionType: 'create_quote', args: args(0, turn === 0 ? s.newCustomer : null), evidenceRefs: [] } }
    return
  }
  const named = /דוד כהן/.test(v.turns[0]) ? 'דוד כהן' : /דוד/.test(v.turns[0]) ? 'דוד' : null
  const c: CardExpect | null = step?.kind === 'card' ? step.card : s.id === 'H4' ? { lead: 'דוד כהן', basis: 'incl_vat', lines: [{ quantity: 1, unitAmount: 18500 }] } : null
  const priced = (lines: CardExpect['lines'], basis: CardExpect['basis']) => ({
    lines: lines.map((l, i) => ({ title: `פריט ${i + 1}`, quantity: l.quantity === 1 ? null : l.quantity, unitAmount: l.unitAmount, discountAmount: l.discountAmount ?? null, discountPercent: l.discountPercent ?? null })),
    priceBasis: basis === 'no_vat' ? null : s.id === 'H4' && turn === 0 ? null : basis,
  })
  if (s.id.startsWith('Z')) {
    const id = leads['דוד כהן']
    const lines = step?.kind === 'card' ? step.card.lines : [{ quantity: 1, unitAmount: 0 }]
    ctx.fake.next = { findName: 'דוד כהן', headline: 'h', proposal: { actionType: 'create_quote', args: { clientId: id, newCustomer: null, title: 'עבודה', ...priced(lines, 'incl_vat'), validityDays: null }, evidenceRefs: [`lead:${id}`] } }
    return
  }
  if (s.id === 'H16') {
    const id = leads['דוד כהן']
    ctx.fake.next = { findName: 'דוד כהן', headline: 'h', proposal: { actionType: 'create_quote', args: { clientId: id, newCustomer: null, title: 'חלונות', lines: Array.from({ length: 30 }, (_, i) => ({ title: `חלון ${i + 1}`, quantity: null, unitAmount: 100, discountAmount: null, discountPercent: null })), priceBasis: 'incl_vat', validityDays: null }, evidenceRefs: [`lead:${id}`] } }
    return
  }
  if ((s.id === 'H9' || s.id === 'H10') && turn === 0) {
    const id = leads['דוד כהן']
    ctx.fake.next = { findName: 'דוד כהן', headline: 'h', proposal: { actionType: 'create_quote', args: { clientId: id, newCustomer: null, title: 'שיפוץ מטבח', lines: [{ title: 'שיפוץ מטבח', quantity: null, unitAmount: 18500, discountAmount: null, discountPercent: null }], priceBasis: 'incl_vat', validityDays: null }, evidenceRefs: [`lead:${id}`] } }
    return
  }
  if (s.id === 'H15' && v.steps[0].kind === 'question' && v.steps[0].stopPrefix === 'quote_clarify_free' && turn === 0) {
    const id = leads['דוד כהן']
    ctx.fake.next = { findName: 'דוד כהן', headline: 'h', proposal: { actionType: 'create_quote', args: { clientId: id, newCustomer: null, title: 'שיפוץ מטבח', lines: [{ title: 'שיפוץ מטבח', quantity: null, unitAmount: 0, discountAmount: null, discountPercent: null }], priceBasis: 'incl_vat', validityDays: null }, evidenceRefs: [`lead:${id}`] } }
    return
  }
  if (s.id === 'H5' && turn === 0) {
    const id = leads['דוד כהן']
    ctx.fake.next = { findName: 'דוד', headline: 'h', proposal: { actionType: 'create_quote', args: { clientId: id, newCustomer: null, title: 'שיפוץ מטבח', lines: [{ title: 'שיפוץ מטבח', quantity: null, unitAmount: 18500, discountAmount: null, discountPercent: null }], priceBasis: 'incl_vat', validityDays: null }, evidenceRefs: [`lead:${id}`] } }
    return
  }
  if (!c) {
    ctx.fake.next = { findName: null, headline: 'לאיזה ליד?', proposal: null }
    return
  }
  const id = leads[c.lead]
  ctx.fake.next = { findName: named, headline: 'h', proposal: { actionType: 'create_quote', args: { clientId: id, newCustomer: null, title: 'שיפוץ מטבח', ...priced(c.lines, c.basis), validityDays: c.validityDays ?? null }, evidenceRefs: [`lead:${id}`] } }
}

/** Everything the quote tables hold. Not filtered by agency, so a quote written to the wrong one is seen. */
async function readPersisted(): Promise<PersistedState> {
  const n = (v: unknown) => Number(v)
  const quotes = (await db('sales_quotes').orderBy('id').select('id', 'agencyId', 'leadId', 'status', 'quoteNumber', 'quoteYear', 'title', 'subtotalAmount', 'taxAmount', 'discountAmount', 'totalAmount', 'sentAt', 'automationKey', 'metadata', db.raw(`to_char("expiresAt", 'YYYY-MM-DD') as "expiresAt"`))) as any[]
  const items = (await db('sales_quote_items').orderBy('id').select('quoteId', 'agencyId', 'lineNumber', 'title', 'quantity', 'unitPrice', 'discount', 'taxRatePercentSnapshot', 'lineSubtotal', 'lineTaxAmount', 'lineTotal')) as any[]
  const orphans = (await db('sales_quote_items as i').leftJoin('sales_quotes as q', 'q.id', 'i.quoteId').whereNull('q.id').count<{ count: string }>('i.id as count').first())?.count
  const numbering = (await db('bill_numbering_sequences').select('agencyId', 'year', 'kind', 'nextValue')) as any[]
  const actions = (await db('agent_actions').select('actionId', 'actionType', 'executionStatus', 'verificationState', 'targetIds')) as PersistedState['actions']
  const leads = (await db('clients').whereIn('agencyId', [AUTHORIZED_AGENCY, EXEMPT_AGENCY]).orderBy('id').select('id', 'agencyId', 'firstName', 'lastName', 'phone', 'leadSource', 'createOrigin')) as any[]
  return {
    leads: leads.map((l) => ({ ...l, id: n(l.id), agencyId: n(l.agencyId) })),
    quotes: quotes.map((q) => ({ ...q, id: n(q.id), agencyId: n(q.agencyId), leadId: n(q.leadId), quoteNumber: q.quoteNumber == null ? null : n(q.quoteNumber), quoteYear: q.quoteYear == null ? null : n(q.quoteYear), subtotalAmount: n(q.subtotalAmount), taxAmount: n(q.taxAmount), discountAmount: n(q.discountAmount), totalAmount: n(q.totalAmount) })),
    items: items.map((i) => ({ ...i, quoteId: n(i.quoteId), agencyId: n(i.agencyId), lineNumber: n(i.lineNumber), quantity: n(i.quantity), unitPrice: n(i.unitPrice), discount: n(i.discount), taxRatePercentSnapshot: n(i.taxRatePercentSnapshot), lineSubtotal: n(i.lineSubtotal), lineTaxAmount: n(i.lineTaxAmount), lineTotal: n(i.lineTotal) })),
    orphanItems: n(orphans ?? 0),
    numbering: numbering.map((r) => ({ agencyId: n(r.agencyId), year: n(r.year), kind: r.kind, nextValue: n(r.nextValue) })),
    actions,
  }
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
    const [c] = await db('clients').insert({ firstName, lastName, phone: s.phones?.[`${firstName} ${lastName}`] ?? `05277${String(10000 + ++seq)}`, agencyId, userId: owner, createdById: owner, lead: true, status: 'new' }).returning('id')
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
    // The preview scenarios run the real PDF job (see the mocks above).
    quotes: s.preview ? undefined : { decide: { startPdf: (async () => 'skipped') as never } },
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
    const action = (await db('agent_actions').where({ agencyId }).orderBy('createdAt', 'desc').first('actionId', 'args')) as { actionId: string; args: Record<string, any> } | undefined
    const last = replies.at(-1)
    turns.push({ stopReason: job?.stopReason ?? null, body: last?.body ?? '', buttons: last?.buttons?.length ?? 0, proposal, action: last?.buttons?.length ? (action ?? null) : null })
  }

  let approvalStop: string | null = null
  const approve = replies.at(-1)?.buttons?.[0]?.id
  if (approve) {
    await inbound({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: approve, title: 'x' } } })
    await runWaAssistantWorker({}, deps)
    approvalStop = ((await db('wa_assistant_jobs').orderBy('id', 'desc').first('stopReason')) as { stopReason: string | null } | undefined)?.stopReason ?? null
  }
  while (pdf.jobs.length) await pdf.jobs.shift()!()
  for (const m of pdf.sent) outboundTo.push(m.toE164)
  const previewed = pdf.sent.some((m) => m.toE164 === `+${digits}` && m.document?.filename?.endsWith('.pdf') && /הלקוח עדיין לא קיבל את ההצעה/.test(m.body))

  const run: RunObservation = { turns, leadIdByName, ownerE164: `+${digits}`, outboundTo, agencyId, approved: Boolean(approve), approvalStop, finishedAtMs: Date.now(), persisted: await readPersisted() }
  const score = scoreRun(variant, run)
  if (s.preview && approve && !previewed) score.findings.push({ kind: 'persistence_missing', detail: 'no PDF preview reached the owner' })
  score.passed = score.findings.length === 0
  return { variant, run, score, costUsd: ctx.budget.spentUsd - before }
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
    appendFileSync(JSONL, `${JSON.stringify({ id: s.id, repeat, score: r.score, costUsd: r.costUsd, turns: r.run.turns.map((t) => ({ stopReason: t.stopReason, buttons: t.buttons, body: t.body, proposal: t.proposal })), approved: r.run.approved, approvalStop: r.run.approvalStop, persisted: r.run.persisted })}\n`)
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
