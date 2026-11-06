import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Lead status changes and lead notes from WhatsApp, end to end against a real
 * (local test) PostgreSQL: the inbound webhook handler → the worker → a card →
 * a tap → the REAL Action Runtime and executors. Only the model and Meta are
 * mocked; nothing leaves the test database. Same harness as tasks.db.test.ts.
 *
 * NOTE: over the 250-line soft limit on purpose, like tasks.db.test.ts: one flat
 * list of independent scenarios over one shared harness.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/flags')>()),
  isAgentEnabled: () => flags.agent,
}))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { LEAD_UPDATE_COPY } from '@/lib/waAssistant/leadUpdates/copy'
import { COPY, NO_ACTIONS_NOTE } from '@/lib/waAssistant/render'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

let A: number
let B: number
let seq = 0

type Owner = { u: number; r: number; digits: string; lead: number }

async function lead(agencyId: number, ownerUserId: number, firstName = 'דני', lastName = 'כהן', status = 'new') {
  const [c] = await db('clients')
    .insert({ firstName, lastName, agencyId, userId: ownerUserId, createdById: ownerUserId, lead: true, status })
    .returning('id')
  return Number(c.id)
}
async function owner(role = 'ADMIN', agencyId = A): Promise<Owner> {
  const u = await user(agencyId, role)
  const digits = `9725000073${String(++seq).padStart(2, '0')}`
  const r = await recipient(agencyId, u, digits, undefined, 'v4')
  return { u, r, digits, lead: await lead(agencyId, u) }
}

type Proposal =
  | { actionType: 'update_lead_status'; args: { clientId: number; status: string } }
  | { actionType: 'add_lead_note'; args: { clientId: number; content: string } }
const answer = (p: Proposal | null, evidenceLeads: number[]) => ({
  ok: true as const,
  answer: { headline: 'ביקשתי', claims: [], unknown: null, proposedAction: p ? { ...p, evidenceRefs: evidenceLeads.map((l) => `lead:${l}`) } : null },
  evidence: evidenceLeads.map((l) => ({ kind: 'lead', refId: String(l) })),
  steps: 2,
  stopReason: 'answered' as const,
  investigationId: `inv_wa_lu_${++seq}`,
  costUsd: 0.01,
})
const status = (clientId: number, s = 'closed') => ({ actionType: 'update_lead_status' as const, args: { clientId, status: s } })
const note = (clientId: number, content = 'רוצה לדבר שבוע הבא') => ({ actionType: 'add_lead_note' as const, args: { clientId, content } })

function harness(results: unknown[] = [], opts: { automations?: boolean } = {}) {
  const runAgent = vi.fn(async (_input: Record<string, any>) => results.shift() as never)
  const sendText = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.LU_${++seq}` }))
  const deps = {
    runAgent: runAgent as never,
    sendText: sendText as never,
    typing: (async () => undefined) as never,
    leadUpdates: { propose: { hasStatusAutomations: async () => opts.automations === true } },
  }
  const last = () => sendText.mock.calls.at(-1)![0] as { body: string; buttons?: { id: string; title: string }[] }
  return { runAgent, sendText, deps, last }
}
async function say(o: Owner, body: string) {
  expect(
    await processPlatformMessage({ id: `wamid.__wa_lu_${++seq}`, from: o.digits, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } }),
  ).toBe('assistant_queued')
}
const tap = (digits: string, buttonId: string) =>
  processPlatformMessage({
    id: `wamid.__wa_lu_${++seq}`,
    from: digits,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'x' } },
  })
const run = (h: ReturnType<typeof harness>) => runWaAssistantWorker({}, h.deps)
const statusOf = async (id: number) => ((await db('clients').where({ id }).first('status')) as { status: string }).status
const notesOf = (leadId: number) => db('lead_notes').where({ leadId }).orderBy('id').select('content', 'userId')
const actionsOf = (agencyId: number) => db('agent_actions').where({ agencyId })

async function card(o: Owner, h: ReturnType<typeof harness>, words: string) {
  await say(o, words)
  await run(h)
  const sent = h.last()
  expect(sent.buttons, sent.body).toHaveLength(2)
  return { approve: sent.buttons![0].id, reject: sent.buttons![1].id, body: sent.body, titles: sent.buttons!.map((b) => b.title) }
}

beforeAll(async () => {
  A = await agency('__wa_lu_a__')
  B = await agency('__wa_lu_b__')
})
beforeEach(async () => {
  await resetBetweenTests()
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('analytics_events').where({ event: 'wa_assistant_turn' }).del()
  await db('agencies').whereIn('id', [A, B]).update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
  flags.agent = true
  process.env.WA_ASSISTANT_AGENCY_IDS = `${A},${B}`
  process.env.WA_ASSISTANT_STATUS_AGENCY_IDS = `${A},${B}`
  process.env.WA_ASSISTANT_NOTES_AGENCY_IDS = `${A},${B}`
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = `${A},${B}`
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
  process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
})
afterAll(async () => {
  for (const k of ['WA_ASSISTANT_AGENCY_IDS', 'WA_ASSISTANT_STATUS_AGENCY_IDS', 'WA_ASSISTANT_NOTES_AGENCY_IDS', 'OWNER_WA_REMINDERS_AGENCY_IDS', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_ACCESS_TOKEN'])
    delete process.env[k]
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('analytics_events').whereIn('agencyId', [A, B]).del()
  await db('analytics_events').where({ event: 'wa_assistant_turn' }).del()
  await db('lead_status_transitions').whereIn('agencyId', [A, B]).del()
  await db('lead_notes').whereIn('agencyId', [A, B]).del()
  await db('clients').whereIn('agencyId', [A, B]).del()
  await cleanup()
})

describe('status: only after approval, verified, once', () => {
  it('"תעביר את דני לסגור" → card (from → to) → nothing yet → approve → closed, with history', async () => {
    const o = await owner()
    const h = harness([answer(status(o.lead), [o.lead])])
    const c = await card(o, h, 'תעביר את דני לסגור')
    expect(c.titles).toEqual(['לאשר ולעדכן', 'ביטול'])
    expect(c.body).toContain('*לעדכן סטטוס?*')
    expect(c.body).toContain('דני כהן')
    expect(c.body).toContain('סטטוס נוכחי: חדש')
    expect(c.body).toContain('סטטוס חדש: סגור')
    expect(c.body).not.toContain('אוטומציות')
    expect(await statusOf(o.lead)).toBe('new')

    await tap(o.digits, c.approve)
    await run(h)
    expect(h.last().body).toContain('*הסטטוס עודכן ב-SocialCRM*')
    expect(h.last().body).toContain('סטטוס: סגור')
    expect(await statusOf(o.lead)).toBe('closed')
    expect(await db('lead_status_transitions').where({ leadId: o.lead }).select('fromStatus', 'toStatus', 'actorUserId')).toEqual([
      { fromStatus: 'new', toStatus: 'closed', actorUserId: o.u },
    ])

    // The same button again: the token is single-use.
    await tap(o.digits, c.approve)
    await run(h)
    expect(h.last().body).toBe(LEAD_UPDATE_COPY.alreadyDecided)
    expect(await db('lead_status_transitions').where({ leadId: o.lead })).toHaveLength(1)
  })

  it('the card warns when the business has active status automations', async () => {
    const o = await owner()
    const c = await card(o, harness([answer(status(o.lead), [o.lead])], { automations: true }), 'תעביר את דני לסגור')
    expect(c.body).toContain('אוטומציות פעילות לשינוי סטטוס')
  })

  it('reject → nothing changes', async () => {
    const o = await owner()
    const h = harness([answer(status(o.lead, 'lost'), [o.lead])])
    const c = await card(o, h, 'תסמן את דני כלא רלוונטי')
    await tap(o.digits, c.reject)
    await run(h)
    expect(h.last().body).toBe(LEAD_UPDATE_COPY.rejected)
    expect(await statusOf(o.lead)).toBe('new')
  })

  it('a stale card writes nothing: the status changed between card and tap', async () => {
    const o = await owner()
    const h = harness([answer(status(o.lead), [o.lead])])
    const c = await card(o, h, 'תעביר את דני לסגור')
    await db('clients').where({ id: o.lead }).update({ status: 'interested' })
    await tap(o.digits, c.approve)
    await run(h)
    expect(h.last().body).toBe(LEAD_UPDATE_COPY.staleStatus)
    expect(await statusOf(o.lead)).toBe('interested')
  })

  it('already in that status → said so, no card, nothing recorded', async () => {
    const o = await owner()
    await db('clients').where({ id: o.lead }).update({ status: 'closed' })
    const h = harness([answer(status(o.lead), [o.lead])])
    await say(o, 'תעביר את דני לסגור')
    await run(h)
    expect(h.last().buttons).toBeUndefined()
    expect(h.last().body).toContain('כבר בסטטוס סגור')
    expect(await actionsOf(A)).toHaveLength(0)
  })

  it('a status that is not one of the five → one question, no card', async () => {
    const o = await owner()
    const h = harness([answer(status(o.lead, 'won'), [o.lead])])
    await say(o, 'תעביר את דני לזכייה')
    await run(h)
    expect(h.last().buttons).toBeUndefined()
    expect(h.last().body).toBe(LEAD_UPDATE_COPY.askStatus)
    expect(await actionsOf(A)).toHaveLength(0)
  })

  it('two leads with the same name → the owner chooses; "2" continues the same request', async () => {
    const o = await owner()
    const second = await lead(A, o.u, 'דני', 'לוי')
    const h = harness([answer(status(o.lead), [o.lead, second])])
    await say(o, 'תעביר את דני לסגור')
    await run(h)
    expect(h.last().buttons).toBeUndefined()
    expect(h.last().body).toContain('איזה מהם?')
    expect(await actionsOf(A)).toHaveLength(0)

    h.runAgent.mockResolvedValueOnce(answer(status(o.lead), [o.lead, second]) as never)
    const c = await card(o, h, '2')
    expect(c.body).toContain('דני לוי')
  })

  it("another agency's lead is refused before any card", async () => {
    const a = await owner()
    const b = await owner('ADMIN', B)
    const h = harness([answer(status(a.lead), [a.lead])])
    await say(b, 'תעביר את דני לסגור')
    await run(h)
    expect(h.last().body).toBe(LEAD_UPDATE_COPY.leadNotAllowed)
    expect(await actionsOf(B)).toHaveLength(0)
    expect(await statusOf(a.lead)).toBe('new')
  })

  it('switch off: the Agent is not told about status changes, and a proposal does nothing', async () => {
    delete process.env.WA_ASSISTANT_STATUS_AGENCY_IDS
    const o = await owner()
    const h = harness([answer(status(o.lead), [o.lead])])
    await say(o, 'תעביר את דני לסגור')
    await run(h)
    expect(String(h.runAgent.mock.calls[0][0].surfaceRules)).not.toContain('update_lead_status')
    expect(h.last().body).toContain(NO_ACTIONS_NOTE)
    expect(await actionsOf(A)).toHaveLength(0)
  })

  it('switch turned off after the card: the tap does nothing', async () => {
    const o = await owner()
    const h = harness([answer(status(o.lead), [o.lead])])
    const c = await card(o, h, 'תעביר את דני לסגור')
    expect(String(h.runAgent.mock.calls[0][0].surfaceRules)).toContain('update_lead_status')
    delete process.env.WA_ASSISTANT_STATUS_AGENCY_IDS
    await tap(o.digits, c.approve)
    await run(h)
    expect(h.last().body).toBe(COPY.notAvailable)
    expect(await statusOf(o.lead)).toBe('new')
  })
})

describe('notes: added beside the existing ones, only after approval', () => {
  it('"תרשום שדני רוצה לדבר שבוע הבא" → card → approve → a new lead_notes row; older notes stay', async () => {
    const o = await owner()
    await db('lead_notes').insert({ agencyId: A, leadId: o.lead, userId: o.u, userName: 'x', content: 'הערה קודמת' })
    const h = harness([answer(note(o.lead), [o.lead])])
    const c = await card(o, h, 'תרשום שדני רוצה לדבר שבוע הבא')
    expect(c.titles).toEqual(['לאשר ולהוסיף', 'ביטול'])
    expect(c.body).toContain('*להוסיף הערה לליד?*')
    expect(c.body).toContain('הערה: רוצה לדבר שבוע הבא')
    expect(await notesOf(o.lead)).toHaveLength(1)

    await tap(o.digits, c.approve)
    await run(h)
    expect(h.last().body).toContain('*ההערה נשמרה ב-SocialCRM*')
    expect(await notesOf(o.lead)).toEqual([
      { content: 'הערה קודמת', userId: o.u },
      { content: 'רוצה לדבר שבוע הבא', userId: o.u },
    ])
  })

  it("a rep cannot note a colleague's lead", async () => {
    const boss = await owner()
    const r = await owner('AGNT')
    const h = harness([answer(note(boss.lead), [boss.lead])])
    await say(r, 'תרשום שדני רוצה לדבר שבוע הבא')
    await run(h)
    expect(h.last().body).toBe(LEAD_UPDATE_COPY.leadNotAllowed)
    expect(await notesOf(boss.lead)).toHaveLength(0)
  })

  it('an empty note → one question, no card', async () => {
    const o = await owner()
    const h = harness([answer(note(o.lead, '  '), [o.lead])])
    await say(o, 'תוסיף הערה לדני')
    await run(h)
    expect(h.last().body).toBe(LEAD_UPDATE_COPY.askNote)
    expect(await actionsOf(A)).toHaveLength(0)
  })

  it('notes switch off while status is on: no note action', async () => {
    delete process.env.WA_ASSISTANT_NOTES_AGENCY_IDS
    const o = await owner()
    const h = harness([answer(note(o.lead), [o.lead])])
    await say(o, 'תרשום שדני רוצה לדבר שבוע הבא')
    await run(h)
    const rules = String(h.runAgent.mock.calls[0][0].surfaceRules)
    expect(rules).not.toContain('add_lead_note')
    expect(rules).toContain('update_lead_status')
    expect(h.last().body).toContain(NO_ACTIONS_NOTE)
    expect(await notesOf(o.lead)).toHaveLength(0)
  })
})
